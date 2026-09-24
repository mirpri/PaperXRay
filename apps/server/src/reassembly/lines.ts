import type { RawTextItem } from "../extraction/types.js";

export interface Line {
  page: number;
  items: RawTextItem[];
  /** Representative y (of the first item encountered during clustering). */
  y: number;
  minX: number;
  maxX: number;
  fontSize: number;
}

export function lineText(line: Line): string {
  return line.items.map((i) => i.str).join(" ");
}

/**
 * Groups a page's text items into visual lines by y-coordinate proximity,
 * per docs/01-nabcd-architecture.md "三个关键技术难点" #1 step 1: "按
 * transform 的 y 值聚类，容差取字号的一个比例".
 *
 * Single-column assumption: sorting globally by (y desc, x asc) only
 * produces correct reading order for single-column pages. On a two-column
 * page this will interleave left/right column text at the same height into
 * one "line" — an explicitly sanctioned degradation for now (see
 * docs/01-nabcd-architecture.md "风险与降级": "先只支持单栏 PDF，双栏放到
 * W4").
 */
export function clusterLines(items: RawTextItem[], page: number): Line[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];

  for (const item of sorted) {
    const last = lines[lines.length - 1];
    const tolerance = last ? Math.max(last.fontSize, item.fontSize) * 0.4 : 0;
    if (last && Math.abs(last.y - item.y) <= tolerance) {
      last.items.push(item);
    } else {
      lines.push({ page, items: [item], y: item.y, minX: item.x, maxX: item.x + item.width, fontSize: item.fontSize });
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.minX = Math.min(...line.items.map((i) => i.x));
    line.maxX = Math.max(...line.items.map((i) => i.x + i.width));
    line.fontSize = Math.max(...line.items.map((i) => i.fontSize));
  }

  return lines;
}
