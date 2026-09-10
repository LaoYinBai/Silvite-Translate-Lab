import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { chunkDocument, detectDocumentLanguage, extractDocumentTitle } = await vite.ssrLoadModule('/src/services/document/chunker.ts');

after(async () => vite.close());

test('short text stays in one translatable chunk', () => {
  const text = '这是一个简短段落。';
  assert.deepEqual(chunkDocument(text, { targetChars: 100 }), [{ text, translatable: true }]);
});

test('Chinese and English language detection is deterministic', () => {
  assert.equal(detectDocumentLanguage('这是中文长文本。'.repeat(20)), 'zh');
  assert.equal(detectDocumentLanguage('This is a long English document. '.repeat(20)), 'en');
});

test('long text splits on paragraph boundaries without loss or duplication', () => {
  const text = ['# 标题', '第一段。'.repeat(15), '第二段。'.repeat(15), '第三段。'.repeat(15)].join('\n\n');
  const chunks = chunkDocument(text, { targetChars: 80 });
  assert.ok(chunks.length > 1);
  assert.equal(chunks.map((chunk) => chunk.text).join(''), text);
  assert.ok(chunks.slice(0, -1).every((chunk) => /[。！？.!?]|\n\n$/.test(chunk.text)));
});

test('an oversized single paragraph prefers complete sentence boundaries', () => {
  const text = '第一句内容完整。第二句内容也完整。第三句仍然完整。第四句继续完整。';
  const chunks = chunkDocument(text, { targetChars: 18 });
  assert.ok(chunks.length > 1);
  assert.equal(chunks.map((chunk) => chunk.text).join(''), text);
  assert.ok(chunks.slice(0, -1).every((chunk) => /[。！？.!?]\s*$/.test(chunk.text)));
});

test('hard cutting is only used when no semantic boundary exists', () => {
  const text = 'A'.repeat(95);
  const chunks = chunkDocument(text, { targetChars: 30 });
  assert.equal(chunks.map((chunk) => chunk.text).join(''), text);
  assert.deepEqual(chunks.map((chunk) => chunk.text.length), [30, 30, 30, 5]);
});

test('Markdown fenced code is isolated and never marked translatable', () => {
  const text = '# Guide\n\nTranslate this paragraph.\n\n```ts\nconst label = "不要翻译";\n```\n\nFinal paragraph.';
  const chunks = chunkDocument(text, { targetChars: 40 });
  assert.equal(chunks.map((chunk) => chunk.text).join(''), text);
  const code = chunks.find((chunk) => chunk.text.includes('const label'));
  assert.equal(code?.translatable, false);
  assert.equal(extractDocumentTitle(text), 'Guide');
});

test('10k English and near-20k Chinese use conservative multi-request chunks', () => {
  const english = 'A complete English sentence for long document validation. '.repeat(190);
  const chinese = '这是一句用于验证长文稳定分块的完整中文内容。'.repeat(850).slice(0, 19_500);
  const englishChunks = chunkDocument(english);
  const chineseChunks = chunkDocument(chinese);
  assert.ok(englishChunks.length >= 2);
  assert.ok(chineseChunks.length >= 5);
  assert.equal(englishChunks.map((chunk) => chunk.text).join(''), english);
  assert.equal(chineseChunks.map((chunk) => chunk.text).join(''), chinese);
  assert.ok(Math.max(...englishChunks.map((chunk) => chunk.text.length)) <= 5200);
  assert.ok(Math.max(...chineseChunks.map((chunk) => chunk.text.length)) <= 3200);
});
