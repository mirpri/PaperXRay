import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Role, SsoConfigPublic, User } from "@paper-xray/contracts";
import { fetchSsoConfig, fetchUsers, saveSsoConfig, setUserRole } from "../api";
import { useAuth } from "../auth/AuthContext";
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
];

/** Admin panel: roles (docs/02-decisions.md #4) and the org's OAuth2 SSO settings (#11). */
export function AdminPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [sso, setSso] = useState<SsoConfigPublic | null>(null);
  const [newSecret, setNewSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (me?.role !== "admin") return;
    fetchUsers().then(setUsers).catch((err) => setError(String(err)));
    fetchSsoConfig().then(setSso).catch((err) => setError(String(err)));
  }, [me?.role]);

  if (me?.role !== "admin") {
    return (
      <div style={{ minHeight: "100svh", background: "var(--bg)" }}>
        <Header />
        <main style={{ maxWidth: 880, margin: "0 auto", padding: "32px 24px", fontSize: 13 }}>
          Only admins can open this page. <Link to="/">Back to the library</Link>
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

  async function submitSso(e: React.FormEvent) {
    e.preventDefault();
    if (!sso) return;
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
    }
  }

  return (
    <div style={{ minHeight: "100svh", background: "var(--bg)" }}>
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
      <main style={{ maxWidth: 880, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 32 }}>
        {error && <p style={{ color: "crimson", fontSize: 13, margin: 0 }}>{error}</p>}
        {notice && <p style={{ color: "var(--human)", fontSize: 13, margin: 0 }}>{notice}</p>}

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
          <h2 className="pxr-section-title">SINGLE SIGN-ON (OAUTH 2.0 + PKCE)</h2>
          {sso === null ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
          ) : (
            <form onSubmit={submitSso} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              {SSO_FIELDS.map(([key, label]) => (
                <div key={key}>
                  <label className="pxr-label" htmlFor={`sso-${key}`}>{label}</label>
                  <input id={`sso-${key}`} className="pxr-input" value={sso[key]} onChange={(e) => setSso({ ...sso, [key]: e.target.value })} />
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
                  disabled={clearSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                  placeholder={sso.hasClientSecret ? "Leave empty to keep the current secret" : "Optional"}
                />
                {sso.hasClientSecret && (
                  <label className="pxr-check" style={{ marginTop: 6 }}>
                    <input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} />
                    Remove the stored secret
                  </label>
                )}
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <button type="submit" className="pxr-btn pxr-btn-primary">
                  Save SSO settings
                </button>
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
