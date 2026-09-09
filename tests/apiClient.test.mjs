import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { translateStream } = await vite.ssrLoadModule('/src/api/client.ts');

after(async () => {
  await vite.close();
});

function eventChunk(event) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

test('browser transport interruption resets provisional text and retries once', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 2) {
      const result = {
        source_language: 'en',
        target_language: 'zh',
        translation: '完整重试译文',
        segments: [],
        notes: [],
      };
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(eventChunk({ type: 'start', mode: 'auto' }));
          controller.enqueue(eventChunk({ type: 'delta', text: '完整重试译文' }));
          controller.enqueue(eventChunk({ type: 'final', result }));
          controller.close();
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }

    let sentChunk = false;
    return new Response(new ReadableStream({
      pull(controller) {
        if (sentChunk) {
          controller.error(new Error('downstream connection reset'));
          return;
        }
        sentChunk = true;
        controller.enqueue(eventChunk({ type: 'delta', text: '半篇译文' }));
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  const observed = [];
  try {
    const result = await translateStream({ text: 'Hello' }, {
      onDelta: (text) => observed.push(`delta:${text}`),
      onReset: (reason) => observed.push(`reset:${reason}`),
    });

    assert.equal(calls, 2);
    assert.deepEqual(observed, [
      'delta:半篇译文',
      'reset:transport_interrupted',
      'delta:完整重试译文',
    ]);
    assert.equal(result.translation, '完整重试译文');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('received final result is not discarded if the connection closes immediately afterward', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls > 1) throw new Error('must not retry after final');

    const result = {
      source_language: 'en',
      target_language: 'zh',
      translation: '已完成译文',
      segments: [],
      notes: [],
    };
    let sentFinal = false;
    return new Response(new ReadableStream({
      pull(controller) {
        if (sentFinal) {
          controller.error(new Error('connection reset after final'));
          return;
        }
        sentFinal = true;
        controller.enqueue(eventChunk({ type: 'final', result }));
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const result = await translateStream({ text: 'Hello' }, {});
    assert.equal(calls, 1);
    assert.equal(result.translation, '已完成译文');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
