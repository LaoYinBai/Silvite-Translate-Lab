import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { useTranslationStore } = await vite.ssrLoadModule('/src/store/translationStore.ts');
const originalFetch = globalThis.fetch;

after(async () => {
  globalThis.fetch = originalFetch;
  await vite.close();
});

beforeEach(() => {
  globalThis.fetch = originalFetch;
  useTranslationStore.getState().reset();
});

function frame(event) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function result(translation) {
  return { source_language: 'en', target_language: 'zh', translation, segments: [], notes: [] };
}

function controlledFetch() {
  const streams = [];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { streams.push(controller); },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  return streams;
}

function finish(controller, translation) {
  controller.enqueue(frame({ type: 'delta', text: translation }));
  controller.enqueue(frame({ type: 'final', result: result(translation) }));
  controller.close();
}

test('translate in flight followed by reset cannot restore old state', async () => {
  const streams = controlledFetch();
  useTranslationStore.getState().setInputText('A');
  const pending = useTranslationStore.getState().translate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  useTranslationStore.getState().reset();
  finish(streams[0], '旧译文');
  await pending;
  const state = useTranslationStore.getState();
  assert.equal(state.inputText, '');
  assert.equal(state.result, null);
  assert.equal(state.error, null);
});
test('translate in flight followed by demo load cannot overwrite demo', async () => {
  const streams = controlledFetch();
  useTranslationStore.getState().setInputText('A');
  const pending = useTranslationStore.getState().translate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await useTranslationStore.getState().loadDemoSample(0);
  finish(streams[0], '旧译文');
  await pending;
  const state = useTranslationStore.getState();
  assert.equal(state.isDemoMode, true);
  assert.equal(state.result?.source, 'demo');
});

test('translation A returning after translation B never overwrites B', async () => {
  const streams = controlledFetch();
  useTranslationStore.getState().setInputText('A');
  const requestA = useTranslationStore.getState().translate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  useTranslationStore.getState().setInputText('B');
  const requestB = useTranslationStore.getState().translate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  finish(streams[1], '译文 B');
  await requestB;
  finish(streams[0], '迟到的译文 A');
  await requestA;
  assert.equal(useTranslationStore.getState().result?.translation, '译文 B');
});

test('aborted request ignores every stale delta and final without showing failure', async () => {
  const streams = controlledFetch();
  useTranslationStore.getState().setInputText('A');
  const pending = useTranslationStore.getState().translate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  useTranslationStore.getState().reset();
  streams[0].enqueue(frame({ type: 'delta', text: '泄漏内容' }));
  streams[0].enqueue(frame({ type: 'reset', reason: 'transport_interrupted' }));
  finish(streams[0], '泄漏结果');
  await pending;
  const state = useTranslationStore.getState();
  assert.equal(state.streamingText, '');
  assert.equal(state.result, null);
  assert.equal(state.error, null);
});
