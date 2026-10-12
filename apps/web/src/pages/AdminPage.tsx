import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Role, SsoConfigPublic, User } from "@paper-xray/contracts";
import { approveUser, deleteUser, exportSsoConfigJson, fetchSsoConfig, fetchUserDeletionPreview, fetchUsers, saveSsoConfig, setUserRole, type UserDeletionPreview, fetchInvitations, createInvitation, deleteInvitation, fetchRegistrationMode, setRegistrationMode, type Invitation, type RegistrationMode } from "../api";
import { useNotifications } from "../NotificationContext";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../ToastContext";
import { ProviderSettings } from "../components/ProviderSettings";
import { MAX_SSO_JSON_BYTES, parseSsoConfigJson } from "./sso-config-json";
import { Header } from "../components/Header";

const ROLES: Role[] = ["member", "curator", "admin"];
const ROLE_HINTS: Record<Role, string> = {
  member: "Uses org lenses, creates personal lenses, reads and writes their own annotations",
  curator: "Also creates and edits org lenses",
  admin: "Also manages users, roles and org settings",
};

const SSO_FIELDS: Array<[keyof Omit<SsoConfigPublic, "hasClientSecret">, string]> = [
  ["providerName", "PROVIDER NAME"],
  ["authorizationEndpoint", "AUTHORIZATION ENDPOINT"],
  ["tokenEndpoint", "TOKEN ENDPOINT"],
  ["userinfoEndpoint", "USERINFO ENDPOINT"],
  ["clientId", "CLIENT ID"],
  ["scopes", "SCOPES"],
  ["accountManagementUrl", "ACCOUNT MANAGEMENT URL"],
];

type AdminSection = "providers" | "users" | "invitations" | "sso";

/** Admin panel: roles (docs/02-decisions.md #4) and the org's OAuth2 SSO settings (#11). */
export function AdminPage() {
  const { user: me } = useAuth();
  const { revision } = useNotifications();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState<AdminSection>(
    (searchParams.get("section") as AdminSection) || "providers"
  );
  const [approving, setApproving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletePreview, setDeletePreview] = useState<UserDeletionPreview | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [users, setUsers] = useState<User[] | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [sso, setSso] = useState<SsoConfigPublic | null>(null);
  const [newSecret, setNewSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);
  const ssoFileInput = useRef<HTMLInputElement>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [registrationMode, setRegistrationModeState] = useState<RegistrationMode>("approval_required");
  const [showCreateInvitation, setShowCreateInvitation] = useState(false);
  const [newInvitationEmail, setNewInvitationEmail] = useState("");
  const [newInvitationRole, setNewInvitationRole] = useState<Role>("member");
  const [newInvitationExpiry, setNewInvitationExpiry] = useState("7");
  const [creatingInvitation, setCreatingInvitation] = useState(false);

  useEffect(() => {
    if (me?.role !== "admin") return;
    fetchSsoConfig().then(setSso).catch((err) => showToast(String(err), "error"));
  }, [me?.role]);

  useEffect(() => {
    if (me?.role === "admin") fetchUsers().then(setUsers).catch(err => showToast(String(err), "error"));
  }, [me?.role, revision]);

  useEffect(() => {
    if (me?.role === "admin") {
      fetchInvitations().then(setInvitations).catch(err => showToast(String(err), "error"));
      fetchRegistrationMode().then(setRegistrationModeState).catch(err => showToast(String(err), "error"));
    }
  }, [me?.role]);

  async function approve(user: User) {
    if (approving) return;
    setApproving(user.id);
    try {
      const updated = await approveUser(user.id);
      setUsers(current => (current ?? []).map(u => u.id === updated.id ? updated : u));
      showToast(`${updated.displayName} has been approved.`);
    } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setApproving(null); }
  }

  async function handleCreateInvitation() {
    if (creatingInvitation) return;
    setCreatingInvitation(true);
    try {
      const params: { email?: string; role: Role; expiresInDays?: number } = {
        role: newInvitationRole,
      };
      if (newInvitationEmail.trim()) params.email = newInvitationEmail.trim();
      if (newInvitationExpiry && newInvitationExpiry !== "never") {
        params.expiresInDays = parseInt(newInvitationExpiry, 10);
      }
      const invitation = await createInvitation(params);
      setInvitations(current => [invitation, ...(current ?? [])]);
      setShowCreateInvitation(false);
      setNewInvitationEmail("");
      setNewInvitationRole("member");
      setNewInvitationExpiry("7");
      showToast("Invitation created successfully.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setCreatingInvitation(false);
    }
  }

  async function handleDeleteInvitation(id: string) {
    if (!confirm("Are you sure you want to delete this invitation?")) return;
    try {
      await deleteInvitation(id);
      setInvitations(current => (current ?? []).filter(inv => inv.id !== id));
      showToast("Invitation deleted.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function handleRegistrationModeChange(mode: RegistrationMode) {
    try {
      await setRegistrationMode(mode);
      setRegistrationModeState(mode);
      showToast(`Registration mode updated to: ${mode.replace("_", " ")}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  if (me?.role !== "admin") {
    return (
      <div className="pxr-settings-page">
        <Header />
        <main className="pxr-admin-main pxr-settings-scroll">
          <div className="pxr-admin-content">
            <ProviderSettings />
          </div>
        </main>
      </div>
    );
  }

  async function changeRole(user: User, role: Role) {
    try {
      const updated = await setUserRole(user.id, role);
      setUsers((current) => (current ?? []).map((u) => (u.id === updated.id ? updated : u)));
      showToast(`${updated.displayName} is now ${updated.role}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function beginDelete(user: User) {
    if (user.status === "pending") {
      setDeleting(true);
      try {
        await deleteUser(user.id);
        setUsers(current => (current ?? []).filter(u => u.id !== user.id));
        showToast(`${user.displayName} was deleted. Future SSO logins require approval.`);
      } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
      finally { setDeleting(false); }
    } else {
      try { setDeletePreview(await fetchUserDeletionPreview(user.id)); setDeleteConfirmation(""); }
      catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    }
  }

  async function confirmDelete() {
    if (!deletePreview || deleteConfirmation.trim().toLowerCase() !== deletePreview.user.email.toLowerCase() || deleting) return;
    setDeleting(true);
    try {
      await deleteUser(deletePreview.user.id);
      setUsers(current => (current ?? []).filter(user => user.id !== deletePreview.user.id));
      showToast(`${deletePreview.user.displayName} was deleted. Future SSO logins require approval.`);
      setDeletePreview(null);
    } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setDeleting(false); }
  }

  async function importSso(file: File) {
    if (ssoBusy) return;
    setSsoBusy(true);
    try {
      if (file.size > MAX_SSO_JSON_BYTES) throw new Error("SSO JSON must be 64 KB or smaller.");
      const { clientSecret, ...fields } = parseSsoConfigJson(await file.text());
      setSso({ ...fields, accountManagementUrl: fields.accountManagementUrl ?? "", hasClientSecret: sso?.hasClientSecret ?? false });
      setNewSecret(clientSecret ?? "");
      setClearSecret(clientSecret === null || clientSecret === "");
      showToast("JSON imported. Save SSO settings to apply.");
    } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setSsoBusy(false); }
  }

  async function exportSso() {
    if (ssoBusy) return;
    setSsoBusy(true);
    try {
      const blob = await exportSsoConfigJson();
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url; link.download = "sso-config.json";
        document.body.appendChild(link); link.click(); link.remove();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setSsoBusy(false); }
  }

  async function submitSso(e: React.FormEvent) {
    e.preventDefault();
    if (!sso || ssoBusy) return;
    setSsoBusy(true);
    try {
      const { hasClientSecret: _ignored, ...fields } = sso;
      const saved = await saveSsoConfig({
        ...fields,
        clientSecret: clearSecret ? null : newSecret ? newSecret : undefined,
      });
      setSso(saved);
      setNewSecret("");
      setClearSecret(false);
      showToast("SSO settings saved.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally { setSsoBusy(false); }
  }

  return (
    <div className="pxr-settings-page">
      <Header
        left={
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <Link to="/" style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Library
            </Link>
            <span style={{ color: "var(--border-strong)" }}>/</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Admin</span>
          </div>
        }
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left sidebar navigation */}
        <aside style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", background: "var(--panel)", padding: "16px 0" }}>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button
              type="button"
              onClick={() => setActiveSection("providers")}
              style={{
                padding: "10px 16px",
                textAlign: "left",
                border: "none",
                background: activeSection === "providers" ? "var(--surface)" : "transparent",
                borderLeft: activeSection === "providers" ? "3px solid var(--human)" : "3px solid transparent",
                color: "var(--text)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Model Providers
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("users")}
              style={{
                padding: "10px 16px",
                textAlign: "left",
                border: "none",
                background: activeSection === "users" ? "var(--surface)" : "transparent",
                borderLeft: activeSection === "users" ? "3px solid var(--human)" : "3px solid transparent",
                color: "var(--text)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Users & Roles
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("invitations")}
              style={{
                padding: "10px 16px",
                textAlign: "left",
                border: "none",
                background: activeSection === "invitations" ? "var(--surface)" : "transparent",
                borderLeft: activeSection === "invitations" ? "3px solid var(--human)" : "3px solid transparent",
                color: "var(--text)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Invitations
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("sso")}
              style={{
                padding: "10px 16px",
                textAlign: "left",
                border: "none",
                background: activeSection === "sso" ? "var(--surface)" : "transparent",
                borderLeft: activeSection === "sso" ? "3px solid var(--human)" : "3px solid transparent",
                color: "var(--text)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Single Sign-On
            </button>
          </nav>
        </aside>

        {/* Main content area */}
        <main className="pxr-admin-main pxr-settings-scroll" style={{ flex: 1, overflow: "auto" }}>
          <div className="pxr-admin-content">
            {activeSection === "providers" && <ProviderSettings />}

            {activeSection === "users" && (
              <section>
                <h2 className="pxr-section-title">USERS & ROLES</h2>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
                  New members await approval after their first SSO login. Approve requests here to grant access.
                </p>
                <div style={{ marginBottom: 12 }}>
                  <input
                    type="search"
                    placeholder="Search by name or email..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="pxr-input"
                    style={{ maxWidth: 300 }}
                  />
                </div>
                {users === null ? (
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "var(--surface)" }}>
                      <thead>
                        <tr style={{ textAlign: "left" }}>
                          {["NAME", "EMAIL", "ROLE", "MEMBERSHIP", ""].map((h, index) => (
                            <th key={h || index} className="mono" style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)", padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {users
                          .filter((u) => {
                            if (!userSearch.trim()) return true;
                            const search = userSearch.toLowerCase();
                            return (
                              u.displayName.toLowerCase().includes(search) ||
                              u.email.toLowerCase().includes(search)
                            );
                          })
                          .map((u) => (
                          <tr key={u.id}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                              {u.displayName}
                              {u.id === me.id && <span style={{ color: "var(--text-soft)" }}> (you)</span>}
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>{u.email}</td>
                            <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
                              <select
                                className="pxr-input"
                                style={{ width: 130, height: 30 }}
                                value={u.role}
                                disabled={u.status === "pending"}
                                title={ROLE_HINTS[u.role]}
                                onChange={(e) => void changeRole(u, e.target.value as Role)}
                              >
                                {ROLES.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
                              {u.status === "pending" ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Pending</span>
                                <button type="button" className="pxr-btn" disabled={approving !== null} onClick={() => void approve(u)}>{approving === u.id ? "Approving…" : "Approve"}</button>
                              </div> : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Active</span>}
                            </td>
                            <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                              <button type="button" className="pxr-btn" disabled={u.id === me.id || (u.status !== "pending" && u.role === "admin" && users.filter(candidate => candidate.role === "admin" && candidate.status !== "pending").length <= 1)} title={u.id === me.id ? "You cannot delete your own account" : u.status !== "pending" && u.role === "admin" && users.filter(candidate => candidate.role === "admin" && candidate.status !== "pending").length <= 1 ? "Cannot delete the last active administrator" : "Delete user"} onClick={() => void beginDelete(u)}>Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {activeSection === "invitations" && (
              <section>
                <h2 className="pxr-section-title">INVITATIONS</h2>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 16px" }}>
                  Manage invitation links and registration mode for new users.
                </p>

                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Registration Mode</h3>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="registrationMode"
                        value="open"
                        checked={registrationMode === "open"}
                        onChange={() => handleRegistrationModeChange("open")}
                      />
                      <span style={{ fontSize: 13 }}>Open (anyone can register)</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="registrationMode"
                        value="approval_required"
                        checked={registrationMode === "approval_required"}
                        onChange={() => handleRegistrationModeChange("approval_required")}
                      />
                      <span style={{ fontSize: 13 }}>Approval Required</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="registrationMode"
                        value="invite_only"
                        checked={registrationMode === "invite_only"}
                        onChange={() => handleRegistrationModeChange("invite_only")}
                      />
                      <span style={{ fontSize: 13 }}>Invite Only</span>
                    </label>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Invitation Links</h3>
                  <button
                    type="button"
                    className="pxr-btn pxr-btn-primary"
                    onClick={() => setShowCreateInvitation(!showCreateInvitation)}
                  >
                    {showCreateInvitation ? "Cancel" : "Create Invitation"}
                  </button>
                </div>

                {showCreateInvitation && (
                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: "grid", gap: 12 }}>
                      <div>
                        <label className="pxr-label" htmlFor="invitation-email">EMAIL (OPTIONAL)</label>
                        <input
                          id="invitation-email"
                          type="email"
                          className="pxr-input"
                          placeholder="Leave empty for anyone to use"
                          value={newInvitationEmail}
                          onChange={(e) => setNewInvitationEmail(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="pxr-label" htmlFor="invitation-role">ROLE</label>
                        <select
                          id="invitation-role"
                          className="pxr-input"
                          value={newInvitationRole}
                          onChange={(e) => setNewInvitationRole(e.target.value as Role)}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="pxr-label" htmlFor="invitation-expiry">EXPIRES IN</label>
                        <select
                          id="invitation-expiry"
                          className="pxr-input"
                          value={newInvitationExpiry}
                          onChange={(e) => setNewInvitationExpiry(e.target.value)}
                        >
                          <option value="1">1 day</option>
                          <option value="7">7 days</option>
                          <option value="30">30 days</option>
                          <option value="90">90 days</option>
                          <option value="never">Never</option>
                        </select>
                      </div>
                      <div>
                        <button
                          type="button"
                          className="pxr-btn pxr-btn-primary"
                          disabled={creatingInvitation}
                          onClick={() => handleCreateInvitation()}
                        >
                          {creatingInvitation ? "Creating..." : "Create"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {invitations === null ? (
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
                ) : invitations.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No invitations created yet.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "var(--surface)" }}>
                      <thead>
                        <tr style={{ textAlign: "left" }}>
                          {["CODE", "EMAIL", "ROLE", "EXPIRES", "USED", ""].map((h, index) => (
                            <th key={h || index} className="mono" style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)", padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {invitations.map((inv) => {
                          const isExpired = inv.expiresAt && new Date(inv.expiresAt) < new Date();
                          const isUsed = !!inv.usedAt;
                          const invitationUrl = `${window.location.origin}/invitation?code=${inv.code}`;
                          return (
                            <tr key={inv.id}>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                                <code style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                                  {inv.code}
                                </code>
                              </td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                                {inv.email || "Anyone"}
                              </td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                                {inv.role}
                              </td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: isExpired ? "#B42318" : "var(--text-muted)" }}>
                                {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "Never"}
                                {isExpired && " (expired)"}
                              </td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                                {isUsed ? (
                                  <div>
                                    <div>{inv.usedByName || "Unknown"}</div>
                                    <div style={{ fontSize: 11, color: "var(--text-soft)" }}>
                                      {new Date(inv.usedAt!).toLocaleDateString()}
                                    </div>
                                  </div>
                                ) : "No"}
                              </td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                  <button
                                    type="button"
                                    className="pxr-btn"
                                    style={{ padding: "4px 8px", fontSize: 11 }}
                                    onClick={() => {
                                      navigator.clipboard.writeText(invitationUrl);
                                      showToast("Invitation link copied to clipboard");
                                    }}
                                    disabled={!!(isUsed || isExpired)}
                                  >
                                    Copy
                                  </button>
                                  <button
                                    type="button"
                                    className="pxr-btn"
                                    onClick={() => handleDeleteInvitation(inv.id)}
                                    title="Delete invitation"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {activeSection === "sso" && (
              <section>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                  <h2 className="pxr-section-title" style={{ margin: 0 }}>SINGLE SIGN-ON (OAUTH 2.0 + PKCE)</h2>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input ref={ssoFileInput} type="file" accept=".json,application/json" hidden aria-label="Import SSO JSON" onChange={e => {
                      const file = e.currentTarget.files?.[0]; e.currentTarget.value = "";
                      if (file) void importSso(file);
                    }} />
                    <button type="button" className="pxr-btn" disabled={ssoBusy || !sso} onClick={() => ssoFileInput.current?.click()}>Import JSON</button>
                    <button type="button" className="pxr-btn" disabled={ssoBusy || !sso} onClick={() => void exportSso()}>Export JSON</button>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>Export downloads the saved settings, including the client secret. Imported settings take effect after saving.</p>
                {sso === null ? (
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
                ) : (
                  <form onSubmit={submitSso} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 12 }}>
                    {SSO_FIELDS.map(([key, label]) => (
                      <div key={key}>
                        <label className="pxr-label" htmlFor={`sso-${key}`}>{label}</label>
                        <input id={`sso-${key}`} className="pxr-input" disabled={ssoBusy} value={sso[key] ?? ""} onChange={(e) => setSso({ ...sso, [key]: e.target.value })} />
                      </div>
                    ))}
                    <div>
                      <label className="pxr-label" htmlFor="sso-secret">
                        CLIENT SECRET · {sso.hasClientSecret ? "SET (WRITE-ONLY)" : "NOT SET"}
                      </label>
                      <input
                        id="sso-secret"
                        className="pxr-input"
                        type="password"
                        autoComplete="off"
                        value={newSecret}
                        disabled={clearSecret || ssoBusy}
                        onChange={(e) => setNewSecret(e.target.value)}
                        placeholder={sso.hasClientSecret ? "Leave empty to keep the current secret" : "Optional"}
                      />
                      {sso.hasClientSecret && (
                        <label className="pxr-check" style={{ marginTop: 6 }}>
                          <input type="checkbox" disabled={ssoBusy} checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} />
                          Remove the stored secret
                        </label>
                      )}
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <button type="submit" className="pxr-btn pxr-btn-primary" disabled={ssoBusy}>
                        Save SSO settings
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}
          </div>
        </main>
      </div>
      {deletePreview && <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !deleting) setDeletePreview(null); }} style={{ position: "fixed", inset: 0, zIndex: 1200, display: "grid", placeItems: "center", padding: 20, background: "rgba(0,0,0,.35)" }}>
        <section role="dialog" aria-modal="true" aria-labelledby="delete-user-title" style={{ width: "min(520px, 100%)", maxHeight: "85vh", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 5, padding: 22 }}>
          <h2 id="delete-user-title" style={{ font: "600 19px var(--font-serif)", margin: "0 0 6px" }}>Delete {deletePreview.user.displayName}?</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{deletePreview.user.email} · {deletePreview.user.status === "pending" ? "Pending" : "Active"}</p>
          <p style={{ fontSize: 13 }}>Their account, personal collections, providers, and lenses will be deleted. Organization papers remain. Comments and shared Lens results remain with the author shown as “Deleted user”. Their current votes are removed.</p>
          <p style={{ fontSize: 13 }}>If they sign in again through SSO, they will be a new pending member and need approval.</p>
          <ul style={{ fontSize: 12, color: "var(--text-muted)", paddingLeft: 20 }}>
            <li>{deletePreview.ownedCollections} owned collections and their links</li><li>{deletePreview.annotations} comments kept anonymously</li>
            <li>{deletePreview.personalLenses} personal lenses and {deletePreview.personalProviders} providers</li>
            <li>{deletePreview.privateLensAnnotations} private Lens results deleted; {deletePreview.sharedLensAnnotations} shared results kept anonymously</li>
          </ul>
          <label style={{ display: "grid", gap: 6, fontSize: 12, margin: "16px 0" }}>Type the user's email to confirm
            <input autoFocus value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} className="pxr-input" />
          </label>
          <div style={{ display: "flex", justifyContent: "end", gap: 8 }}><button type="button" className="pxr-btn" disabled={deleting} onClick={() => setDeletePreview(null)}>Cancel</button><button type="button" className="pxr-btn pxr-btn-primary" style={{ background: "#a32622" }} disabled={deleting || deleteConfirmation.trim().toLowerCase() !== deletePreview.user.email.toLowerCase()} onClick={() => void confirmDelete()}>{deleting ? "Deleting…" : "Delete user permanently"}</button></div>
        </section>
      </div>}
    </div>
  );
}
