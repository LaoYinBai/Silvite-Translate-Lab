import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../cloud-functions/api/models.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const env = { DEEPSEEK_API_KEY: 'catalog-test-key', DEEPSEEK_BASE_URL: 'https://gateway.example/v1' };
const request = (method = 'GET') => new Request('https://local.example/api/models', { method });

test('gateway catalog returns only the two selected models and preserves exact IDs', async () => {
  let upstream;
  globalThis.fetch = async (url, init) => {
    upstream = { url: String(url), headers: init.headers };
    return Response.json({ data: [{ id: 'glm-5.3-flash' }, { id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }, { id: 'deepseek-v4.1-flash' }, { id: 'unrelated-model' }] });
  };
  const response = await onRequest({ request: request(), env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { models: [
    { id: 'deepseek-flash', provider: 'deepseek' }, { id: 'glm-5.3-flash', provider: 'glm' },
  ] });
  assert.equal(upstream.url, 'https://gateway.example/v1/models');
  assert.equal(upstream.headers.Authorization, 'Bearer catalog-test-key');
});

test('full completion URLs query the models path and preserve gateway query parameters', async () => {
  let called;
  globalThis.fetch = async (url) => { called = String(url); return Response.json({ data: [] }); };
  await onRequest({ request: request(), env: { ...env, DEEPSEEK_BASE_URL: 'https://gateway.example/v1/chat/completions/?region=test' } });
  assert.equal(called, 'https://gateway.example/v1/models?region=test');
});

test('catalog errors report status without exposing the upstream body', async () => {
  globalThis.fetch = async () => new Response('private gateway details', { status: 401 });
  const response = await onRequest({ request: request(), env });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'MODELS_UPSTREAM_ERROR', upstreamStatus: 401 });
});

test('missing credentials reject discovery without calling upstream', async () => {
  globalThis.fetch = async () => { throw new Error('must not call upstream'); };
  const response = await onRequest({ request: request(), env: {} });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'SERVICE_NOT_CONFIGURED' });
});

test('catalog rejects an invalid endpoint and an unsupported method', async () => {
  assert.equal((await onRequest({ request: request(), env: { ...env, DEEPSEEK_BASE_URL: 'not a URL' } })).status, 500);
  assert.equal((await onRequest({ request: request('POST'), env })).status, 405);
});
