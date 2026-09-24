import { lineText, type Line } from "./lines.js";

/**
 * Strips running headers/footers: lines whose text repeats across most
 * pages at nearly the same y-coordinate (docs/01-nabcd-architecture.md
 * "三个关键技术难点" #1 step 4: "跨页出现在相同 y 区间且内容相似的行，剔除").
 * Needs at least 3 pages to distinguish "repeats because it's a
 * header/footer" from "repeats because the document happens to reuse a
 * phrase".
 */
export function stripHeaderFooter(pages: Line[][]): Line[][] {
  if (pages.length < 3) return pages;

  const byText = new Map<string, { pages: Set<number>; ys: number[] }>();
  pages.forEach((lines, pageIndex) => {
    for (const line of lines) {
      const text = lineText(line).trim();
      if (!text) continue;
      const entry = byText.get(text) ?? { pages: new Set<number>(), ys: [] };
      entry.pages.add(pageIndex);
      entry.ys.push(line.y);
      byText.set(text, entry);
    }
  });

  const repeating = new Set<string>();
  const threshold = Math.ceil(pages.length * 0.6);
  for (const [text, entry] of byText) {
    const ySpread = Math.max(...entry.ys) - Math.min(...entry.ys);
    if (entry.pages.size >= threshold && ySpread < 5) {
      repeating.add(text);
    }
  }

  if (repeating.size === 0) return pages;
  return pages.map((lines) => lines.filter((line) => !repeating.has(lineText(line).trim())));
}
