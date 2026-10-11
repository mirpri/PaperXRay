import type { PageExtraction, RawTextItem } from "./types.js";
import { clusterLines } from "../reassembly/lines.js";

const MAX_TITLE_LENGTH = 500;
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const limit = (value: string) => Array.from(value).slice(0, MAX_TITLE_LENGTH).join("");
const comparable = (value: string) => clean(value).replace(/\.pdf$/i, "").replace(/[\s_-]+/g, " ").toLowerCase();

function usable(value: string): boolean {
  return Array.from(value).length >= 2 && /\p{L}/u.test(value)
    && !/^(untitled(?: document)?|document|title|no title|unknown|manuscript|microsoft word(?:\s.*)?|latex(?:\s.*)?)$/i.test(value)
    && !/\.(pdf|docx?|tex)$/i.test(value) && !/^https?:\/\//i.test(value);
}

/** Metadata first, then a conservative first-page layout heuristic, then the import filename. */
export function extractTitle(metadataTitles: unknown[], page: PageExtraction | undefined, filename = ""): string | null {
  for (const raw of metadataTitles) {
    if (typeof raw !== "string") continue;
    const title = clean(raw);
    if (usable(title) && comparable(title) !== comparable(filename)) return limit(title);
  }
  const inferred = page && titleFromPage(page);
  return inferred ?? (clean(filename) ? limit(clean(filename)) : null);
}

function textSize(items: RawTextItem[]): number {
  const weights = new Map<number, number>();
  for (const item of items) {
    const size = Math.round(item.fontSize * 2) / 2;
    weights.set(size, (weights.get(size) ?? 0) + item.str.trim().length);
  }
  return [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

function titleFromPage(page: PageExtraction): string | null {
  const items = page.items.filter(item => item.str.trim() && Number.isFinite(item.fontSize)
    && item.fontSize > 0 && item.width > 0 && item.height < item.width * 3);
  // Body text is usually below the author block; weighting by characters
  // avoids mistaking a font used only for short footnote markers for body text.
  const lower = items.filter(item => item.y < page.height * 0.6);
  const bodySize = textSize(lower.length ? lower : items);
  const candidates = items.filter(item => item.y > page.height * 0.35 && item.y < page.height * 0.96
    && item.fontSize >= Math.max(12, bodySize * 1.15));
  const lines = clusterLines(candidates, 1).map(line => ({ ...line, text: clean(line.items.map(item => item.str).join(" ")), size: textSize(line.items) }));
  const best = lines.filter(line => usable(line.text) && !/^(abstract|references|introduction|arxiv\b)/i.test(line.text))
    .sort((a, b) => b.size - a.size || b.y - a.y)[0];
  if (!best) return null;
  const start = lines.indexOf(best);
  let first = start, last = start;
  const adjacent = (a: typeof best, b: typeof best) => a.y - b.y <= best.size * 1.8
    && [a, b].every(line => line.size >= best.size * 0.8 && line.size <= best.size * 1.2)
    && (Math.abs(a.minX - b.minX) < best.size * 2 || Math.abs((a.minX + a.maxX) - (b.minX + b.maxX)) < best.size * 4);
  while (first > 0 && start - first < 3 && adjacent(lines[first - 1], lines[first])) first--;
  while (last + 1 < lines.length && last - first < 3 && adjacent(lines[last], lines[last + 1])) last++;
  const title = clean(lines.slice(first, last + 1).map(line => line.text).join(" "));
  return usable(title) ? limit(title) : null;
}
