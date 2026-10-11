import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageExtraction, RawTextItem } from "./types.js";
import { extractTitle } from "./title.js";

/**
 * The extraction layer proper (docs/01-nabcd-architecture.md "提取层"):
 * pure library call, one PageExtraction per page. No structure recovery
 * here — that's the reassembly layer's job (../reassembly).
 */
export async function extractPdf(pdfBytes: Uint8Array, filename = ""): Promise<{ pages: PageExtraction[]; title: string | null }> {
  const doc = await getDocument({
    data: pdfBytes,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  try {
    const pages: PageExtraction[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items: RawTextItem[] = [];

      content.items.forEach((raw, itemIndex) => {
        if (!("str" in raw) || raw.str.length === 0) return;
        const [, skewX, skewY, scaleY, x, y] = raw.transform;
        const fontSize = Math.hypot(skewX, skewY) || Math.abs(scaleY);
        items.push({
          str: raw.str,
          itemIndex,
          x,
          y,
          width: raw.width,
          height: raw.height || fontSize,
          fontName: raw.fontName,
          fontSize,
        });
      });

      const [x0, y0, x1, y1] = page.view;
      pages.push({ width: x1 - x0, height: y1 - y0, items });
    }
    // Missing/malformed metadata must not fail an otherwise readable PDF.
    const metadataTitles: unknown[] = [];
    try {
      const { info, metadata } = await doc.getMetadata();
      metadataTitles.push(metadata?.get("dc:title"), (info as { Title?: unknown }).Title);
    } catch { /* Fall back to the first-page layout. */ }
    return { pages, title: extractTitle(metadataTitles, pages[0], filename) };
  } finally {
    await doc.destroy();
  }
}

/** Kept for evaluation callers that only need the original text extraction. */
export async function extractPages(pdfBytes: Uint8Array): Promise<PageExtraction[]> {
  return (await extractPdf(pdfBytes)).pages;
}
