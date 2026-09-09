import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, composeTranslationPrompt } from '../functions/api/translate.js';

const MIMO_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const ENV = { MIMO_API_KEY: 'test-key', RATE_LIMIT: '10' };

function makeRequest(body, extraHeaders = {}) {
  return new Request('http://localhost:3001/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function fakeMimoResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(MIMO_URL)) {
      return fakeMimoResponse(JSON.stringify({
        source_language: 'en',
        target_language: 'zh',
        detected_style: 'academic',
        translation: '测试译文',
        segments: [],
        notes: [],
      }));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
});

test('academic mode reaches MiMo with academic prompt, context and terminology', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url).startsWith(MIMO_URL), true);
    captured = JSON.parse(init.body);
    return fakeMimoResponse(JSON.stringify({
      source_language: 'en',
      target_language: 'zh',
      detected_style: 'academic',
      translation: '译文',
      segments: [],
      notes: [],
    }));
  };

  const response = await onRequest({
    request: makeRequest({ text: 'Hello world', mode: 'academic', context: '论文摘要', terminology: 'PI3K 保留' }),
    env: ENV,
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(captured.model, 'mimo-v2.5');
  assert.match(captured.messages[0].content, /学术与技术模式/);
  assert.match(captured.messages[0].content, /论文摘要/);
  assert.match(captured.messages[0].content, /PI3K 保留/);
  assert.equal(payload.detected_style, 'academic');
  assert.equal(payload.source_language, 'en');
  assert.equal(payload.target_language, 'zh');
});

test('unknown mode falls back to dynamic auto prompt', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return fakeMimoResponse(JSON.stringify({
      source_language: 'zh',
      target_language: 'en',
      detected_style: 'natural',
      translation: 'ok',
      segments: [],
      notes: [],
    }));
  };

  const response = await onRequest({
    request: makeRequest({ text: '你好', mode: 'nonexistent' }),
    env: ENV,
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(captured.messages[0].content, /自动模式/);
  assert.doesNotMatch(captured.messages[0].content, /# 自然模式/);
  assert.equal(payload.detected_style, 'natural');
});

test('comic image request combines comic prompt with visual input', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return fakeMimoResponse(JSON.stringify({
      source_language: 'zh',
      target_language: 'en',
      detected_style: 'comic',
      translation: 'panel text',
      segments: [{ type: 'dialogue', source: '你好', translation: 'Hello' }],
      notes: [],
    }));
  };

  const response = await onRequest({
    request: makeRequest({ imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=', mode: 'comic' }),
    env: ENV,
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(captured.messages[0].content, /漫画模式/);
  assert.equal(captured.messages[1].content[0].image_url.url, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(payload.segments[0].type, 'dialogue');
});

test('invalid model JSON does not escape to a 500', async () => {
  globalThis.fetch = async () => fakeMimoResponse('这不是 JSON');

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'auto' }),
    env: ENV,
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.translation, '这不是 JSON');
  assert.equal(payload.source_language, 'en');
});

test('model reporting unknown language gets normalized', async () => {
  globalThis.fetch = async () => fakeMimoResponse(JSON.stringify({
    source_language: 'unknown',
    target_language: 'unknown',
    translation: '今天天气真好',
    segments: [],
    notes: [],
  }));

  const response = await onRequest({
    request: makeRequest({ text: 'Bonjour', mode: 'auto' }),
    env: ENV,
  });
  const payload = await response.json();

  assert.equal(payload.source_language, 'en');
  assert.equal(payload.target_language, 'zh');
});

test('service can be disabled via env', async () => {
  const response = await onRequest({
    request: makeRequest({ text: 'Hello' }),
    env: { ...ENV, SERVICE_ENABLED: 'false' },
  });

  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.match(payload.error, /offline/);
});

test('missing body returns 400', async () => {
  const response = await onRequest({ request: makeRequest({}), env: ENV });
  assert.equal(response.status, 400);
});

test('OPTIONS preflight returns 200', async () => {
  const response = await onRequest({
    request: new Request('http://localhost:3001/api/translate', { method: 'OPTIONS' }),
    env: ENV,
  });
  assert.equal(response.status, 200);
});

test('rate limit returns 429 after exceeding limit', async () => {
  const limitedEnv = { ...ENV, RATE_LIMIT: '2' };
  const headers = { 'x-forwarded-for': '203.0.113.9' };

  await onRequest({ request: makeRequest({ text: 'a' }, headers), env: limitedEnv });
  await onRequest({ request: makeRequest({ text: 'b' }, headers), env: limitedEnv });
  const third = await onRequest({ request: makeRequest({ text: 'c' }, headers), env: limitedEnv });

  assert.equal(third.status, 429);
});
