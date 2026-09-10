import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { jsPDF } from 'jspdf';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { parseDocumentFile, DocumentFileError } = await vite.ssrLoadModule('/src/services/document/fileParser.ts');

after(async () => vite.close());

function fileOf(parts, name, type) {
  return new File(parts, name, { type });
}

test('TXT input is read as text with metadata', async () => {
  const parsed = await parseDocumentFile(fileOf(['hello\nworld'], 'note.txt', 'text/plain'));
  assert.equal(parsed.kind, 'txt');
  assert.equal(parsed.text, 'hello\nworld');
  assert.equal(parsed.characterCount, 11);
});

test('Markdown keeps headings, lists and fenced code', async () => {
  const source = '# Guide\n\n- item\n\n```js\nconst x = 1;\n```';
  const parsed = await parseDocumentFile(fileOf([source], 'guide.md', 'text/markdown'));
  assert.equal(parsed.kind, 'md');
  assert.equal(parsed.text, source);
});

test('DOCX extracts headings, paragraphs and list order', async () => {
  const document = new Document({ sections: [{ children: [
    new Paragraph({ text: 'Document title', heading: 'Heading1' }),
    new Paragraph({ children: [new TextRun('First paragraph')] }),
    new Paragraph({ text: 'List item', bullet: { level: 0 } }),
  ] }] });
  const blob = await Packer.toBlob(document);
  const parsed = await parseDocumentFile(fileOf([await blob.arrayBuffer()], 'sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  assert.equal(parsed.kind, 'docx');
  assert.match(parsed.text, /# Document title/);
  assert.match(parsed.text, /First paragraph/);
  assert.match(parsed.text, /List item/);
});

test('text-layer PDF extracts readable text', async () => {
  const pdf = new jsPDF();
  pdf.text('Readable PDF sentence', 20, 20);
  const parsed = await parseDocumentFile(fileOf([pdf.output('arraybuffer')], 'sample.pdf', 'application/pdf'));
  assert.equal(parsed.kind, 'pdf');
  assert.match(parsed.text, /Readable PDF sentence/);
});

test('empty, unsupported and corrupt files are rejected', async () => {
  await assert.rejects(() => parseDocumentFile(fileOf([], 'empty.txt', 'text/plain')), (error) => error instanceof DocumentFileError && error.code === 'EMPTY_FILE');
  await assert.rejects(() => parseDocumentFile(fileOf(['x'], 'bad.exe', 'application/octet-stream')), (error) => error instanceof DocumentFileError && error.code === 'UNSUPPORTED_FILE');
  await assert.rejects(() => parseDocumentFile(fileOf(['not a zip'], 'bad.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')), (error) => error instanceof DocumentFileError && error.code === 'INVALID_FILE');
});

test('PDF without a usable text layer receives the explicit no-text error', async () => {
  const pdf = new jsPDF();
  const file = fileOf([pdf.output('arraybuffer')], 'blank.pdf', 'application/pdf');
  await assert.rejects(() => parseDocumentFile(file), (error) => error instanceof DocumentFileError && error.code === 'PDF_NO_TEXT');
});

test('extension and actual signature must agree', async () => {
  await assert.rejects(
    () => parseDocumentFile(fileOf(['plain text'], 'fake.pdf', 'application/pdf')),
    (error) => error instanceof DocumentFileError && error.code === 'INVALID_FILE',
  );
});
