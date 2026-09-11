import { normalizeExtractedText } from './normalizeText';
import { describePdfFailure, hasUnreadableTextLayer } from './pdfDiagnostics';
import { documentKindLabel, documentKindsLabel } from './formatLabels';
import { extractSubtitleText } from './structuredText';
import { extractOfficeText, type OfficeDocumentKind } from './officeParser';
import { configurePdfjsWorker, pdfjsDocumentOptions } from './pdfjsAssets';

export type DocumentFileKind = 'txt' | 'md' | 'csv' | 'srt' | 'vtt' | 'ass' | 'doc' | 'docx' | 'ppt' | 'pptx' | 'xlsx' | 'pdf';

export interface ParsedDocumentFile {
  name: string;
  kind: DocumentFileKind;
  mimeType: string;
  size: number;
  text: string;
  characterCount: number;
}

export type DocumentFileErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE'
  | 'INVALID_FILE'
  | 'PDF_NO_TEXT'
  | 'PDF_UNREADABLE_TEXT_LAYER'
  | 'PDF_ENCRYPTED'
  | 'PDF_PARSE_FAILED'
  | 'DOCUMENT_TOO_LONG';

export class DocumentFileError extends Error {
  code: DocumentFileErrorCode;

  constructor(code: DocumentFileErrorCode, message: string) {
    super(message);
    this.name = 'DocumentFileError';
    this.code = code;
  }
}

// These failures mean "no usable text layer" rather than "broken file": the
// file can still be translated by rendering its pages as images.
const VISION_RECOVERABLE_CODES = new Set<DocumentFileErrorCode>(['PDF_NO_TEXT', 'PDF_UNREADABLE_TEXT_LAYER']);

export function isVisionRecoverablePdfError(code: DocumentFileErrorCode | null | undefined): boolean {
  return Boolean(code && VISION_RECOVERABLE_CODES.has(code));
}

export const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024;
// Office files embed media, so a deck or workbook legitimately exceeds 10MB
// while its text stays small. The extracted-character cap remains the real
// guard on how much work a file can create.
export const MAX_OFFICE_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_EXTRACTED_CHARACTERS = 100_000;

const EXTENSION_KIND: Record<string, DocumentFileKind> = {
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  csv: 'csv',
  srt: 'srt',
  vtt: 'vtt',
  ass: 'ass',
  ssa: 'ass',
  doc: 'doc',
  docx: 'docx',
  ppt: 'ppt',
  pptx: 'pptx',
  xlsx: 'xlsx',
  pdf: 'pdf',
};

const MIME_KIND: Record<string, DocumentFileKind> = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'text/csv': 'csv',
  'application/x-subrip': 'srt',
  'text/vtt': 'vtt',
  'text/x-ssa': 'ass',
  'text/x-ass': 'ass',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/pdf': 'pdf',
};

// Plain-text containers. Their MIME types are reported inconsistently across
// browsers and operating systems (Windows calls a .csv "application/vnd.ms-excel",
// for example), so for these kinds the extension decides and the MIME is only
// ever informative. Binary formats keep the strict mismatch check below.
const TEXT_KINDS = new Set<DocumentFileKind>(['txt', 'md', 'csv', 'srt', 'vtt', 'ass']);

// Formats parsed by the lazily loaded Office parser.
const OFFICE_KINDS = new Set<DocumentFileKind>(['doc', 'ppt', 'pptx', 'xlsx']);

// Archive-based formats share the ZIP signature, legacy ones the OLE one.
const ZIP_KINDS = new Set<DocumentFileKind>(['docx', 'pptx', 'xlsx']);
const OLE_KINDS = new Set<DocumentFileKind>(['doc', 'ppt']);

const ZIP_SIGNATURE = [0x50, 0x4b];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

// Recognised but not parseable in the browser: give an actionable message
// instead of the generic "unsupported format" one.
const LEGACY_UNSUPPORTED_MESSAGES: Record<string, string> = {
  xls: '暂不支持旧版 XLS 表格，请在 Excel 中另存为 .xlsx 后重试',
};

const SUPPORTED_FORMAT_MESSAGE = `不支持的文件格式，请使用 ${documentKindsLabel([...new Set(Object.values(EXTENSION_KIND))])} 文件`;

// Format registries are the single source of truth for what can be parsed;
// the drop zone, the file picker filter and the format hints derive from them.
export const SUPPORTED_DOCUMENT_KINDS: DocumentFileKind[] = [...new Set(Object.values(EXTENSION_KIND))];
export const SUPPORTED_DOCUMENT_ACCEPT = [
  ...Object.keys(EXTENSION_KIND).map((extension) => `.${extension}`),
  ...Object.keys(MIME_KIND),
].join(',');

export function documentKindOf(name: string): DocumentFileKind | null {
  return EXTENSION_KIND[extensionOf(name)] ?? null;
}

export function documentKindOfMimeType(mimeType: string): DocumentFileKind | null {
  return MIME_KIND[(mimeType || '').toLowerCase()] ?? null;
}

function extensionOf(name: string): string {
  return name.toLowerCase().split('.').pop() || '';
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function validateType(file: File, bytes: Uint8Array): DocumentFileKind {
  const extension = extensionOf(file.name);
  const extensionKind = EXTENSION_KIND[extension];
  const mimeKind = MIME_KIND[file.type.toLowerCase()];
  if (!extensionKind) {
    throw new DocumentFileError('UNSUPPORTED_FILE', LEGACY_UNSUPPORTED_MESSAGES[extension] ?? SUPPORTED_FORMAT_MESSAGE);
  }
  const isText = TEXT_KINDS.has(extensionKind);
  const genericZipMime = ZIP_KINDS.has(extensionKind) && file.type === 'application/zip';
  if (!isText && mimeKind && mimeKind !== extensionKind) {
    throw new DocumentFileError('UNSUPPORTED_FILE', '文件类型与扩展名不匹配');
  }
  if (!isText && !mimeKind && file.type && file.type !== 'application/octet-stream' && !genericZipMime) {
    throw new DocumentFileError('UNSUPPORTED_FILE', '文件类型与扩展名不匹配');
  }
  const label = documentKindLabel(extensionKind);
  if (extensionKind === 'pdf' && !startsWith(bytes, PDF_SIGNATURE)) {
    throw new DocumentFileError('INVALID_FILE', 'PDF 文件内容无效或已损坏');
  }
  if (ZIP_KINDS.has(extensionKind) && !startsWith(bytes, ZIP_SIGNATURE)) {
    throw new DocumentFileError('INVALID_FILE', `${label} 文件内容无效或已损坏`);
  }
  if (OLE_KINDS.has(extensionKind) && !startsWith(bytes, OLE_SIGNATURE)) {
    throw new DocumentFileError('INVALID_FILE', `${label} 文件内容无效或已损坏（旧版二进制格式）`);
  }
  return extensionKind;
}

function cleanPlainText(text: string): string {
  return text.replace(/^\uFEFF/, '').split(String.fromCharCode(0)).join('').replace(/\r\n/g, '\n');
}

async function extractDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const mammoth = await import('mammoth');
    // Mammoth's browser adapter reads `arrayBuffer`; its Node adapter (used
    // by the test runner) reads `buffer`. Supplying the same immutable bytes
    // under both keys keeps extraction identical in both runtimes.
    const mammothInput = { arrayBuffer, buffer: arrayBuffer } as { arrayBuffer: ArrayBuffer };
    const result = await mammoth.convertToHtml(mammothInput);
    const markdown = result.value
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, value: string) => `${'#'.repeat(Number(level))} ${value}\n\n`)
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    return cleanPlainText(markdown)
      .replace(/<a id="[^"\n]+"><\/a>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    throw new DocumentFileError('INVALID_FILE', 'DOCX 文件解析失败，请确认文件未损坏');
  }
}

function normalizePdfPage(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  let text = '';
  for (const item of items) {
    const value = item.str?.trim();
    if (!value) continue;
    text += (text && !text.endsWith('\n') ? ' ' : '') + value;
    if (item.hasEOL) text += '\n';
  }
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !/^[-–—]?\s*\d{1,4}\s*[-–—]?$/.test(line))
    .join('\n')
    .trim();
}

function removeRepeatedPageEdges(pages: string[]): string[] {
  if (pages.length < 3) return pages;
  const lines = pages.map((page) => page.split('\n'));
  const repeated = new Set<string>();
  for (const edge of [0, -1]) {
    const counts = new Map<string, number>();
    for (const pageLines of lines) {
      const value = pageLines.at(edge)?.trim();
      if (value && value.length < 160) counts.set(value, (counts.get(value) || 0) + 1);
    }
    for (const [value, count] of counts) if (count >= Math.ceil(pages.length * 0.6)) repeated.add(value);
  }
  return lines.map((pageLines) => pageLines.filter((line, index) => {
    const isEdge = index === 0 || index === pageLines.length - 1;
    return !(isEdge && repeated.has(line.trim()));
  }).join('\n').trim());
}

// pdf.js fetches CMaps, standard fonts, wasm decoders and ICC profiles as
// separate files at runtime. Served from node_modules in dev and copied into
// the build output (see the pdfjsAssets plugin in vite.config.ts).

async function countTextDrawingOps(
  page: { getOperatorList: () => Promise<{ fnArray: number[] }> },
  OPS: Record<string, number>,
): Promise<number> {
  try {
    const operations = await page.getOperatorList();
    return operations.fnArray.filter((fn) => fn === OPS.showText || fn === OPS.showSpacedText).length;
  } catch {
    // A page whose fonts cannot be evaluated yields no text either way.
    return 0;
  }
}

async function extractPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Vite must receive a concrete worker URL. Node tests use PDF.js's fake
    // worker, while browsers load this bundled module worker.
    configurePdfjsWorker(pdfjs);
    const pdf = await pdfjs.getDocument(pdfjsDocumentOptions(new Uint8Array(arrayBuffer))).promise;
    const OPS = pdfjs.OPS as unknown as Record<string, number>;
    const pages: string[] = [];
    let textItemCount = 0;
    let textDrawingOps = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      textItemCount += content.items.length;
      const pageText = normalizePdfPage(content.items as Array<{ str?: string; hasEOL?: boolean }>);
      // Only pages that produced nothing are worth an operator-list pass.
      if (!pageText) textDrawingOps += await countTextDrawingOps(page, OPS);
      pages.push(pageText);
    }
    const text = removeRepeatedPageEdges(pages).filter(Boolean).join('\n\n').trim();
    if (text) return text;

    if (hasUnreadableTextLayer(textItemCount, textDrawingOps)) {
      throw new DocumentFileError(
        'PDF_UNREADABLE_TEXT_LAYER',
        '这份 PDF 的文字使用了无法识别的字体编码，无法提取原文。可改用「图片」标签页上传页面截图，或换用其他格式。',
      );
    }
    throw new DocumentFileError(
      'PDF_NO_TEXT',
      '当前 PDF 没有可提取的文字层（可能是扫描件）。可改用「图片」标签页上传页面截图，或换用其他格式。',
    );
  } catch (error) {
    if (error instanceof DocumentFileError) throw error;
    const failure = describePdfFailure(error);
    throw new DocumentFileError(failure.code, failure.message);
  }
}

function extractPlainTextKind(kind: DocumentFileKind, arrayBuffer: ArrayBuffer, fileSize: number): string {
  const suspiciousControls = new Uint8Array(arrayBuffer).filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length;
  if (suspiciousControls > Math.max(2, fileSize * 0.01)) {
    throw new DocumentFileError('INVALID_FILE', '文本文件包含无效的二进制内容');
  }
  const text = cleanPlainText(new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer));
  if (kind === 'srt' || kind === 'vtt' || kind === 'ass') return extractSubtitleText(text, kind);
  return text;
}

async function extractOffice(arrayBuffer: ArrayBuffer, kind: OfficeDocumentKind): Promise<string> {
  try {
    return cleanPlainText(await extractOfficeText(kind, arrayBuffer));
  } catch {
    throw new DocumentFileError(
      'INVALID_FILE',
      `${documentKindLabel(kind)} 文件解析失败，请确认文件未损坏；若多次失败可另存为 .docx 或 .pptx 后重试`,
    );
  }
}

function sizeLimitFor(file: File): number {
  return OFFICE_KINDS.has(EXTENSION_KIND[extensionOf(file.name)]) ? MAX_OFFICE_FILE_SIZE : MAX_DOCUMENT_FILE_SIZE;
}

export async function parseDocumentFile(file: File): Promise<ParsedDocumentFile> {
  if (!file.size) throw new DocumentFileError('EMPTY_FILE', '文件为空，请选择包含正文的文件');
  const sizeLimit = sizeLimitFor(file);
  if (file.size > sizeLimit) {
    throw new DocumentFileError('FILE_TOO_LARGE', `文件过大，最大支持 ${Math.round(sizeLimit / (1024 * 1024))}MB`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer.slice(0, 8));
  const kind = validateType(file, bytes);
  let text: string;
  if (TEXT_KINDS.has(kind)) {
    text = extractPlainTextKind(kind, arrayBuffer, file.size);
  } else if (kind === 'docx') {
    text = await extractDocx(arrayBuffer);
  } else if (OFFICE_KINDS.has(kind)) {
    text = await extractOffice(arrayBuffer, kind as OfficeDocumentKind);
  } else {
    text = await extractPdf(arrayBuffer);
  }

  // Every format goes through the same normalization so extracted text is what
  // the author wrote, not what the source font happened to encode.
  text = normalizeExtractedText(text);

  if (!text.trim()) throw new DocumentFileError('EMPTY_FILE', '文件中没有可翻译的正文');
  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new DocumentFileError('DOCUMENT_TOO_LONG', '文件正文超过 100,000 个字符，请拆分文件后重试');
  }

  return {
    name: file.name,
    kind,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    text,
    characterCount: text.length,
  };
}
