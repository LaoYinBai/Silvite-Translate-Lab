// Renders PDF pages to JPEG data URLs for the vision route. Browser-only: it
// needs a real canvas, which is why the orchestration in pdfVision.ts takes the
// page source as an injected dependency and can be tested without one.

import type { PdfVisionSource } from './pdfVision';
import { configurePdfjsWorker, pdfjsDocumentOptions } from './pdfjsAssets';

// Long edge of the rendered page. Large enough to keep body text legible to the
// model, small enough to stay inside the API's request body budget.
const MAX_PAGE_EDGE = 1600;
// Mirrors the data URL limit used by the image pipeline (EdgeOne caps request
// bodies at ~1MB).
export const MAX_PAGE_DATA_URL_LENGTH = 700_000;
export const MAX_PAGE_PIXEL_SCALE = 4;

// Progressively cheaper encodings, tried in order until the payload fits.
const ENCODINGS = [
  { scaleCap: MAX_PAGE_EDGE, quality: 0.82 },
  { scaleCap: MAX_PAGE_EDGE, quality: 0.6 },
  { scaleCap: 1100, quality: 0.55 },
];

export async function openPdfPageSource(file: File): Promise<PdfVisionSource> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  configurePdfjsWorker(pdfjs);
  const pdf = await pdfjs.getDocument(pdfjsDocumentOptions(new Uint8Array(await file.arrayBuffer()))).promise;

  return {
    pageCount: pdf.numPages,
    async renderPage(pageNumber: number): Promise<string> {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const longestEdge = Math.max(base.width, base.height);

      for (const encoding of ENCODINGS) {
        const scale = Math.min(MAX_PAGE_PIXEL_SCALE, encoding.scaleCap / longestEdge);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('当前浏览器无法渲染 PDF 页面');
        // White background: transparent PDFs would otherwise turn black.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, viewport }).promise;

        const dataUrl = canvas.toDataURL('image/jpeg', encoding.quality);
        if (dataUrl.length <= MAX_PAGE_DATA_URL_LENGTH) return dataUrl;
      }
      throw new Error('PDF 页面图片过大，无法发送翻译');
    },
  };
}
