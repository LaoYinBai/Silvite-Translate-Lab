import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(async () => vite.close());

const { normalizeExtractedText } = await vite.ssrLoadModule('/src/services/document/normalizeText.ts');
const { parseDocumentFile } = await vite.ssrLoadModule('/src/services/document/fileParser.ts');

function fileOf(parts, name, type) {
  return new File(parts, name, { type });
}

// Real PDFs in the wild map glyphs to radical code points instead of the
// ideograph itself. These cases come from actual files that extracted as
// "倒数⽇" / "⻓期" and were sent to the model unchanged.

test('Kangxi radicals fold into their unified ideographs', () => {
  assert.equal(normalizeExtractedText('⼯⼀⽇⽤⾔⾊⾳⼊⼤'), '工一日用言色音入大');
});

test('CJK Radicals Supplement characters observed in real PDFs fold correctly', () => {
  assert.equal(normalizeExtractedText('⻓⻛⻅⻔⻚⻨⻣⻩⻢'), '长风见门页麦骨黄马');
});

test('ordinary Chinese text, including fullwidth punctuation, is left alone', () => {
  const text = '这是一段正常的简体中文，包含标点！？、以及（括号）和数字 2026。';
  assert.equal(normalizeExtractedText(text), text);
});

test('characters without a compatibility mapping are not over-normalized', () => {
  // ① (enclosed) and ㎏ would be destroyed by a blanket NFKC pass.
  assert.equal(normalizeExtractedText('① ㎏ ⅓ ㊙'), '① ㎏ ⅓ ㊙');
  // Canonical equivalence is still applied: U+F900 → U+8C48 (豈).
  assert.equal(normalizeExtractedText('\uF900'), '\u8C48');
});

test('normalization is idempotent and safe on empty input', () => {
  const input = '⻓期⽇常⼯作';
  const once = normalizeExtractedText(input);
  assert.equal(normalizeExtractedText(once), once);
  assert.equal(normalizeExtractedText(''), '');
});

test('extracted text is normalized at the parser boundary', async () => {
  const parsed = await parseDocumentFile(fileOf(['⽇常表达与⻓期⼯作'], 'scan.txt', 'text/plain'));
  assert.equal(parsed.text, '日常表达与长期工作');
  assert.equal(parsed.characterCount, parsed.text.length);
});
