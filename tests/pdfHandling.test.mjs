import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { jsPDF } from 'jspdf';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(async () => vite.close());

const { parseDocumentFile, DocumentFileError } = await vite.ssrLoadModule('/src/services/document/fileParser.ts');
const { hasUnreadableTextLayer, describePdfFailure } = await vite.ssrLoadModule('/src/services/document/pdfDiagnostics.ts');

function fileOf(parts, name, type) {
  return new File(parts, name, { type });
}

// A page can draw text that pdf.js cannot map to Unicode at all (composite
// fonts with no ToUnicode and no Adobe CIDSystemInfo). Counts below are from a
// real file that extracted as zero characters while its pages clearly drew text.

test('a page that draws text but yields no items is reported as unreadable, not empty', () => {
  assert.equal(hasUnreadableTextLayer(0, 58), true);
  assert.equal(hasUnreadableTextLayer(0, 25), true);
});

test('pages with real text or with no text at all are not flagged as unreadable', () => {
  assert.equal(hasUnreadableTextLayer(208, 392), false); // text layer, real file
  assert.equal(hasUnreadableTextLayer(0, 0), false); // blank page / scanned image
  assert.equal(hasUnreadableTextLayer(0, 1), false); // incidental glyph, treat as no text
});

test('pdf.js failures map to distinct, actionable error codes', () => {
  assert.equal(describePdfFailure(Object.assign(new Error('no password'), { name: 'PasswordException', code: 1 })).code, 'PDF_ENCRYPTED');
  assert.equal(describePdfFailure(Object.assign(new Error('bad xref'), { name: 'InvalidPDFException' })).code, 'INVALID_FILE');
  assert.equal(describePdfFailure(new Error('Setting up fake worker failed: nope')).code, 'PDF_PARSE_FAILED');
  assert.equal(describePdfFailure(new Error('something else')).code, 'PDF_PARSE_FAILED');
  // A worker that cannot load is actionable (reload), unlike a broken file.
  assert.match(describePdfFailure(new Error('Setting up fake worker failed: nope')).message, /刷新/);
  for (const error of [
    Object.assign(new Error('x'), { name: 'PasswordException', code: 1 }),
    new Error('something else'),
  ]) {
    assert.match(describePdfFailure(error).message, /[\u4e00-\u9fff]/, 'messages must stay in Chinese');
  }
});

test('a corrupt PDF with a valid signature reports a parse failure', async () => {
  const file = fileOf(['%PDF-1.4\nthis is not really a pdf'], 'broken.pdf', 'application/pdf');
  await assert.rejects(
    () => parseDocumentFile(file),
    (error) => error instanceof DocumentFileError && error.code === 'INVALID_FILE',
  );
});

test('an ordinary text-layer PDF is unaffected by the new diagnostics', async () => {
  const pdf = new jsPDF();
  pdf.text('Still readable', 20, 20);
  const parsed = await parseDocumentFile(fileOf([pdf.output('arraybuffer')], 'ok.pdf', 'application/pdf'));
  assert.match(parsed.text, /Still readable/);
});

test('a PDF with no text layer at all keeps the explicit no-text error', async () => {
  const file = fileOf([new jsPDF().output('arraybuffer')], 'blank.pdf', 'application/pdf');
  await assert.rejects(
    () => parseDocumentFile(file),
    (error) => error instanceof DocumentFileError && error.code === 'PDF_NO_TEXT',
  );
});
