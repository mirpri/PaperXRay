import type { Annotation } from "@paper-xray/contracts";
import { isAgentAnnotation } from "@paper-xray/contracts";

/** Display controls filter by group, without a per-lens count limit. */
export interface DisplaySettings {
  /** Group keys (a lens id, or "human") switched off. */
  hiddenGroups: string[];
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  hiddenGroups: [],
};

export const HUMAN_GROUP = "human";

export function groupKey(a: Annotation): string {
  return isAgentAnnotation(a) ? a.agentId : HUMAN_GROUP;
}

export interface DisplayResult {
  visible: Annotation[];
  hiddenByGroup: number;
}

export function applyDisplayFilter(annotations: Annotation[], settings: DisplaySettings): DisplayResult {
  const hiddenGroups = new Set(settings.hiddenGroups);
  let hiddenByGroup = 0;

  const candidates: Annotation[] = [];
  for (const a of annotations) {
    if (hiddenGroups.has(groupKey(a))) {
      hiddenByGroup++;
      continue;
    }
    candidates.push(a);
  }

  return {
    visible: candidates,
    hiddenByGroup,
  };
}

export interface PageDensity {
  page: number;
  agent: number;
  colors?: Record<string, number>;
  human: number;
}

/** Visible annotations per page, for the margin density bar. An annotation spanning pages counts once on each page it touches. */
export function pageDensity(
  highlights: ReadonlyArray<{ annotationId: string; isAgent: boolean; color?: string; position: { boundingRect: { pageNumber: number } } }>,
  pageCount: number,
): PageDensity[] {
  const pages: PageDensity[] = Array.from({ length: pageCount }, (_, i) => ({ page: i + 1, agent: 0, human: 0 }));
  const seen = new Set<string>();
  for (const h of highlights) {
    const page = h.position.boundingRect.pageNumber;
    const key = `${h.annotationId}:${page}`;
    if (seen.has(key) || page < 1 || page > pageCount) continue;
    seen.add(key);
    if (h.color) {
      const counts = pages[page - 1].colors ??= {};
      counts[h.color] = (counts[h.color] ?? 0) + 1;
    }
    if (h.isAgent) pages[page - 1].agent++;
    else pages[page - 1].human++;
  }
  return pages;
}

/** Per-viewer convenience only; falls back to the defaults whenever storage is unavailable. */
export function loadDisplaySettings(): DisplaySettings {
  return DEFAULT_DISPLAY_SETTINGS;
}

/** Group toggles are per document and deliberately not remembered. */
export function saveDisplaySettings(_settings: DisplaySettings): void {
  // no-op: nothing to persist after removing the confidence filter
}
