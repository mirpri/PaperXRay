import type { Highlight } from "react-pdf-highlighter-extended";
import type { Annotation, CharMap } from "@paper-xray/contracts";
import { isAgentAnnotation, lensColor, humanAnnotationColor } from "@paper-xray/contracts";
import { mapCharRangeToRects, type PdfRect } from "../anchoring/reverse-map";
import type { PageGeometries } from "./useItemGeometries";

export interface PxrHighlight extends Highlight {
  annotationId: string;
  isAgent: boolean;
  color?: string;
}

/**
 * One AgentAnnotation/HumanAnnotation can produce more than one
 * react-pdf-highlighter-extended Highlight: each `Scaled` rect carries its
 * own `pageNumber`, but a single Highlight is expected to live on one page
 * (docs upstream), so an annotation whose evidence happens to straddle a
 * page break (rare — cross-page paragraph merging exists, see
 * ../../apps/server/src/reassembly/cross-page.ts) becomes one Highlight per
 * page it touches, sharing `annotationId` so the sidebar's "jump to text"
 * can still find at least one of them.
 */
export function annotationsToHighlights(
  annotations: Annotation[],
  charMap: CharMap,
  geometries: PageGeometries,
  lensColors: ReadonlyMap<string, string> = new Map(),
): PxrHighlight[] {
  const result: PxrHighlight[] = [];

  for (const annotation of annotations) {
    const rects = (annotation.anchor.charRanges ?? [annotation.anchor.charRange]).flatMap(range =>
      mapCharRangeToRects(range, charMap, (page, itemIndex) => geometries.get(page)?.get(itemIndex)));
    if (rects.length === 0) continue;

    const byPage = new Map<number, PdfRect[]>();
    for (const rect of rects) {
      const list = byPage.get(rect.page) ?? [];
      list.push(rect);
      byPage.set(rect.page, list);
    }

    const agent = isAgentAnnotation(annotation);

    for (const [page, pageRects] of byPage) {
      const scaledRects = pageRects.map((r) => ({
        x1: r.x,
        y1: r.y,
        x2: r.x + r.width,
        y2: r.y + r.height,
        width: r.width,
        height: r.height,
        pageNumber: page,
      }));
      const boundingRect = {
        x1: Math.min(...scaledRects.map((r) => r.x1)),
        y1: Math.min(...scaledRects.map((r) => r.y1)),
        x2: Math.max(...scaledRects.map((r) => r.x2)),
        y2: Math.max(...scaledRects.map((r) => r.y2)),
        width: scaledRects[0].width,
        height: scaledRects[0].height,
        pageNumber: page,
      };

      result.push({
        id: `${annotation.id}:${page}`,
        annotationId: annotation.id,
        isAgent: agent,
        color: agent ? lensColor(annotation.agentId, lensColors.get(annotation.agentId) ?? annotation.lensColor) : humanAnnotationColor(annotation.color),
        type: "text",
        content: { text: agent ? annotation.comment : annotation.body },
        position: { boundingRect, rects: scaledRects, usePdfCoordinates: true },
      });
    }
  }

  return result;
}
