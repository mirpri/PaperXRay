import { useEffect, useRef, useState } from "react";
import type { ModelProvider, ProviderDraft } from "@paper-xray/contracts";
import { deleteProvider, exportProvidersJson, fetchProviders, importProvidersJson, saveProvider, type ProviderImportItem } from "../api";
import { useAuth } from "../auth/AuthContext";
import { loadProviderKey, saveProviderKey } from "../personal/provider-keys";
import { useToast } from "../ToastContext";

const MAX_PROVIDERS_JSON_BYTES = 64 * 1024;

function parseProvidersJson(text: string): ProviderImportItem[] {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("Invalid JSON file."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Providers JSON must be an object with a 'providers' array.");
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.providers)) throw new Error("Providers JSON must contain a 'providers' array.");
  return obj.providers.map((item: unknown, i: number) => {
    if (!item || typeof item !== "object") throw new Error(`providers[${i}] must be an object.`);
    const p = item as Record<string, unknown>;
    if (typeof p.name !== "string" || !p.name.trim()) throw new Error(`providers[${i}].name must be a non-empty string.`);
    if (typeof p.baseUrl !== "string" || !p.baseUrl.trim()) throw new Error(`providers[${i}].baseUrl must be a non-empty string.`);
    if (!Array.isArray(p.models)) throw new Error(`providers[${i}].models must be an array.`);
    for (let j = 0; j < p.models.length; j++) {
      if (typeof p.models[j] !== "string") throw new Error(`providers[${i}].models[${j}] must be a string.`);
    }
    if (p.apiKey !== undefined && p.apiKey !== null && typeof p.apiKey !== "string") {
      throw new Error(`providers[${i}].apiKey must be a string or null.`);
    }
    return {
      name: p.name.trim(),
      baseUrl: p.baseUrl.trim(),
      models: p.models as string[],
      apiKey: (p.apiKey as string | null | undefined) ?? null,
    };
  });
}

export function ProviderSettings() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [providers, setProviders] = useState<ModelProvider[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [newOrg, setNewOrg] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { fetchProviders().then(setProviders).catch((err) => showToast(String(err), "error")); }, []);
  if (!user) return null;
  const current = providers?.find((p) => p.id === selected) ?? null;
  const org = current ? current.ownerId === null : newOrg;
  const readOnly = org && user.role !== "admin";

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await exportProvidersJson();
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url; link.download = "providers.json";
        document.body.appendChild(link); link.click(); link.remove();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setBusy(false); }
  }

  async function handleImport(file: File) {
    if (busy) return;
    setBusy(true);
    try {
      if (file.size > MAX_PROVIDERS_JSON_BYTES) throw new Error("Providers JSON must be 64 KB or smaller.");
      const items = parseProvidersJson(await file.text());
      if (items.length === 0) { showToast("No providers found in JSON file.", "error"); return; }
      if (!window.confirm(`Import ${items.length} provider(s)? This will replace all existing organization providers.`)) return;
      await importProvidersJson(items);
      const refreshed = await fetchProviders();
      setProviders(refreshed);
      setSelected(null);
      setNewOrg(false);
      showToast(`Imported ${items.length} provider(s).`);
    } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setBusy(false); }
  }

  function saved(provider: ModelProvider) {
    setProviders((items) => [...(items ?? []).filter((p) => p.id !== provider.id), provider]); setSelected(provider.id);
  }
  return <section>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
      <h2 className="pxr-section-title" style={{ margin: 0 }}>MODEL PROVIDERS</h2>
      {user.role === "admin" && <div style={{ display: "flex", gap: 6 }}>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Import providers JSON" onChange={e => {
          const file = e.currentTarget.files?.[0]; e.currentTarget.value = "";
          if (file) void handleImport(file);
        }} />
        <button type="button" className="pxr-btn" disabled={busy} onClick={() => fileInput.current?.click()}>Import JSON</button>
        <button type="button" className="pxr-btn" disabled={busy} onClick={() => void handleExport()}>Export JSON</button>
      </div>}
    </div>
    <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
      Set up providers here, then select a provider and model on the Lenses page. Organization keys stay on the server;
      personal keys stay in this browser, scoped to your account. Personal endpoints must allow this site's origin (CORS).
    </p>
    {providers === null ? <p>Loading providers…</p> : <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select className="pxr-input" style={{ flex: "1 1 240px" }} aria-label="Provider" value={selected ?? ""} onChange={(e) => setSelected(e.target.value || null)}>
          <option value="">New {newOrg ? "organization" : "personal"} provider</option>
          <optgroup label="Organization providers">{providers.filter((p) => p.ownerId === null).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          <optgroup label="My providers">{providers.filter((p) => p.ownerId === user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
        </select>
        <button className="pxr-btn" type="button" onClick={() => { setNewOrg(false); setSelected(null); }}>＋ My provider</button>
        {user.role === "admin" && <button className="pxr-btn" type="button" onClick={() => { setNewOrg(true); setSelected(null); }}>＋ Org provider</button>}
      </div>
      <ProviderEditor key={selected ?? `new-${org}`} provider={current} org={org} readOnly={readOnly} userId={user.id} onSaved={saved}
        onDeleted={(id) => { setProviders((items) => (items ?? []).filter((p) => p.id !== id)); setSelected(null); setNewOrg(false); }} />
    </>}
  </section>;
}
function ProviderEditor({ provider, org, readOnly, userId, onSaved, onDeleted }: {
  provider: ModelProvider | null; org: boolean; readOnly: boolean; userId: string;
  onSaved: (value: ModelProvider) => void; onDeleted: (id: string) => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [models, setModels] = useState(provider?.models.join("\n") ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasKey = org ? provider?.hasApiKey : provider && Boolean(loadProviderKey(userId, provider.id));
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const draft: ProviderDraft = { name, baseUrl, models: [...new Set(models.split(/[,\n]/).map((m) => m.trim()).filter(Boolean))] };
      if (org) draft.apiKey = clearKey ? null : apiKey.trim() || undefined;
      const result = await saveProvider(provider?.id ?? null, draft, org);
      if (!org && (clearKey || apiKey)) saveProviderKey(userId, result.id, clearKey ? "" : apiKey.trim());
      setApiKey(""); setClearKey(false); showToast("Provider saved."); onSaved(result);
    } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!provider || !window.confirm(`Delete provider "${provider.name}"?`)) return;
    setSaving(true);
    try { await deleteProvider(provider.id); if (!org) saveProviderKey(userId, provider.id, ""); onDeleted(provider.id); }
    catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setSaving(false); }
  }
  return <form onSubmit={save}>
    <p className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>{org ? "ORGANIZATION PROVIDER" : "MY PROVIDER · KEY IN THIS BROWSER"}{readOnly && " · ADMIN-MANAGED"}</p>
    <fieldset disabled={saving || readOnly} style={{ margin: 0, padding: 0, border: 0, display: "grid", gap: 12 }}>
      <div><label className="pxr-label" htmlFor="provider-name">PROVIDER NAME</label>
        <input id="provider-name" className="pxr-input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="pxr-label" htmlFor="provider-url">BASE URL</label>
        <input id="provider-url" className="pxr-input" type="url" required maxLength={512} placeholder="https://api.example.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></div>
      <div><label className="pxr-label" htmlFor="provider-models">AVAILABLE MODELS · OPTIONAL SUGGESTIONS, ONE PER LINE</label>
        <textarea id="provider-models" className="pxr-input" value={models} onChange={(e) => setModels(e.target.value)} placeholder={"model-one\nmodel-two"} /></div>
      {!readOnly && <div><label className="pxr-label" htmlFor="provider-key">API KEY{org ? " · SERVER ONLY" : " · BROWSER ONLY"}</label>
        <input id="provider-key" className="pxr-input" type="password" autoComplete="new-password" disabled={clearKey} maxLength={8192} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasKey ? "Leave blank to keep the stored key" : "Optional for keyless endpoints"} />
        {hasKey && <label className="pxr-check" style={{ marginTop: 8 }}><input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />Remove stored key</label>}
      </div>}
      {!readOnly && <div style={{ display: "flex", gap: 8 }}><button className="pxr-btn pxr-btn-primary" disabled={saving}>{saving ? "Saving…" : "Save provider"}</button>
        {provider && <button type="button" className="pxr-btn pxr-btn-danger" onClick={() => void remove()}>Delete</button>}</div>}
    </fieldset>
  </form>;
}
