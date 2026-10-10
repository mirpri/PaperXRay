import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Role, SsoConfigPublic, User } from "@paper-xray/contracts";
import { exportSsoConfigJson, fetchSsoConfig, fetchUsers, saveSsoConfig, setUserRole } from "../api";
import { useAuth } from "../auth/AuthContext";
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

/** Admin panel: roles (docs/02-decisions.md #4) and the org's OAuth2 SSO settings (#11). */
export function AdminPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [sso, setSso] = useState<SsoConfigPublic | null>(null);
  const [newSecret, setNewSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);
  const ssoFileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (me?.role !== "admin") return;
    fetchUsers().then(setUsers).catch((err) => setError(String(err)));
    fetchSsoConfig().then(setSso).catch((err) => setError(String(err)));
  }, [me?.role]);

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
    setError(null);
    setNotice(null);
    try {
      const updated = await setUserRole(user.id, role);
      setUsers((current) => (current ?? []).map((u) => (u.id === updated.id ? updated : u)));
      setNotice(`${updated.displayName} is now ${updated.role}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function importSso(file: File) {
    if (ssoBusy) return;
    setSsoBusy(true); setError(null); setNotice(null);
    try {
      if (file.size > MAX_SSO_JSON_BYTES) throw new Error("SSO JSON must be 64 KB or smaller.");
      const { clientSecret, ...fields } = parseSsoConfigJson(await file.text());
      setSso({ ...fields, accountManagementUrl: fields.accountManagementUrl ?? "", hasClientSecret: sso?.hasClientSecret ?? false });
      setNewSecret(clientSecret ?? "");
      setClearSecret(clientSecret === null || clientSecret === "");
      setNotice("JSON imported. Save SSO settings to apply.");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSsoBusy(false); }
  }

  async function exportSso() {
    if (ssoBusy) return;
    setSsoBusy(true); setError(null); setNotice(null);
    try {
      const blob = await exportSsoConfigJson();
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url; link.download = "sso-config.json";
        document.body.appendChild(link); link.click(); link.remove();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSsoBusy(false); }
  }

  async function submitSso(e: React.FormEvent) {
    e.preventDefault();
    if (!sso || ssoBusy) return;
    setSsoBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { hasClientSecret: _ignored, ...fields } = sso;
      const saved = await saveSsoConfig({
        ...fields,
        clientSecret: clearSecret ? null : newSecret ? newSecret : undefined,
      });
      setSso(saved);
      setNewSecret("");
      setClearSecret(false);
      setNotice("SSO settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      <main className="pxr-admin-main pxr-settings-scroll">
        <div className="pxr-admin-content">
        {error && <p style={{ color: "crimson", fontSize: 13, margin: 0 }}>{error}</p>}
        {notice && <p style={{ color: "var(--human)", fontSize: 13, margin: 0 }}>{notice}</p>}

        <ProviderSettings />

        <section>
          <h2 className="pxr-section-title">USERS & ROLES</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
            SSO only provides identity; roles are set here. Users appear after their first login.
          </p>
          {users === null ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "var(--surface)" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    {["NAME", "EMAIL", "ROLE"].map((h) => (
                      <th key={h} className="mono" style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)", padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

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
        </div>
      </main>
    </div>
  );
}
