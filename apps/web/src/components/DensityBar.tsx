import type { PageDensity } from "../pdf/display-filter";

/**
 * Page-margin density strip (README "防刷屏"): one cell per page, shaded by
 * how many visible annotations sit on it (agent in yellow, human in blue),
 * so a reader can see where the marks cluster without scrolling. Click a
 * cell to jump to that page.
 */
export function DensityBar({
  density,
  currentPage,
  onGoToPage,
}: {
  density: PageDensity[];
  currentPage: number | null;
  onGoToPage: (page: number) => void;
}) {
  const max = Math.max(1, ...density.map((d) => d.agent + d.human));

  return (
    <div
      aria-label="Annotations per page"
      style={{
        width: 14,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        padding: "4px 2px",
        background: "var(--panel)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      {density.map((d) => {
        const total = d.agent + d.human;
        const agentShare = total === 0 ? 0 : d.agent / total;
        const strength = total === 0 ? 0 : 0.25 + 0.75 * (total / max);
        return (
          <button
            key={d.page}
            onClick={() => onGoToPage(d.page)}
            title={`Page ${d.page}: ${d.agent} lens, ${d.human} human`}
            aria-label={`Page ${d.page}: ${d.agent} lens annotations, ${d.human} human notes`}
            style={{
              flex: 1,
              minHeight: 3,
              padding: 0,
              border: 0,
              borderRadius: 1,
              outline: d.page === currentPage ? "1px solid var(--text)" : "none",
              background:
                total === 0
                  ? "#E2E2E2"
                  : `linear-gradient(to right, var(--agent) ${agentShare * 100}%, var(--human) ${agentShare * 100}%)`,
              opacity: total === 0 ? 1 : strength,
            }}
          />
        );
      })}
    </div>
  );
}
