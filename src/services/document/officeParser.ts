// Office formats are parsed by a lazily loaded WebAssembly module (~1 MB). It
// must stay out of the main bundle: only a file with one of these extensions
// pays for it, and a load or parse failure degrades to a clear message instead
// of breaking the formats that do not need it.

export type OfficeDocumentKind = 'doc' | 'ppt' | 'pptx' | 'xlsx';

// office-oxide-wasm reads docx/xlsx/pptx/doc/ppt. The legacy 'xls' format string
// is rejected by 0.1.8, so .xls is deliberately not advertised as supported.
const FORMAT_NAMES: Record<OfficeDocumentKind, string> = {
  doc: 'doc',
  ppt: 'ppt',
  pptx: 'pptx',
  xlsx: 'xlsx',
};

type OfficeModule = typeof import('office-oxide-wasm/web');

let modulePromise: Promise<OfficeModule> | null = null;

function loadOfficeModule(): Promise<OfficeModule> {
  modulePromise ??= (async () => {
    const module = await import('office-oxide-wasm/web');
    // With no argument the generated entry resolves office_oxide_bg.wasm next to
    // the module, which Vite emits as a build asset. Node tests initialise it
    // first with the wasm bytes; this call is then a no-op.
    await module.default();
    return module;
  })();
  return modulePromise;
}

export async function extractOfficeText(kind: OfficeDocumentKind, arrayBuffer: ArrayBuffer): Promise<string> {
  const module = await loadOfficeModule();
  const document = new module.WasmDocument(new Uint8Array(arrayBuffer), FORMAT_NAMES[kind]);
  return document.plainText();
}
