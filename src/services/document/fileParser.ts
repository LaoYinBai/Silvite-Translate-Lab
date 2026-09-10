export type DocumentFileKind = 'txt' | 'md' | 'docx' | 'pdf';

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
  | 'DOCUMENT_TOO_LONG';

export class DocumentFileError extends Error {
  code: DocumentFileErrorCode;

  constructor(code: DocumentFileErrorCode, message: string) {
    super(message);
    this.name = 'DocumentFileError';
    this.code = code;
  }
}

export const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_EXTRACTED_CHARACTERS = 100_000;

const EXTENSION_KIND: Record<string, DocumentFileKind> = {
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  docx: 'docx',
  pdf: 'pdf',
};

const MIME_KIND: Record<string, DocumentFileKind> = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf',
};

function extensionOf(name: string): string {
  return name.toLowerCase().split('.').pop() || '';
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function validateType(file: File, bytes: Uint8Array): DocumentFileKind {
  const extensionKind = EXTENSION_KIND[extensionOf(file.name)];
  const mimeKind = MIME_KIND[file.type.toLowerCase()];
  if (!extensionKind || (mimeKind && mimeKind !== extensionKind)) {
    throw new DocumentFileError('UNSUPPORTED_FILE', '不支持的文件格式，请使用 PDF、DOCX、TXT 或 MD 文件');
  }
  const genericDocxMime = extensionKind === 'docx' && file.type === 'application/zip';
  if (!mimeKind && file.type && file.type !== 'application/octet-stream' && !genericDocxMime) {
    throw new DocumentFileError('UNSUPPORTED_FILE', '文件类型与扩展名不匹配');
  }
  if (extensionKind === 'pdf' && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw new DocumentFileError('INVALID_FILE', 'PDF 文件内容无效或已损坏');
  }
  if (extensionKind === 'docx' && !startsWith(bytes, [0x50, 0x4b])) {
    throw new DocumentFileError('INVALID_FILE', 'DOCX 文件内容无效或已损坏');
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

async function extractPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Vite must receive a concrete worker URL. Node tests use PDF.js's fake
    // worker, while browsers load this bundled module worker.
    if (typeof window !== 'undefined') {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
    }
    const task = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), useWorkerFetch: false });
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(normalizePdfPage(content.items as Array<{ str?: string; hasEOL?: boolean }>));
    }
    const text = removeRepeatedPageEdges(pages).filter(Boolean).join('\n\n').trim();
    if (!text) {
      throw new DocumentFileError('PDF_NO_TEXT', '当前 PDF 无可提取文本，请上传可复制文本的 PDF 或其他格式');
    }
    return text;
  } catch (error) {
    if (error instanceof DocumentFileError) throw error;
    throw new DocumentFileError('INVALID_FILE', 'PDF 文件解析失败，请确认文件未损坏');
  }
}

export async function parseDocumentFile(file: File): Promise<ParsedDocumentFile> {
  if (!file.size) throw new DocumentFileError('EMPTY_FILE', '文件为空，请选择包含正文的文件');
  if (file.size > MAX_DOCUMENT_FILE_SIZE) {
    throw new DocumentFileError('FILE_TOO_LARGE', '文件过大，最大支持 10MB');
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer.slice(0, 8));
  const kind = validateType(file, bytes);
  let text: string;
  if (kind === 'txt' || kind === 'md') {
    const suspiciousControls = new Uint8Array(arrayBuffer).filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length;
    if (suspiciousControls > Math.max(2, file.size * 0.01)) {
      throw new DocumentFileError('INVALID_FILE', '文本文件包含无效的二进制内容');
    }
    text = cleanPlainText(new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer));
  } else if (kind === 'docx') {
    text = await extractDocx(arrayBuffer);
  } else {
    text = await extractPdf(arrayBuffer);
  }

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
