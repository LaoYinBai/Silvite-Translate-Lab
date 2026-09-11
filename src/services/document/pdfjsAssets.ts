// pdf.js loads CMaps, standard fonts, wasm decoders and ICC profiles as
// separate files at runtime. The pdfjsAssets plugin in vite.config.ts serves
// them from node_modules in dev and copies them into the build output, so both
// text extraction and page rendering must point at the same base path.

export const PDFJS_ASSET_BASE = '/pdfjs/';

interface PdfjsWorkerHost {
  GlobalWorkerOptions: { workerSrc: string };
}

/**
 * Points pdf.js at the bundled module worker. Node (tests) keeps the fake
 * worker, so this is a no-op outside the browser.
 */
export function configurePdfjsWorker(pdfjs: PdfjsWorkerHost): void {
  if (typeof window === 'undefined') return;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
}

export function pdfjsDocumentOptions(data: Uint8Array) {
  if (typeof window === 'undefined') {
    // The Node fake worker cannot fetch these itself.
    return { data, cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`, useWorkerFetch: false };
  }
  return {
    data,
    cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
  };
}
