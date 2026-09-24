import type { RawTextItem } from "../extraction/types.js";
import type { Line } from "./lines.js";

let autoIndex = 0;

export function resetItemIndex(): void {
  autoIndex = 0;
}

export function makeItem(str: string, x: number, y: number, width: number, fontSize = 10): RawTextItem {
  return { str, itemIndex: autoIndex++, x, y, width, height: fontSize, fontName: "F1", fontSize };
}

/** Bypasses clusterLines for tests that only care about paragraph/header-footer/cross-page geometry logic, not clustering itself. */
export function makeLine(page: number, y: number, minX: number, maxX: number, fontSize = 10, text = "x"): Line {
  return {
    page,
    items: [makeItem(text, minX, y, maxX - minX, fontSize)],
    y,
    minX,
    maxX,
    fontSize,
  };
}
