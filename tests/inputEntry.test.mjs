import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(async () => vite.close());

const { effectiveInputMode } = await vite.ssrLoadModule('/src/store/translationStore.ts');
const { SUPPORTED_INPUT_ACCEPT } = await vite.ssrLoadModule('/src/services/document/fileKind.ts');

// The upload entry is unified: there is no user-visible mode switch any more,
// so the pipeline must follow what is actually attached. A stale mode left
// behind by a removed attachment used to silently swallow text translations.

test('the pipeline follows the attachment, not a stored mode', () => {
  assert.equal(effectiveInputMode({ documentFile: null, inputImage: null }), 'text');
  assert.equal(effectiveInputMode({ documentFile: null, inputImage: 'data:image/png;base64,x' }), 'image');
  assert.equal(effectiveInputMode({ documentFile: { text: 'x' }, inputImage: null }), 'file');
  assert.equal(effectiveInputMode({ documentFile: { text: 'x' }, inputImage: 'data:image/png;base64,x' }), 'file');
});

test('removing an attachment returns the session to plain text', () => {
  const attached = { documentFile: null, inputImage: 'data:image/png;base64,x' };
  assert.equal(effectiveInputMode(attached), 'image');
  assert.equal(effectiveInputMode({ ...attached, inputImage: null }), 'text');
});

test('the single file picker accepts every format the app really parses', () => {
  const entries = new Set(SUPPORTED_INPUT_ACCEPT.split(','));
  for (const extension of [
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xlsx',
    '.txt', '.md', '.markdown', '.csv', '.srt', '.vtt', '.ass', '.ssa',
    '.jpg', '.jpeg', '.png', '.webp',
  ]) {
    assert.ok(entries.has(extension), `${extension} missing from the unified picker`);
  }
  for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv']) {
    assert.ok(entries.has(mimeType), `${mimeType} missing from the unified picker`);
  }
  // Formats that are not really supported must not be advertised.
  for (const unsupported of ['.xls', '.bmp', '.heic', '.rtf', '.odt']) {
    assert.ok(!entries.has(unsupported), `${unsupported} must not be advertised`);
  }
});
