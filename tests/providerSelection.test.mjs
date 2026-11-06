import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, listProviders, resolveProvider } from '../cloud-functions/api/translate.js';
import { mimoSseResponse, readSseEvents, makeRequest } from './helpers.mjs';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const ENV = { DEEPSEEK_API_KEY: 'deepseek-test-key', RATE_LIMIT: '100' };

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
  assert.deepEqual(providers.map((provider) => provider.id), ['deepseek', 'glm']);
  assert.equal(providers.find((provider) => provider.id === 'deepseek').label, 'DeepSeek Flash');
  assert.equal(providers.find((provider) => provider.id === 'glm').model, 'glm-5.3-flash');
});

test('a request without a model uses DeepSeek Flash with thinking disabled', async () => {
  const captured = captureFetch();
  const response = await onRequest({ request: makeRequest({ text: 'Hello', mode: 'natural' }), env: ENV });
  assert.equal(response.status, 200);

  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, DEEPSEEK_URL);
  assert.equal(captured[0].headers.Authorization, 'Bearer deepseek-test-key');
  assert.equal(captured[0].body.model, 'deepseek-flash');
  assert.deepEqual(captured[0].body.thinking, { type: 'disabled' });
  assert.ok(captured[0].body.max_tokens > 0);
  assert.equal(captured[0].body.stream, true);
});

test('removed MiMo translation selection uses the DeepSeek default', () => {
  assert.equal(resolveProvider('mimo', { MIMO_MODEL: 'mimo-v2.5' }).model, 'deepseek-flash');
});

test('selecting DeepSeek routes to its endpoint with thinking disabled', async () => {
  const captured = captureFetch();
  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'natural', model: 'deepseek' }),
    env: ENV,
  });
  const events = await readSseEvents(response);

  assert.equal(response.status, 200);
  assert.equal(captured[0].url, DEEPSEEK_URL);
  assert.equal(captured[0].headers.Authorization, 'Bearer deepseek-test-key');
  assert.equal(captured[0].body.model, 'deepseek-flash');
  assert.deepEqual(captured[0].body.thinking, { type: 'disabled' });
  assert.ok(captured[0].body.max_tokens > 0);
  // The shared pipeline still delivers the canonical result to the client.
  assert.equal(events.find((event) => event.type === 'final').result.translation, '译文');
});

test('GLM uses the shared gateway credentials and its exact catalog model ID', async () => {
  const captured = captureFetch();
  const response = await onRequest({
    request: makeRequest({ text: 'Hello', model: 'glm' }),
    env: { ...ENV, DEEPSEEK_BASE_URL: 'https://gateway.example/v1' },
  });
  assert.equal(response.status, 200);
  assert.equal(captured[0].url, 'https://gateway.example/v1/chat/completions');
  assert.equal(captured[0].headers.Authorization, 'Bearer deepseek-test-key');
  assert.equal(captured[0].body.model, 'glm-5.3-flash');
  assert.deepEqual(captured[0].body.thinking, { type: 'disabled' });
  assert.equal(response.headers.get('X-Translation-Provider'), 'glm');
});

test('an unknown provider id falls back to the default instead of failing', async () => {
  const captured = captureFetch();
  const response = await onRequest({
    request: makeRequest({ text: 'Hello', model: 'gpt-5' }),
    env: ENV,
  });
  assert.equal(response.status, 200);
  assert.equal(captured[0].url, DEEPSEEK_URL);
});

test('a provider without a configured key fails clearly and never calls upstream', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not be called'); };
  const response = await onRequest({
    request: makeRequest({ text: 'Hello', model: 'deepseek' }),
    env: { RATE_LIMIT: '100' },
  });
  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.match(payload.error, /deepseek/);
  assert.equal(calls, 0);
});

test('provider endpoint and output ceiling are configurable while model overrides cannot select a different candidate', async () => {
  const captured = captureFetch();
  await onRequest({
    request: makeRequest({ text: 'x'.repeat(9000), model: 'deepseek' }),
    env: { ...ENV, DEEPSEEK_MODEL: 'gateway-flash', DEEPSEEK_BASE_URL: 'https://example.test/v1', DEEPSEEK_MAX_COMPLETION_TOKENS: '1024' },
  });
  assert.equal(captured[0].url, 'https://example.test/v1/chat/completions');
  assert.equal(captured[0].body.model, 'deepseek-flash');
  assert.equal(captured[0].body.max_tokens, 1024, 'the budget is clamped to the provider ceiling');
});

test('resolving an absent key leaves apiKey undefined rather than throwing', () => {
  assert.equal(resolveProvider('deepseek', {}).apiKey, undefined);
  assert.equal(resolveProvider(undefined, ENV).id, 'deepseek');
});
