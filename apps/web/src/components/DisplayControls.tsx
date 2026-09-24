import type { DisplayResult, DisplaySettings } from "../pdf/display-filter";

const CONFIDENCE_STEPS = [0, 0.3, 0.5, 0.7, 0.9];
const CAP_STEPS = [3, 5, 10, Infinity];

/** Confidence threshold + per-lens cap, and a count of what they're hiding (README "防刷屏"). */
export function DisplayControls({
  settings,
  result,
  onChange,
  onShowEverything,
}: {
  settings: DisplaySettings;
  result: DisplayResult;
  onChange: (settings: DisplaySettings) => void;
  onShowEverything: () => void;
}) {
  const hiddenByFilters = result.hiddenByConfidence + result.hiddenByCap;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-muted)",
      }}
    >
      <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
        Confidence ≥
        <select
          value={settings.minConfidence}
          onChange={(e) => onChange({ ...settings, minConfidence: Number(e.target.value) })}
          style={{ fontSize: 11, height: 24 }}
        >
          {CONFIDENCE_STEPS.map((c) => (
            <option key={c} value={c}>
              {c === 0 ? "any" : c.toFixed(1)}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
        Max per lens
        <select
          value={Number.isFinite(settings.perLensCap) ? settings.perLensCap : "all"}
          onChange={(e) => onChange({ ...settings, perLensCap: e.target.value === "all" ? Infinity : Number(e.target.value) })}
          style={{ fontSize: 11, height: 24 }}
        >
          {CAP_STEPS.map((c) => (
            <option key={c} value={Number.isFinite(c) ? c : "all"}>
              {Number.isFinite(c) ? c : "all"}
            </option>
          ))}
        </select>
      </label>
      {hiddenByFilters > 0 && (
        <span>
          {hiddenByFilters} hidden ·{" "}
          <button
            onClick={onShowEverything}
            style={{ border: 0, padding: 0, background: "none", color: "var(--human)", fontSize: 11 }}
          >
            show all
          </button>
        </span>
      )}
    </div>
  );
}
