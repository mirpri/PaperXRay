import { useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { ItemGeometry } from "../anchoring/reverse-map";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PageGeometries = Map<number, Map<number, ItemGeometry>>;

/**
 * Headless pdf.js parse of the same PDF bytes, used only to read each text
 * item's bbox by (page, itemIndex) — the input the reverse-mapping algorithm
 * (../anchoring/reverse-map.ts) needs. This is deliberately a *separate*
 * pdf.js document instance from the one react-pdf-highlighter renders: we
 * need `itemIndex` to mean exactly what the server's extraction layer means
 * by it (docs/02-decisions.md #12), which only holds if we call
 * getTextContent() ourselves the same way the server does, rather than
 * relying on whatever react-pdf-highlighter's internal pdf.js instance
 * happens to expose.
 */
export function useItemGeometries(fileUrl: string | null): PageGeometries | null {
  const [geometries, setGeometries] = useState<PageGeometries | null>(null);

  useEffect(() => {
    if (!fileUrl) {
      setGeometries(null);
      return;
    }

    let cancelled = false;
    let doc: pdfjsLib.PDFDocumentProxy | null = null;

    async function run() {
      const loaded = await pdfjsLib.getDocument(fileUrl!).promise;
      doc = loaded;
      if (cancelled) return;

      const result: PageGeometries = new Map();
      for (let pageNum = 1; pageNum <= loaded.numPages; pageNum++) {
        const page = await loaded.getPage(pageNum);
        if (cancelled) return;
        const content = await page.getTextContent();

        const geoms = new Map<number, ItemGeometry>();
        content.items.forEach((raw, itemIndex) => {
          if (!("str" in raw) || raw.str.length === 0) return;
          const [, , , , x, y] = raw.transform;
          geoms.set(itemIndex, { x, y, width: raw.width, height: raw.height || 10 });
        });
        result.set(pageNum, geoms);
      }

      if (!cancelled) setGeometries(result);
    }

    run().catch((err: unknown) => {
      console.error("Failed to extract item geometries for reverse-mapping:", err);
    });

    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [fileUrl]);

  return geometries;
}
