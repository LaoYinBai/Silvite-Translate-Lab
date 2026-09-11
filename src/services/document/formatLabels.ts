import type { DocumentFileKind } from './fileParser';

// Single owner of user-facing format names, so the parser's rejection message,
// the drop hints and the file picker filter can never drift apart.
const DOCUMENT_KIND_LABELS: Record<DocumentFileKind, string> = {
  txt: 'TXT',
  md: 'Markdown',
  csv: 'CSV',
  srt: 'SRT',
  vtt: 'VTT',
  ass: 'ASS',
  doc: 'DOC',
  docx: 'DOCX',
  ppt: 'PPT',
  pptx: 'PPTX',
  xlsx: 'XLSX',
  pdf: 'PDF',
};

export function documentKindLabel(kind: DocumentFileKind): string {
  return DOCUMENT_KIND_LABELS[kind];
}

export function documentKindsLabel(kinds: DocumentFileKind[]): string {
  return kinds.map(documentKindLabel).join(' / ');
}
