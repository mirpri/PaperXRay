import type { Annotation, Severity } from "@paper-xray/contracts";
import { isAgentAnnotation } from "@paper-xray/contracts";

/**
 * Anti-flooding controls (README "防刷屏"): several lenses on one paper can
 * produce a hundred marks. By default only confident agent annotations are
 * shown, each lens is capped, and each lens (or all human notes) can be
 * switched off as a group. Human annotations are never confidence-filtered
 * or capped — someone wrote each of them on purpose.
 */
export interface DisplaySettings {
  /** Agent annotations below this confidence are hidden. 0 shows all. */
  minConfidence: number;
  /** At most this many agent annotations per lens, most severe/confident first. */
  perLensCap: number;
  /** Group keys (a lens id, or "human") switched off. */
  hiddenGroups: string[];
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  minConfidence: 0.5,
  perLensCap: 5,
  hiddenGroups: [],
};

export const SHOW_EVERYTHING: Omit<DisplaySettings, "hiddenGroups"> = { minConfidence: 0, perLensCap: Infinity };

export const HUMAN_GROUP = "human";

export function groupKey(a: Annotation): string {
  return isAgentAnnotation(a) ? a.agentId : HUMAN_GROUP;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };

export interface DisplayResult {
  visible: Annotation[];
  hiddenByGroup: number;
  hiddenByConfidence: number;
  hiddenByCap: number;
}

export function applyDisplayFilter(annotations: Annotation[], settings: DisplaySettings): DisplayResult {
  const hiddenGroups = new Set(settings.hiddenGroups);
  let hiddenByGroup = 0;
  let hiddenByConfidence = 0;
  let hiddenByCap = 0;

  const candidates: Annotation[] = [];
  for (const a of annotations) {
    if (hiddenGroups.has(groupKey(a))) {
      hiddenByGroup++;
      continue;
    }
    if (isAgentAnnotation(a) && a.confidence < settings.minConfidence) {
      hiddenByConfidence++;
      continue;
    }
    candidates.push(a);
  }

  // Pick which agent annotations survive the per-lens cap: most severe,
  // then most confident, then earliest.
  const keep = new Set<string>();
  const byLens = new Map<string, Annotation[]>();
  for (const a of candidates) {
    if (!isAgentAnnotation(a)) {
      keep.add(a.id);
      continue;
    }
    const list = byLens.get(a.agentId) ?? [];
    list.push(a);
    byLens.set(a.agentId, list);
  }
  for (const list of byLens.values()) {
    const ranked = [...list].sort((x, y) => {
      if (!isAgentAnnotation(x) || !isAgentAnnotation(y)) return 0;
      return SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity] || y.confidence - x.confidence;
    });
    ranked.forEach((a, i) => {
      if (i < settings.perLensCap) keep.add(a.id);
      else hiddenByCap++;
    });
  }

  return {
    visible: candidates.filter((a) => keep.has(a.id)),
    hiddenByGroup,
    hiddenByConfidence,
    hiddenByCap,
  };
}

export interface PageDensity {
  page: number;
  agent: number;
  human: number;
}

/** Visible annotations per page, for the margin density bar. An annotation spanning pages counts once on each page it touches. */
export function pageDensity(
  highlights: ReadonlyArray<{ annotationId: string; isAgent: boolean; position: { boundingRect: { pageNumber: number } } }>,
  pageCount: number,
): PageDensity[] {
  const pages: PageDensity[] = Array.from({ length: pageCount }, (_, i) => ({ page: i + 1, agent: 0, human: 0 }));
  const seen = new Set<string>();
  for (const h of highlights) {
    const page = h.position.boundingRect.pageNumber;
    const key = `${h.annotationId}:${page}`;
    if (seen.has(key) || page < 1 || page > pageCount) continue;
    seen.add(key);
    if (h.isAgent) pages[page - 1].agent++;
    else pages[page - 1].human++;
  }
  return pages;
}

const STORAGE_KEY = "pxr.displaySettings";

/** Per-viewer convenience only; falls back to the defaults whenever storage is unavailable. */
export function loadDisplaySettings(): DisplaySettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DISPLAY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
    return {
      minConfidence: typeof parsed.minConfidence === "number" ? parsed.minConfidence : DEFAULT_DISPLAY_SETTINGS.minConfidence,
      perLensCap: typeof parsed.perLensCap === "number" ? parsed.perLensCap : DEFAULT_DISPLAY_SETTINGS.perLensCap,
      hiddenGroups: [],
    };
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
}

/** Saves the threshold and cap. Group toggles are per document and deliberately not remembered. */
export function saveDisplaySettings(settings: DisplaySettings): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ minConfidence: settings.minConfidence, perLensCap: settings.perLensCap }),
    );
  } catch {
    // storage unavailable (private window, blocked site data): settings just won't persist
  }
}
