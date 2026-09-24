import { createHash } from "node:crypto";
import type { CharMap, Node as IrNode } from "@paper-xray/contracts";
import { codePointLength, sliceByCodePoints } from "@paper-xray/contracts";
import type { PageExtraction } from "../extraction/types.js";
import { assemblePageLines } from "./columns.js";
import { stripHeaderFooter } from "./header-footer.js";
import { segmentParagraphs, type Paragraph } from "./paragraphs.js";
import { mergeCrossPageParagraphs } from "./cross-page.js";

export interface ReassembledDocument {
  normalizedText: string;
  charMap: CharMap;
  nodes: IrNode[];
}

/**
 * Runs the full reassembly pipeline (docs/01-nabcd-architecture.md "三个
 * 关键技术难点" #1) and produces the IR contract's normalizedText + CharMap
 * + Node[] (paragraph nodes only — section/equation/figure/table/caption
 * detection is future work, not needed to unblock anchoring). Handles
 * single- and two-column pages (see ./columns.ts); more than two columns
 * is not attempted.
 *
 * `contentHash` is folded into each Node's id so ids stay content-derived
 * and stable across re-parses of the *same* document, while still being
 * globally unique across *different* documents that happen to share
 * identical paragraph text (e.g. two papers with the same section title) —
 * `nodes.id` is a bare PRIMARY KEY in the schema, not scoped to doc_id.
 */
export function buildDocument(pages: PageExtraction[], contentHash: string): ReassembledDocument {
  const pagesOfLines = stripHeaderFooter(
    pages.map((page, pageIndex) => assemblePageLines(page.items, pageIndex + 1, page.width)),
  );

  const pagesOfParagraphs = pagesOfLines.map(segmentParagraphs);
  const paragraphs = mergeCrossPageParagraphs(pagesOfParagraphs);

  let normalizedText = "";
  let pos = 0; // running code-point offset, avoids re-scanning `text` on every append
  const charMap: CharMap = [];
  const nodes: IrNode[] = [];

  function append(s: string): void {
    normalizedText += s;
    pos += codePointLength(s);
  }

  paragraphs.forEach((paragraph, order) => {
    const paraStart = pos;

    paragraph.lines.forEach((line, lineIdx) => {
      line.items.forEach((item, itemIdx) => {
        const itemStart = pos;
        append(item.str);
        charMap.push({
          charStart: itemStart,
          charEnd: pos,
          page: line.page,
          itemIndex: item.itemIndex,
          itemCharStart: 0,
          itemCharEnd: codePointLength(item.str),
        });
        if (itemIdx < line.items.length - 1) append(" ");
      });
      if (lineIdx < paragraph.lines.length - 1) append("\n");
    });

    const paraEnd = pos;

    nodes.push({
      // Structural path (order among paragraphs) + content hash, so the id
      // is stable across re-parses of the same content but changes if
      // either the paragraph's position or its text changes (docs/01
      // "核心数据模型": "结构路径 + 内容哈希派生，稳定").
      id: paragraphId(contentHash, order, sliceByCodePoints(normalizedText, paraStart, paraEnd)),
      type: "paragraph",
      parentId: null,
      order,
      charRange: { start: paraStart, end: paraEnd },
      pageHint: paragraph.lines[0]?.page ?? 1,
    });

    append("\n\n");
  });

  return { normalizedText, charMap, nodes };
}

function paragraphId(contentHash: string, order: number, paragraphText: string): string {
  return createHash("sha256").update(`${contentHash}:paragraph:${order}:${paragraphText}`).digest("hex").slice(0, 32);
}

export type { Paragraph };
