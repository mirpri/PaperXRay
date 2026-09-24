interface FilterChipProps {
  label: string;
  count: number;
  active: boolean;
  /** false = this lens hasn't produced any annotations for this document yet (dashed, click to run). true = normal toggle-filter chip. Always true for "All" and "Human". */
  ready: boolean;
  loading: boolean;
  onClick: () => void;
}

/** Filter chip in the annotations sidebar. Lens chips that haven't been run yet render dashed and act as a "run this lens" button instead of a filter toggle — see pages/ReaderPage.tsx. */
export function FilterChip({ label, count, active, ready, loading, onClick }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={ready ? undefined : `Run ${label}`}
      style={{
        fontSize: 11,
        padding: "5px 10px",
        borderRadius: 3,
        border: active ? "1px solid var(--text)" : ready ? "1px solid var(--border-strong)" : "1px dashed #B0B0B0",
        background: active ? "var(--text)" : "var(--surface)",
        color: active ? "#FFFFFF" : ready ? "#3C3C3C" : "var(--text-muted)",
        opacity: loading ? 0.6 : 1,
      }}
    >
      {loading ? `${label} …` : ready ? `${label} ${count}` : `${label} · run`}
    </button>
  );
}
