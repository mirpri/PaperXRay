interface FilterChipProps {
  label: string;
  color?: string;
  count: number;
  /** Whether this group's annotations are currently shown. */
  active: boolean;
  /** false = this lens hasn't run on this document yet (dashed, click to run). true = a show/hide toggle. Always true for "Human". */
  ready: boolean;
  loading: boolean;
  onClick: () => void;
  /** Marks personal lenses, which run in the browser. */
  personal?: boolean;
  /** When set, a small ↻ button re-runs the lens. */
  onRerun?: () => void;
}

/** Group toggle in the annotations sidebar. Lens chips that haven't been run yet render dashed and act as a "run this lens" button instead — see pages/ReaderPage.tsx. */
export function FilterChip({ label, count, active, ready, loading, onClick, personal, onRerun, color }: FilterChipProps) {
  const text = personal ? `${label} (mine)` : label;
  return (
    <span style={{ display: "inline-flex" }}>
      <button
        onClick={onClick}
        disabled={loading}
        aria-busy={loading}
        aria-pressed={ready ? active : undefined}
        title={ready ? (active ? `Hide ${label}` : `Show ${label}`) : `Run ${label}${personal ? " in this browser" : ""}`}
        style={{
          fontSize: 11,
          padding: "5px 10px",
          borderRadius: onRerun ? "3px 0 0 3px" : 3,
          border: color && active && ready ? `1px solid ${color}` : active && ready ? "1px solid var(--text)" : ready ? "1px solid var(--border-strong)" : "1px dashed #B0B0B0",
          background: color && active && ready ? `${color}1F` : active && ready ? "var(--text)" : "var(--surface)",
          color: color ? "var(--text)" : active && ready ? "#FFFFFF" : ready ? "#3C3C3C" : "var(--text-muted)",
          opacity: loading ? 0.6 : 1,
        }}
      >
        {color && <span aria-hidden="true" style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: color, marginRight: 6 }} />}
        {loading ? `${text} …` : ready ? `${text} ${count}` : `${text} · run`}
      </button>
      {onRerun && (
        <button
          onClick={onRerun}
          disabled={loading}
          title={`Run ${label} again`}
          aria-label={`Run ${label} again`}
          style={{
            fontSize: 11,
            padding: "5px 7px",
            borderRadius: "0 3px 3px 0",
            border: "1px solid var(--border-strong)",
            borderLeft: 0,
            background: color && active ? `${color}1F` : "var(--surface)",
            color: color ?? "var(--text-muted)",
          }}
        >
          ↻
        </button>
      )}
    </span>
  );
}
