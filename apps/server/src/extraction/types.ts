/** One pdfjs-dist text item, flattened to the fields the reassembly layer needs. */
export interface RawTextItem {
  str: string;
  /** Index into that page's original `getTextContent().items` array (before any filtering) — must stay aligned with what the frontend's own pdfjs-dist parse will see, since CharMap.itemIndex is shared across both (docs/02-decisions.md #12). */
  itemIndex: number;
  /** PDF user-space coordinates: origin bottom-left, y increases upward. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
}

export interface PageExtraction {
  /** Unrotated page box width/height in PDF user-space units — needed to judge whether a gap between text items is a plausible column boundary (see ../reassembly/columns.ts). */
  width: number;
  height: number;
  items: RawTextItem[];
}
