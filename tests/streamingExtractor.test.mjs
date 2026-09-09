import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamingTranslationExtractor } from '../functions/api/translate.js';

// Feeds a payload through the extractor in chunks of the given size and
// returns the concatenated streamed text.
function stream(payload, chunkSize = Infinity) {
  const extractor = createStreamingTranslationExtractor();
  let out = '';
  for (let i = 0; i < payload.length; i += chunkSize) {
    out += extractor.feed(payload.slice(i, i + chunkSize));
  }
  return out;
}

const payloadOf = (translation, extra = '') =>
  `{"source_language":"en","target_language":"zh","translation":${JSON.stringify(translation)}${extra}}`;

test('translation value streams, notes do not leak', () => {
  const payload = payloadOf('雨洗净了整个黄昏。', ',"segments":[],"notes":[{"source":"x","translation":"y","reason":"z"}]}');
  assert.equal(stream(payload), '雨洗净了整个黄昏。');
});

test('translation key split across chunks', () => {
  const payload = '{"source_language":"en","translat';
  const extractor = createStreamingTranslationExtractor();
  assert.equal(extractor.feed(payload), '');
  const rest = 'ion":"拆分键也能找到","notes":[]}';
  assert.equal(extractor.feed(rest), '拆分键也能找到');
});

test('translation value split across every single character', () => {
  const payload = payloadOf('逐字符切分依然正确。\n第二行。', ',"notes":[]}');
  assert.equal(stream(payload, 1), '逐字符切分依然正确。\n第二行。');
});

test('escaped newline and quotes decode', () => {
  const payload = payloadOf('第一行\n第二行"引用"', ',"notes":[]}');
  assert.equal(stream(payload), '第一行\n第二行"引用"');
});

test('escaped backslash and slash decode', () => {
  const payload = payloadOf('路径 C:\\tmp\\ 与 / 斜杠', ',"notes":[]}');
  assert.equal(stream(payload), '路径 C:\\tmp\\ 与 / 斜杠');
});

test('unicode escapes decode (including surrogate pairs)', () => {
  const payload = '{"translation":"\\u00e9\\u4e2d\\ud83d\\ude00"}';
  assert.equal(stream(payload), 'é中😀');
});

test('key appearing inside nested strings/objects never matches', () => {
  const payload = '{"meta":{"note":"fake \\"translation\\": bad"},"translation":"真译文","notes":[{"source":"\\"translation\\": more"}]}';
  assert.equal(stream(payload), '真译文');
});

test('translation after a nested object still streams', () => {
  const payload = '{"a":{"x":1},"translation":"迟到的译文"}';
  assert.equal(stream(payload), '迟到的译文');
});

test('malformed JSON starting with brace never leaks raw payload', () => {
  const payload = '{"source_language":"en","translation":"截断中...';
  assert.equal(stream(payload), '截断中...');
});

test('object that closes before the key emits nothing', () => {
  const payload = '{"a":1}';
  assert.equal(stream(payload), '');
});

test('raw plain text passes through as-is', () => {
  assert.equal(stream('这不是 JSON，就是纯文本。'), '这不是 JSON，就是纯文本。');
});

test('markdown-fenced JSON payload never leaks the fence or raw JSON', () => {
  const payload = '```json\n{"source_language":"en","translation":"围栏内译文","notes":[]}\n```';
  assert.equal(stream(payload), '围栏内译文');
});

test('fence split across chunks still resolves to structured mode', () => {
  const payload = '```json\n{"translation":"跨块围栏"}';
  const extractor = createStreamingTranslationExtractor();
  assert.equal(extractor.feed('```js'), '');
  assert.equal(extractor.feed('on\n{"transl'), '');
  assert.equal(extractor.feed('ation":"跨块围栏"}'), '跨块围栏');
});

test('reset() starts a fresh attempt', () => {
  const extractor = createStreamingTranslationExtractor();
  extractor.feed('{"translation":"第一次');
  extractor.reset();
  const out = extractor.feed('{"translation":"第二次"}');
  assert.equal(out, '第二次');
});
