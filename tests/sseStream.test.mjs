import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseEventParser, consumeMimoSse } from '../cloud-functions/api/translate.js';

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

test('single chunk with a single event', () => {
  const parser = createSseEventParser();
  const events = parser.push('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].json.choices[0].delta.content, 'hi');
});

test('single chunk with multiple events', () => {
  const parser = createSseEventParser();
  const events = parser.push('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c":3}\n\n');
  assert.equal(events.length, 3);
  assert.equal(events[2].json.c, 3);
});

test('event split across chunks is assembled', () => {
  const parser = createSseEventParser();
  assert.deepEqual(parser.push('data: {"choices":[{"del'), []);
  const events = parser.push('ta":{"content":"xy"}}]}\n\ndata: [DONE]\n\n');
  assert.equal(events.length, 2);
  assert.equal(events[0].json.choices[0].delta.content, 'xy');
  assert.equal(events[1].done, true);
});

test('CRLF line endings are handled', () => {
  const parser = createSseEventParser();
  const events = parser.push('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n');
  assert.equal(events.length, 2);
});

test('malformed SSE lines are skipped without breaking the stream', () => {
  const parser = createSseEventParser();
  const events = parser.push('data: {broken json\n\ndata: {"ok":true}\n\n: comment\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].json.ok, true);
});

test('non-data lines are ignored', () => {
  const parser = createSseEventParser();
  const events = parser.push(': ping\n\nevent: message\ndata: {"a":1}\n\n');
  assert.equal(events.length, 1);
});

test('multi-byte characters split across chunks decode correctly', async () => {
  // Encode the SSE text, then split the raw bytes mid-character so a single
  // UTF-8 sequence spans two stream reads.
  const line = 'data: {"choices":[{"delta":{"content":"雨洗净了黄昏"}}]}\n\n';
  const bytes = new TextEncoder().encode(line);
  const splitAt = bytes.length - 6; // lands inside the trailing CJK bytes
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, splitAt));
      controller.enqueue(bytes.slice(splitAt));
      controller.close();
    },
  });
  const { content } = await consumeMimoSse(new Response(stream), null);
  assert.equal(content, '雨洗净了黄昏');
});

test('consumeMimoSse accumulates content and captures finish_reason', async () => {
  const response = sseResponse([
    'data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  const deltas = [];
  const { content, finishReason } = await consumeMimoSse(response, (d) => deltas.push(d));
  assert.equal(content, '第一段第二段');
  assert.equal(finishReason, 'stop');
  assert.deepEqual(deltas, ['第一段', '第二段']);
});

test('consumeMimoSse handles empty stream (no content)', async () => {
  const response = sseResponse([
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  const { content, finishReason } = await consumeMimoSse(response, null);
  assert.equal(content, '');
  assert.equal(finishReason, 'stop');
});

test('consumeMimoSse keeps last finish_reason when repeated', async () => {
  const response = sseResponse([
    'data: {"choices":[{"delta":{"content":"x"},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  const { finishReason } = await consumeMimoSse(response, null);
  assert.equal(finishReason, 'length');
});
