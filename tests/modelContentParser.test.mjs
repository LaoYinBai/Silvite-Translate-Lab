import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelContent } from '../functions/api/translate.js';

const FALLBACK = {
  sourceLanguage: 'en',
  targetLanguage: 'zh',
  detectedStyle: 'natural',
};

const validPayload = JSON.stringify({
  source_language: 'en',
  target_language: 'zh',
  detected_style: 'literary',
  translation: '完整的译文',
  segments: [],
  notes: [],
});

test('valid JSON parses without recovery', () => {
  const r = parseModelContent(validPayload, FALLBACK, 'stop');
  assert.equal(r.ok, true);
  assert.equal(r.value.translation, '完整的译文');
  assert.equal(r.recovery, undefined);
});

test('fenced JSON parses', () => {
  const r = parseModelContent('```json\n' + validPayload + '\n```', FALLBACK, 'stop');
  assert.equal(r.ok, true);
  assert.equal(r.value.translation, '完整的译文');
});

test('unescaped quotes get repaired with recovery note', () => {
  const broken = '{"source_language":"zh","translation":"ok","notes":[{"source":"银行","reason":"此处"银行"指河岸"}]}';
  const r = parseModelContent(broken, FALLBACK, 'stop');
  assert.equal(r.ok, true);
  assert.equal(r.recovery, 'quote_repair');
  assert.equal(r.value.notes[0].source, '银行');
});

test('double encoded JSON gets unwrapped', () => {
  const inner = JSON.stringify({ source_language: 'ja', translation: '真译文', segments: [] });
  const outer = JSON.stringify({ source_language: 'ja', translation: inner, segments: [] });
  const r = parseModelContent(outer, FALLBACK, 'stop');
  assert.equal(r.ok, true);
  assert.equal(r.recovery, 'double_encoded');
  assert.equal(r.value.translation, '真译文');
});

test('plain text keeps raw-text fallback', () => {
  const r = parseModelContent('这不是 JSON', FALLBACK, 'stop');
  assert.equal(r.ok, true);
  assert.equal(r.recovery, 'plain_text');
  assert.equal(r.value.translation, '这不是 JSON');
});

test('truncated structured JSON never falls back to raw text (finish stop)', () => {
  const truncated = '{"source_language":"en","target_language":"zh","translation":"很长的译文，被截断在这里';
  const r = parseModelContent(truncated, FALLBACK, 'stop');
  assert.equal(r.ok, false);
  assert.match(r.reason, /truncated_json|malformed_json/);
});

test('finish_reason=length forces truncated classification', () => {
  const truncated = '{"source_language":"en","notes":[{"source":"半截';
  const r = parseModelContent(truncated, FALLBACK, 'length');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'truncated_json');
});

test('truncated notes array (closed braces missing) is rejected', () => {
  const truncated = '{"source_language":"en","target_language":"zh","translation":"done","notes":[{"source":"a","translation":"b"';
  const r = parseModelContent(truncated, FALLBACK, 'stop');
  assert.equal(r.ok, false);
  assert.match(r.reason, /truncated_json|malformed_json/);
});

test('empty content reports empty', () => {
  const r = parseModelContent('   ', FALLBACK, null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty');
});
