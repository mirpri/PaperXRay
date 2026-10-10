import type { DisplayResult, DisplaySettings } from "../pdf/display-filter";

/** Optional summary for hidden groups; group selection lives in the Lens chips. */
export function DisplayControls({ result, onShowEverything }: {
  settings: DisplaySettings;
  result: DisplayResult;
  onChange: (settings: DisplaySettings) => void;
  onShowEverything: () => void;
}) {
  if (!result.hiddenByGroup) return null;
  return (
    <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)" }}>
      {result.hiddenByGroup} hidden ·{" "}
      <button onClick={onShowEverything} style={{ border: 0, padding: 0, background: "none", color: "var(--human)", fontSize: 11 }}>
        show all
      </button>
    </div>
  );
}
