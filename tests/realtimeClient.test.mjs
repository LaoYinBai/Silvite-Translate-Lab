import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(async () => vite.close());
const { transcribeRealtimeAudio, translateRealtimeSegment } = await vite.ssrLoadModule('/src/api/realtimeClient.ts');
const { withRealtimeRetry, RealtimeApiError } = await vite.ssrLoadModule('/src/services/realtime/retry.ts');

function sse(events) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

test('realtime ASR parses SSE partial/final transcript and reports first-response metrics', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/realtime/transcribe');
    requestBody = JSON.parse(init.body);
    return sse([
      { type: 'partial', sequence: 9, revision: 1, text: '今天讨论' },
      { type: 'final', sequence: 9, revision: 2, text: '今天讨论光链路。' },
    ]);
  };
  const partials = [];
  try {
    const result = await transcribeRealtimeAudio({
      audioDataUrl: 'data:audio/wav;base64,AAAA', language: 'auto', sequence: 9,
    }, { onPartial: (event, timing) => partials.push({ event, timing }) });
    assert.equal(requestBody.sequence, 9);
    assert.equal(result.text, '今天讨论光链路。');
    assert.equal(result.revision, 2);
    assert.equal(partials.length, 1);
    assert.ok(result.responseLatencyMs >= 0);
    assert.ok(result.firstResponseMs >= 0);
    assert.ok(result.firstPartialMs >= 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('realtime ASR discards events for an obsolete sequence and an older revision', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => sse([
    { type: 'final', sequence: 8, revision: 9, text: 'stale sequence' },
    { type: 'partial', sequence: 9, revision: 2, text: 'current transcript' },
    { type: 'final', sequence: 9, revision: 1, text: 'older revision' },
    { type: 'final', sequence: 9, revision: 3, text: 'confirmed transcript' },
  ]);
  try {
    const result = await transcribeRealtimeAudio({
      audioDataUrl: 'data:audio/wav;base64,AAAA', language: 'auto', sequence: 9,
    });
    assert.equal(result.sequence, 9);
    assert.equal(result.revision, 3);
    assert.equal(result.text, 'confirmed transcript');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('realtime translation rejects a response for a stale sequence or revision', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    sequence: 4, revision: 6, stage: 'provisional', translation: '旧译文',
  });
  try {
    await assert.rejects(() => translateRealtimeSegment({
      sourceText: 'new text', sourceLanguage: 'en', targetLanguage: 'zh',
      stage: 'provisional', sequence: 4, revision: 7,
    }), (error) => error instanceof RealtimeApiError && error.code === 'STALE_TRANSLATION_RESPONSE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rate-limit retries use bounded exponential backoff with jitter and stop after the configured limit', async () => {
  let attempts = 0;
  const delays = [];
  const notices = [];
  const result = await withRealtimeRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new RealtimeApiError('limited', 429, 'RATE_LIMITED');
    return 'done';
  }, {
    maxRetries: 2,
    baseDelayMs: 100,
    maxDelayMs: 500,
    jitterRatio: 0.2,
    random: () => 0.5,
    sleep: async (delay) => { delays.push(delay); },
    onRetry: (notice) => notices.push(notice),
  });
  assert.equal(result, 'done');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
  assert.equal(notices.filter((notice) => notice.rateLimited).length, 2);

  attempts = 0;
  await assert.rejects(() => withRealtimeRetry(async () => {
    attempts += 1;
    throw new RealtimeApiError('still limited', 429, 'RATE_LIMITED');
  }, { maxRetries: 1, sleep: async () => {}, random: () => 0.5 }));
  assert.equal(attempts, 2, 'one initial request and at most one retry');
});

test('abort during retry delay prevents another request', async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(() => withRealtimeRetry(async () => {
    attempts += 1;
    throw new TypeError('network disconnected');
  }, {
    signal: controller.signal,
    sleep: async (_delay, signal) => {
      controller.abort(new DOMException('Stopped', 'AbortError'));
      if (signal.aborted) throw signal.reason;
    },
  }));
  assert.equal(attempts, 1);
});
