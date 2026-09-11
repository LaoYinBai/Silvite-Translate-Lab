import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, listProviders, resolveProvider } from '../cloud-functions/api/translate.js';
import { mimoSseResponse, readSseEvents, makeRequest } from './helpers.mjs';

const MIMO_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ENV = { MIMO_API_KEY: 'mimo-test-key', GLM_API_KEY: 'glm-test-key', RATE_LIMIT: '100' };

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error('fetch should be stubbed per-test');
  };
});

function captureFetch() {
  const captured = [];
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return mimoSseResponse(JSON.stringify({
      source_language: 'en',
      target_language: 'zh',
      detected_style: 'natural',
      translation: '译文',
      detected_text: null,
      segments: [],
      notes: [],
    }));
  };
  return captured;
}

test('both providers are registered and advertised', () => {
  const providers = listProviders();
  assert.deepEqual(providers.map((provider) => provider.id), ['mimo', 'glm']);
  assert.equal(providers.find((provider) => provider.id === 'glm').label, 'GLM-4.6V-Flash');
});

test('a request without a model keeps the previous MiMo path byte-for-byte', async () => {
  const captured = captureFetch();
  const response = await onRequest({ request: makeRequest({ text: 'Hello', mode: 'natural' }), env: ENV });
  assert.equal(response.status, 200);

  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, MIMO_URL);
  assert.equal(captured[0].headers.Authorization, 'Bearer mimo-test-key');
  assert.equal(captured[0].body.model, 'mimo-v2.5');
  assert.deepEqual(captured[0].body.thinking, { type: 'disabled' });
  assert.ok(captured[0].body.max_completion_tokens > 0);
  assert.equal(captured[0].body.stream, true);
});

test('selecting GLM routes to the Zhipu endpoint with its own key and shape', async () => {
  const captured = captureFetch();
  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'natural', model: 'glm' }),
    env: ENV,
  });
  const events = await readSseEvents(response);

  assert.equal(response.status, 200);
  assert.equal(captured[0].url, GLM_URL);
  assert.equal(captured[0].headers.Authorization, 'Bearer glm-test-key');
  assert.equal(captured[0].body.model, 'glm-4.6v-flash');
  assert.equal(captured[0].body.thinking, undefined, 'GLM must not receive MiMo-only parameters');
  assert.ok(captured[0].body.max_tokens > 0);
  // The shared pipeline still delivers the canonical result to the client.
  assert.equal(events.find((event) => event.type === 'final').result.translation, '译文');
});

test('an unknown provider id falls back to the default instead of failing', async () => {
  const captured = captureFetch();
  const response = await onRequest({
    request: makeRequest({ text: 'Hello', model: 'gpt-5' }),
    env: ENV,
  });
  assert.equal(response.status, 200);
  assert.equal(captured[0].url, MIMO_URL);
});

test('a provider without a configured key fails clearly and never calls upstream', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not be called'); };
  const response = await onRequest({
    request: makeRequest({ text: 'Hello', model: 'glm' }),
    env: { MIMO_API_KEY: 'mimo-test-key', RATE_LIMIT: '100' },
  });
  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.match(payload.error, /glm/);
  assert.equal(calls, 0);
});

test('provider endpoint, model and output ceiling are environment overridable', async () => {
  const captured = captureFetch();
  await onRequest({
    request: makeRequest({ text: 'x'.repeat(9000), model: 'glm' }),
    env: { ...ENV, GLM_MODEL: 'glm-4.6v', GLM_BASE_URL: 'https://example.test/glm', GLM_MAX_COMPLETION_TOKENS: '1024' },
  });
  assert.equal(captured[0].url, 'https://example.test/glm');
  assert.equal(captured[0].body.model, 'glm-4.6v');
  assert.equal(captured[0].body.max_tokens, 1024, 'the budget is clamped to the provider ceiling');
});

test('resolving an absent key leaves apiKey undefined rather than throwing', () => {
  assert.equal(resolveProvider('glm', {}).apiKey, undefined);
  assert.equal(resolveProvider(undefined, ENV).id, 'mimo');
});
