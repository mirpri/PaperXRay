/**
 * IR (intermediate representation) — the output of the extraction +
 * reassembly layers, and the input to anchoring, agent runtime, and
 * rendering. See docs/01-nabcd-architecture.md "核心数据模型" and
 * docs/02-decisions.md #12.
 */

/**
 * A half-open interval `[start, end)` into a document's `normalizedText`,
 * counted in Unicode code points. Never construct one by indexing a JS
 * string directly — use the helpers in `./codepoints`.
 */
export interface CharRange {
  start: number;
  end: number;
}

export type NodeType =
  | "section"
  | "paragraph"
  | "equation"
  | "figure"
  | "table"
  | "caption";

export interface Document {
  id: string;
  /** SHA-256 of the raw PDF bytes. Doubles as the document identity (docs/02-decisions.md #2) — same bytes, same document, regardless of who uploaded it or how. */
  contentHash: string;
  /** Display title, extracted on first import and editable by administrators; never part of document identity. */
  title: string | null;
  pageCount: number;
  /** Full reassembled document text, in reading order, used as the coordinate space for every CharRange in the document. */
  normalizedText: string;
  createdAt: string;
}

/** Lightweight projection for list views (the library page) — omits normalizedText, which can be tens of thousands of characters. */
export interface DocumentSummary {
  id: string;
  contentHash: string;
  title: string | null;
  pageCount: number;
  createdAt: string;
}

export interface Node {
  /** Derived from structural path + content hash; stable across re-parses of the same content (docs/01 "核心数据模型"). */
  id: string;
  type: NodeType;
  parentId: string | null;
  /** Sibling order under parentId, 0-based. */
  order: number;
  charRange: CharRange;
  /** First page this node appears on, for fast jump-to-node without walking CharMap. */
  pageHint: number;
}

/**
 * One run of code points in `normalizedText` that maps to a contiguous run
 * of characters inside a single extracted PDF text item on a single page.
 *
 * This is a first cut at the representation the architecture doc explicitly
 * leaves open ("具体表示形式...留到动手时定"). Run-length encoding (rather
 * than one entry per character) keeps the map small, and since both
 * extraction (server) and rendering (client) use `pdfjs-dist`, `itemIndex`
 * is valid on both sides without translation (docs/02-decisions.md #12).
 *
 * Reverse mapping (charRange -> rectangles) works by: binary-search the runs
 * overlapping the range, then for each run compute a sub-rectangle of the
 * item's bbox proportional to (itemCharStart, itemCharEnd) within the item's
 * full character count. This is an approximation for proportional-width
 * fonts within one item; expected to need refinement once real PDFs are
 * tested against golden-set fixtures (owner: reassembly-layer work).
 */
export interface CharMapRun {
  /** Code-point offset into normalizedText where this run starts (inclusive). */
  charStart: number;
  /** Code-point offset into normalizedText where this run ends (exclusive). */
  charEnd: number;
  page: number;
  /** Index into that page's `pdfjs-dist` `getTextContent().items` array. */
  itemIndex: number;
  /** Code-point offset into the item's own string where this run starts (inclusive). */
  itemCharStart: number;
  /** Code-point offset into the item's own string where this run ends (exclusive). */
  itemCharEnd: number;
}

/** Sorted by charStart, non-overlapping, covers every index of normalizedText that came from extracted PDF text (gaps allowed for inserted whitespace/joins). */
export type CharMap = CharMapRun[];
