// Diagnostics for the pdf.js extraction path. Kept separate from fileParser so
// the decisions ("is this page unreadable?" / "what did pdf.js throw?") can be
// unit-tested against numbers and errors observed in real files.

export type PdfFailureCode =
  | 'PDF_ENCRYPTED'
  | 'PDF_PARSE_FAILED'
  | 'INVALID_FILE'
  | 'PDF_NO_TEXT'
  | 'PDF_UNREADABLE_TEXT_LAYER';

export interface PdfFailure {
  code: PdfFailureCode;
  message: string;
}

// A page that draws at least this many text operations yet yields zero text
// items extracts nothing because its fonts carry no Unicode mapping — not
// because the page is blank. Below the threshold we call it "no text layer"
// (stray single-glyph pages exist in real PDFs).
export const MIN_TEXT_DRAWING_OPS = 5;

export function hasUnreadableTextLayer(textItemCount: number, textDrawingOps: number): boolean {
  return textItemCount === 0 && textDrawingOps >= MIN_TEXT_DRAWING_OPS;
}

export function describePdfFailure(error: unknown): PdfFailure {
  const name = (error as { name?: string } | null | undefined)?.name;
  if (name === 'PasswordException') {
    return { code: 'PDF_ENCRYPTED', message: '这份 PDF 已加密，需要密码才能打开。请先取消密码保护后重试。' };
  }
  if (name === 'InvalidPDFException') {
    return { code: 'INVALID_FILE', message: 'PDF 文件内容无效或已损坏，无法解析。' };
  }
  if (error instanceof Error && /worker/i.test(error.message)) {
    return { code: 'PDF_PARSE_FAILED', message: 'PDF 解析组件未能加载，请刷新页面后重试。' };
  }
  return { code: 'PDF_PARSE_FAILED', message: 'PDF 文件解析失败，请重试或换用其他格式。' };
}
