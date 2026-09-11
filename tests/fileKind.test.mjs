import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(() => vite.close());

const { classifyIncomingFile, isSupportedImageFile } = await vite.ssrLoadModule('/src/services/document/fileKind.ts');

// The homepage drop zone must route by file TYPE, not by whichever tab happens
// to be active. These cases pin the routing matrix.

test('documents route to the document pipeline regardless of MIME noise', () => {
  assert.equal(classifyIncomingFile({ name: 'report.pdf', type: 'application/pdf' }), 'document');
  assert.equal(classifyIncomingFile({ name: '报告.PDF', type: '' }), 'document');
  assert.equal(classifyIncomingFile({ name: 'notes.md', type: 'text/markdown' }), 'document');
  assert.equal(classifyIncomingFile({ name: 'plain.txt', type: 'text/plain' }), 'document');
  assert.equal(classifyIncomingFile({ name: 'paper.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'document');
});

test('images route to the image pipeline', () => {
  assert.equal(classifyIncomingFile({ name: 'photo.png', type: 'image/png' }), 'image');
  assert.equal(classifyIncomingFile({ name: 'photo.JPG', type: 'image/jpeg' }), 'image');
  assert.equal(classifyIncomingFile({ name: 'scan.webp', type: 'image/webp' }), 'image');
  // Windows drops sometimes carry an empty MIME type; the extension still wins.
  assert.equal(classifyIncomingFile({ name: 'screenshot.jpg', type: '' }), 'image');
});

test('a document name wins over a wrong image MIME so the real parser can validate it', () => {
  assert.equal(classifyIncomingFile({ name: 'report.pdf', type: 'image/png' }), 'document');
  assert.equal(classifyIncomingFile({ name: 'notes.md', type: 'application/octet-stream' }), 'document');
});

test('unsupported files stay unknown instead of being silently treated as images', () => {
  assert.equal(classifyIncomingFile({ name: 'archive.zip', type: 'application/zip' }), 'unknown');
  assert.equal(classifyIncomingFile({ name: 'data.bin', type: '' }), 'unknown');
  assert.equal(classifyIncomingFile({ name: 'no-extension', type: '' }), 'unknown');
  assert.equal(classifyIncomingFile({ name: 'movie.mp4', type: 'video/mp4' }), 'unknown');
});

test('image validation accepts extension-only images but rejects documents', () => {
  assert.equal(isSupportedImageFile({ name: 'photo.jpeg', type: '' }), true);
  assert.equal(isSupportedImageFile({ name: 'photo.png', type: 'image/png' }), true);
  assert.equal(isSupportedImageFile({ name: 'report.pdf', type: 'application/pdf' }), false);
  assert.equal(isSupportedImageFile({ name: 'mystery', type: '' }), false);
});

// Guards future format additions: a kind without a label or picker entry would
// silently show a broken hint or an unfiltered file dialog.
test('every supported document kind has a label and a picker filter entry', async () => {
  const { SUPPORTED_DOCUMENT_KINDS, SUPPORTED_DOCUMENT_ACCEPT } = await vite.ssrLoadModule('/src/services/document/fileParser.ts');
  const { documentKindLabel } = await vite.ssrLoadModule('/src/services/document/formatLabels.ts');
  assert.ok(SUPPORTED_DOCUMENT_KINDS.length >= 4);
  for (const kind of SUPPORTED_DOCUMENT_KINDS) {
    assert.ok(documentKindLabel(kind), `missing label for ${kind}`);
  }
  for (const extension of ['.pdf', '.docx', '.txt', '.md', '.csv', '.srt']) {
    assert.ok(SUPPORTED_DOCUMENT_ACCEPT.includes(extension), `${extension} missing from picker filter`);
  }
});
