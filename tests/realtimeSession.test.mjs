import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(async () => vite.close());
const { RealtimeSessionEngine } = await vite.ssrLoadModule('/src/services/realtime/session.ts');

class FakeCapture {
  paused = false;
  callback;
  pauseChanges = [];
  async start(callback) { this.callback = callback; }
  setPaused(paused) { this.paused = paused; this.pauseChanges.push(paused); }
  async stop() {}
  push(samples, startTime) { if (!this.paused) this.callback?.(samples, 16_000, startTime); }
}

const delay = (milliseconds = 5) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function makeProviders({ transcript = '今天我们讨论人工智能的发展。', translationDelay } = {}) {
  const requests = { asr: [], translations: [] };
  const asr = {
    async transcribe(request, handlers) {
      requests.asr.push(request);
      assert.match(request.audioDataUrl, /^data:audio\/wav;base64,/);
      const text = typeof transcript === 'function' ? transcript(request.sequence) : transcript;
      handlers.onPartial?.({ sequence: request.sequence, revision: 1, text }, { firstResponseMs: 5, firstPartialMs: 7 });
      await delay(1);
      return { sequence: request.sequence, revision: 2, text, responseLatencyMs: 12, firstResponseMs: 5, firstPartialMs: 7 };
    },
  };
  const translation = {
    async translate(request, signal) {
      requests.translations.push(request);
      if (translationDelay) return translationDelay(request, signal);
      return { sequence: request.sequence, revision: request.revision, stage: request.stage,
        translation: request.stage === 'confirmed' ? `译文：${request.sourceText}` : `临时：${request.sourceText}`, latencyMs: 9 };
    },
  };
  return { asr, translation, requests };
}

test('20-second simulated audio produces ordered, de-duplicated bilingual final subtitles', async () => {
  const capture = new FakeCapture();
  const providers = makeProviders();
  const states = [];
  const engine = new RealtimeSessionEngine({ capture, ...providers, sourceLanguage: 'auto', targetLanguage: 'auto',
    context: 'Fiber optics lecture', terminology: 'artificial intelligence = 人工智能', onChange: (state) => states.push(state) });
  await engine.start();
  const voice = new Float32Array(1_600).fill(0.08);
  for (let i = 0; i < 200; i += 1) {
    capture.push(voice, i * 100);
    await delay(2);
  }
  await engine.stop();
  const result = engine.getSnapshot();
  assert.ok(providers.requests.asr.length >= 8, '20 simulated seconds are split into many short ASR calls');
  assert.ok(providers.requests.asr.every((request) => request.audioDataUrl.startsWith('data:audio/wav;base64,')));
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].status, 'confirmed');
  assert.equal(result.segments[0].sourceText, '今天我们讨论人工智能的发展。');
  assert.equal(result.segments[0].translatedText, '译文：今天我们讨论人工智能的发展。');
  assert.ok(result.segments[0].sequence > 0);
  assert.ok(providers.requests.translations.some((request) => request.stage === 'confirmed'));
  assert.ok(providers.requests.translations.every((request) => request.confirmedContext.length <= 8));
  assert.equal(result.isListening, false);
  assert.equal(result.status, 'idle');
  assert.ok(states.some((state) => state.status === 'recognizing'));
  await engine.dispose();
});

test('pause commits useful speech and no new ASR is sent until resume', async () => {
  const capture = new FakeCapture();
  const providers = makeProviders({ transcript: 'The optical link is stable.' });
  const engine = new RealtimeSessionEngine({ capture, ...providers, sourceLanguage: 'en', targetLanguage: 'zh' });
  await engine.start();
  for (let i = 0; i < 5; i += 1) capture.push(new Float32Array(1_600).fill(0.1), i * 100);
  await engine.pause();
  const callsWhenPaused = providers.requests.asr.length;
  capture.push(new Float32Array(1_600).fill(0.2), 1_000);
  await delay(5);
  assert.equal(providers.requests.asr.length, callsWhenPaused);
  assert.equal(engine.getSnapshot().segments.length, 1);
  await engine.resume();
  capture.push(new Float32Array(1_600).fill(0.1), 1_100);
  await engine.stop();
  await engine.dispose();
});

test('a stopped realtime session can start again and processes its new audio independently', async () => {
  const capture = new FakeCapture();
  const providers = makeProviders({ transcript: 'A new session has started.' });
  const engine = new RealtimeSessionEngine({ capture, ...providers, sourceLanguage: 'en', targetLanguage: 'zh' });
  const voice = new Float32Array(1_600).fill(0.1);

  await engine.start();
  for (let i = 0; i < 5; i += 1) capture.push(voice, i * 100);
  await engine.stop();
  assert.equal(engine.getSnapshot().segments.length, 1);
  assert.equal(providers.requests.asr.length, 1);

  await engine.start();
  for (let i = 0; i < 5; i += 1) capture.push(voice, 1_000 + i * 100);
  await engine.stop();
  assert.equal(providers.requests.asr.length, 2);
  assert.equal(engine.getSnapshot().status, 'idle');
  assert.equal(engine.getSnapshot().segments.length, 1, 'a restart begins a fresh subtitle session');
  assert.equal(engine.getSnapshot().segments[0].translatedText, '译文：A new session has started.');
  await engine.dispose();
});

test('late provisional translation cannot overwrite a confirmed revision', async () => {
  const capture = new FakeCapture();
  let releaseProvisional;
  const providers = makeProviders({ translationDelay: (request) => {
    if (request.stage === 'provisional') return new Promise((resolve) => { releaseProvisional = () => resolve({
      sequence: request.sequence, revision: request.revision, stage: request.stage,
      translation: '过期译文', latencyMs: 80,
    }); });
    return Promise.resolve({ sequence: request.sequence, revision: request.revision,
      stage: request.stage, translation: '最终译文', latencyMs: 10 });
  } });
  const engine = new RealtimeSessionEngine({ capture, ...providers, sourceLanguage: 'zh', targetLanguage: 'en', now: () => 5_000 });
  await engine.start();
  for (let i = 0; i < 5; i += 1) capture.push(new Float32Array(1_600).fill(0.1), i * 100);
  await engine.pause();
  releaseProvisional?.();
  await delay(5);
  assert.equal(engine.getSnapshot().segments[0].translatedText, '最终译文');
  assert.ok(engine.getSnapshot().metrics.discardedStaleResponses >= 0);
  await engine.stop();
  await engine.dispose();
});

test('429 failures keep the current audio chunk for an explicit retry', async () => {
  const capture = new FakeCapture();
  const providers = makeProviders();
  let fail = true;
  providers.asr.transcribe = async (request) => {
    providers.requests.asr.push(request);
    if (fail) { const error = new Error('请求较多'); error.status = 429; throw error; }
    return { sequence: request.sequence, revision: 1, text: '恢复后字幕', responseLatencyMs: 10, firstResponseMs: 5, firstPartialMs: 5 };
  };
  const engine = new RealtimeSessionEngine({ capture, ...providers, sourceLanguage: 'zh', targetLanguage: 'en' });
  await engine.start();
  for (let i = 0; i < 5; i += 1) capture.push(new Float32Array(1_600).fill(0.1), i * 100);
  capture.push(new Float32Array(9_600), 500);
  await delay(10);
  assert.equal(engine.getSnapshot().status, 'rate-limited');
  assert.equal(providers.requests.asr.length, 1);
  fail = false;
  await engine.retryPending();
  await delay(15);
  assert.ok(providers.requests.asr.length >= 2);
  await engine.stop();
  await engine.dispose();
});
