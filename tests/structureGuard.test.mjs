import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, countBlocks, hasBlockLoss } from '../cloud-functions/api/translate.js';
import { mimoSseResponse, readSseEvents, finalEventOf, makeRequest } from './helpers.mjs';

const ENV = { MIMO_API_KEY: 'test-key', RATE_LIMIT: '10' };

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error('fetch should be stubbed per-test');
  };
});

function finalResult(translation) {
  return {
    source_language: 'en',
    target_language: 'zh',
    detected_style: 'business',
    translation,
    detected_text: null,
    segments: [],
    notes: [],
  };
}

test('paragph structure is compared by block count', () => {
  assert.equal(countBlocks('a\n\nb\n\nc'), 3);
  assert.equal(countBlocks('a\n \n\n b'), 2);
  assert.equal(countBlocks(''), 0);
  assert.equal(countBlocks(undefined), 0);
});

test('merging source paragraphs is detected, splitting is not', () => {
  const source = '第一段。\n\n第二段。\n\n第三段。\n\n第四段。';
  assert.equal(hasBlockLoss(source, '第一段。\n\n第二段。\n\n第三段。\n\n第四段。'), false);
  assert.equal(hasBlockLoss(source, '第一段。\n\n第二段。\n\n第三段。第四段。'), true, 'two blocks merged into one');
  assert.equal(hasBlockLoss(source, '第一段。\n\n第二段。\n\n第三段。\n\n第四段。\n\n第五段。'), false, 'splitting is not a loss');
});

test('short sources are exempt from the structure guard', () => {
  assert.equal(hasBlockLoss('one\n\ntwo', 'one two'), false);
});

test('image requests have no comparable source and are never flagged', () => {
  assert.equal(hasBlockLoss(undefined, '任意译文'), false);
});

test('a merged translation is retried once and the structure is re-requested', async () => {
  const source = '第一段。\n\n第二段。\n\n第三段。\n\n第四段。';
  const attempts = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const userMessage = body.messages.find((message) => message.role === 'user');
    attempts.push(userMessage.content);
    // First attempt merges the last two paragraphs; the retry preserves them.
    const merged = attempts.length === 1;
    return mimoSseResponse(JSON.stringify(finalResult(
      merged ? '第一段。\n\n第二段。\n\n第三段。第四段。' : '第一段。\n\n第二段。\n\n第三段。\n\n第四段。',
    )));
  };

  const response = await onRequest({ request: makeRequest({ text: source, mode: 'business' }), env: ENV });
  const events = await readSseEvents(response);

  assert.equal(attempts.length, 2, 'the structure failure must trigger exactly one retry');
  assert.ok(events.some((event) => event.type === 'reset'), 'the provisional text is reset before the retry');
  const result = finalEventOf(events);
  assert.equal(countBlocks(result.translation), 4);
});
