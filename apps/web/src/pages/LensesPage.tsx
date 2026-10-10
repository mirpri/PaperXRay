import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LensDraft, LensScope, LensSpec, ModelProvider } from "@paper-xray/contracts";
import { LENS_SCOPES, MAX_ANNOTATIONS_LIMIT, LENS_COLORS, lensColor } from "@paper-xray/contracts";
import { createLens, deleteLens, fetchLenses, fetchProviders, updateLens } from "../api";
import { useAuth } from "../auth/AuthContext";
import { Header } from "../components/Header";

const SCOPE_LABELS: Record<LensScope, string> = {
  all: "Whole paper",
  section: "Sections",
  paragraph: "Paragraphs",
  equation: "Equations",
  figure: "Figures",
  table: "Tables",
  caption: "Captions",
};

const EMPTY_DRAFT: LensDraft = {
  color: LENS_COLORS[0].value,
  name: "",
  description: "",
  scope: "all",
  instruction: "",
  maxAnnotations: 6,
  strictScope: false,
  shareRunsWithOrg: false,
  providerId: null, model: null,
};

/** Which lens the editor is showing: an existing one, or a new one (org or personal). */
type Selection = { kind: "existing"; id: string } | { kind: "new"; org: boolean } | null;

function draftFrom(spec: LensSpec): LensDraft {
  return {
    providerId: spec.providerId ?? null, model: spec.model ?? null,
    color: lensColor(spec.id, spec.color),
    name: spec.name,
    description: spec.description,
    scope: spec.scope,
    instruction: spec.instruction,
    maxAnnotations: spec.maxAnnotations,
    strictScope: spec.strictScope,
    shareRunsWithOrg: spec.shareRunsWithOrg,
  };
}

/**
 * Lens settings (design/02-lens-config.html): org lenses, edited by
 * curators and run on the server; personal lenses, which run in this
 * browser against the user's own model endpoint (docs/02-decisions.md #6).
 */
export function LensesPage() {
  const { user } = useAuth();
  const editorRef = useRef<HTMLElement>(null);
  const canEditOrg = user?.role === "curator" || user?.role === "admin";

  const [lenses, setLenses] = useState<LensSpec[] | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState<LensDraft>(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [providers, setProviders] = useState<ModelProvider[]>([]);

  useEffect(() => {
    fetchProviders().then(setProviders).catch((err) => setError(String(err)));
    fetchLenses()
      .then(setLenses)
      .catch((err) => setError(String(err)));
  }, []);

  const orgLenses = lenses?.filter((l) => l.ownerId === null) ?? [];
  const myLenses = lenses?.filter((l) => l.ownerId !== null) ?? [];
  const selected = selection?.kind === "existing" ? lenses?.find((l) => l.id === selection.id) ?? null : null;
  const isOrg = selection?.kind === "new" ? selection.org : selected?.ownerId === null;
  const readOnly = isOrg && !canEditOrg;

  function select(next: Selection) {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setSelection(next);
    editorRef.current?.scrollTo({ top: 0 });
    setError(null);
    setNotice(null);
    setDirty(false);
    if (next?.kind === "existing") {
      const spec = lenses?.find((l) => l.id === next.id);
      if (spec) setDraft(draftFrom(spec));
    } else {
      const used = new Set((lenses ?? []).map(l => lensColor(l.id, l.color)));
      setDraft({ ...EMPTY_DRAFT, color: (LENS_COLORS.find(c => !used.has(c.value)) ?? LENS_COLORS[(lenses?.length ?? 0) % LENS_COLORS.length]).value });
    }
  }

  function edit<K extends keyof LensDraft>(key: K, value: LensDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  async function save() {
    if (!selection) return;
    setSaving(true);
    setError(null);
    try {
      const saved =
        selection.kind === "new" ? await createLens(draft, selection.org) : await updateLens(selection.id, draft);
      setLenses((current) => {
        const rest = (current ?? []).filter((l) => l.id !== saved.id);
        return [...rest, saved].sort((a, b) => Number(a.ownerId !== null) - Number(b.ownerId !== null));
      });
      setSelection({ kind: "existing", id: saved.id });
      setDraft(draftFrom(saved));
      setDirty(false);
      setNotice(selection.kind === "new" ? "Lens created." : `Saved as version ${saved.version}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete "${selected.name}"? Annotations it already produced are kept.`)) return;
    try {
      await deleteLens(selected.id);
      setLenses((current) => (current ?? []).filter((l) => l.id !== selected.id));
      setSelection(null);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
            <span style={{ fontSize: 13, fontWeight: 500 }}>Lenses</span>
          </div>
        }
      />

      <div className="pxr-lenses-layout">
        <nav className="pxr-lenses-nav pxr-settings-scroll" aria-label="Lens catalog">
          <LensList
            title="ORG LENSES"
            hint={canEditOrg ? "You can edit these" : "Maintained by curators"}
            lenses={orgLenses}
            selectedId={selection?.kind === "existing" ? selection.id : null}
            onSelect={(id) => select({ kind: "existing", id })}
            onNew={canEditOrg ? () => select({ kind: "new", org: true }) : undefined}
          />
          <LensList
            title="MY LENSES"
            hint="Your personal lenses"
            lenses={myLenses}
            selectedId={selection?.kind === "existing" ? selection.id : null}
            onSelect={(id) => select({ kind: "existing", id })}
            onNew={() => select({ kind: "new", org: false })}
          />
          {lenses === null && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading…</p>}
        </nav>

        <main ref={editorRef} className="pxr-lenses-main pxr-settings-scroll" aria-label="Lens configuration">
          <div className="pxr-lenses-editor">
          {error && <p style={{ color: "crimson", fontSize: 13, marginTop: 0 }}>{error}</p>}
          {notice && <p style={{ color: "var(--human)", fontSize: 13, marginTop: 0 }}>{notice}</p>}

          {selection === null ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Pick a lens to view or edit it, or create a personal lens of your own.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div>
                <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>
                  {selection.kind === "new" ? (isOrg ? "New org lens" : "New personal lens") : selected?.name}
                </h1>
                <p className="mono" style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>
                  {isOrg ? "ORG LENS" : "PERSONAL LENS"}
                  {selected && ` · v${selected.version}`}
                  {!readOnly && " · saving bumps the version; earlier annotations keep theirs"}
                </p>
              </div>

              <fieldset disabled={readOnly || saving} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label className="pxr-label" htmlFor="lens-name">NAME</label>
                  <input id="lens-name" className="pxr-input" value={draft.name} maxLength={120} required onChange={(e) => edit("name", e.target.value)} />
                </div>
                <div>
                  <span className="pxr-label" id="lens-color-label">COLOR</span>
                  <div role="group" aria-labelledby="lens-color-label" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {LENS_COLORS.map(color => <button key={color.value} type="button"
                      title={color.name} aria-label={color.name} aria-pressed={draft.color === color.value}
                      onClick={() => edit("color", color.value)}
                      style={{ width: 32, height: 32, borderRadius: 6, background: color.value, color: "#fff",
                        border: "2px solid var(--surface)", outline: draft.color === color.value ? `2px solid ${color.value}` : "2px solid transparent", cursor: "pointer" }}>
                      {draft.color === color.value ? "✓" : ""}
                    </button>)}
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 0 0" }}>
                    {LENS_COLORS.find(c => c.value === draft.color)?.name} · Used for labels, annotation cards and PDF highlights.
                  </p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 12 }}>
                  <div><label className="pxr-label" htmlFor="lens-provider">PROVIDER</label>
                    <select id="lens-provider" className="pxr-input" value={draft.providerId ?? ""} onChange={(e) => {
                      const provider = providers.find((p) => p.id === e.target.value);
                      setDraft((d) => ({ ...d, providerId: provider?.id ?? null, model: provider?.models[0] ?? null })); setDirty(true);
                    }}>
                      <option value="">Select a provider</option>
                      <optgroup label="Organization providers">{providers.filter((p) => p.ownerId === null).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
                      {!isOrg && <optgroup label="My providers">{providers.filter((p) => p.ownerId === user?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
                    </select>
                  </div>
                  <div><label className="pxr-label" htmlFor="lens-model">MODEL</label>
                    <input id="lens-model" className="pxr-input" list="lens-model-suggestions" disabled={!draft.providerId}
                      required={Boolean(draft.providerId)} maxLength={255} placeholder="Select or enter a model"
                      value={draft.model ?? ""} onChange={(e) => edit("model", e.target.value)} />
                    <datalist id="lens-model-suggestions">
                      {(providers.find((p) => p.id === draft.providerId)?.models ?? []).map((model) => <option key={model} value={model} />)}
                    </datalist>
                  </div>
                  <Link to="/admin" style={{ fontSize: 12, gridColumn: "1 / -1" }}>Manage providers →</Link>
                </div>
                <div>
                  <label className="pxr-label" htmlFor="lens-description">DESCRIPTION</label>
                  <input id="lens-description" className="pxr-input" value={draft.description} maxLength={500} onChange={(e) => edit("description", e.target.value)} />
                </div>
                <div>
                  <span className="pxr-label">SCOPE</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {LENS_SCOPES.map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        className={`pxr-btn${draft.scope === scope ? " pxr-btn-primary" : ""}`}
                        onClick={() => edit("scope", scope)}
                        aria-pressed={draft.scope === scope}
                      >
                        {SCOPE_LABELS[scope]}
                      </button>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "6px 0 0" }}>
                    Only paragraphs are detected so far; other scopes will match nothing until section/table/figure detection lands.
                  </p>
                </div>
                <div>
                  <label className="pxr-label" htmlFor="lens-instruction">INSTRUCTION</label>
                  <textarea
                    id="lens-instruction"
                    className="pxr-input"
                    value={draft.instruction}
                    minLength={10}
                    maxLength={4000}
                    required
                    onChange={(e) => edit("instruction", e.target.value)}
                    placeholder="What should this lens look for? Ask it to only flag places it can quote from the paper."
                  />
                </div>
                <div style={{ width: 160 }}>
                  <label className="pxr-label" htmlFor="lens-max">MAX / DOC</label>
                  <input
                    id="lens-max"
                    className="pxr-input"
                    type="number"
                    min={1}
                    max={MAX_ANNOTATIONS_LIMIT}
                    value={draft.maxAnnotations}
                    onChange={(e) => edit("maxAnnotations", Number(e.target.value))}
                  />
                </div>
                <div>
                  <span className="pxr-label">OUTPUT CONTRACT</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <label className="pxr-check">
                      <input type="checkbox" checked disabled />
                      Every annotation must quote the paper; the server re-checks every quote (always on).
                    </label>
                    <label className="pxr-check">
                      <input type="checkbox" checked={draft.strictScope} onChange={(e) => edit("strictScope", e.target.checked)} />
                      Drop evidence outside the scope, instead of keeping it as low-confidence info.
                    </label>
                    {!isOrg && (
                      <label className="pxr-check">
                        <input
                          type="checkbox"
                          checked={draft.shareRunsWithOrg}
                          onChange={(e) => edit("shareRunsWithOrg", e.target.checked)}
                        />
                        Share new runs with the org (default: only you see them; you can switch each run later).
                      </label>
                    )}
                  </div>
                </div>
              </fieldset>

              {!readOnly && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" className="pxr-btn pxr-btn-primary" disabled={saving || (!dirty && selection.kind === "existing")}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  {selected && (
                    <button type="button" className="pxr-btn pxr-btn-danger" onClick={remove}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </form>
          )}


          </div>
        </main>
      </div>
    </div>
  );
}

function LensList(props: {
  title: string;
  hint: string;
  lenses: LensSpec[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew?: () => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 className="pxr-section-title">{props.title}</h2>
        <span style={{ fontSize: 10, color: "var(--text-soft)" }}>{props.hint}</span>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {props.lenses.map((lens) => (
          <li key={lens.id}>
            <button
              type="button"
              onClick={() => props.onSelect(lens.id)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                border: "1px solid",
                borderColor: lens.id === props.selectedId ? "var(--text)" : "var(--border-strong)",
                borderRadius: 3,
                background: "var(--surface)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 7 }}><span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: lensColor(lens.id, lens.color), flexShrink: 0 }} />{lens.name}</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                SCOPE {lens.scope} · v{lens.version}
              </div>
            </button>
          </li>
        ))}
        {props.lenses.length === 0 && <li style={{ fontSize: 12, color: "var(--text-soft)" }}>None yet.</li>}
      </ul>
      {props.onNew && (
        <button type="button" className="pxr-btn" style={{ marginTop: 8, width: "100%" }} onClick={props.onNew}>
          ＋ New lens
        </button>
      )}
    </div>
  );
}
