import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/translate.js';

const MIMO_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const ENV = { MIMO_API_KEY: 'test-key', RATE_LIMIT: '10' };

// Each request gets its own source IP so the module-level rate limiter
// cannot leak between tests (retries multiply the call count).
let requestIpCounter = 0;
function makeRequest(body, extraHeaders = {}) {
  const ip = extraHeaders['x-forwarded-for'] || `test-ip-${++requestIpCounter}`;
  return new Request('http://localhost:3001/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

// Builds a fake MiMo SSE response carrying the given content as stream
// deltas. Optional per-call behavior array for retry scenarios.
function mimoSseResponse(content, { finishReason = 'stop' } = {}) {
  const parts = [];
  if (content) {
    parts.push(JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] }));
  }
  parts.push(JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] }));
  parts.push('[DONE]');
  const text = parts.map((p) => `data: ${p}\n\n`).join('');
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// Parses the NDJSON response body into events.
async function readNdjson(response) {
  const text = await response.text();
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function finalEventOf(events) {
  return events.find((e) => e.type === 'final')?.result;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error('fetch should be stubbed per-test');
  };
});

test('academic mode reaches MiMo with academic prompt, context and terminology', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url).startsWith(MIMO_URL), true);
    captured = JSON.parse(init.body);
    return mimoSseResponse(JSON.stringify({
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
  const events = await readNdjson(response);

  assert.equal(response.status, 200);
  assert.equal(captured.model, 'mimo-v2.5');
  assert.equal(captured.stream, true);
  assert.equal(captured.thinking.type, 'disabled');
  assert.match(captured.messages[0].content, /学术与技术模式/);
  assert.match(captured.messages[0].content, /论文摘要/);
  assert.match(captured.messages[0].content, /PI3K 保留/);
  const final = finalEventOf(events);
  assert.equal(final.detected_style, 'academic');
  assert.equal(final.source_language, 'en');
  assert.equal(final.target_language, 'zh');
  assert.equal(events[0].type, 'start');
  assert.equal(events[0].mode, 'academic');
});

test('unknown mode falls back to dynamic auto prompt', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return mimoSseResponse(JSON.stringify({
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
  const events = await readNdjson(response);

  assert.match(captured.messages[0].content, /自动模式/);
  assert.doesNotMatch(captured.messages[0].content, /# 自然模式/);
  assert.equal(finalEventOf(events).detected_style, 'natural');
});

test('comic image request combines comic prompt with visual input', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return mimoSseResponse(JSON.stringify({
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
  const events = await readNdjson(response);

  assert.match(captured.messages[0].content, /漫画模式/);
  assert.equal(captured.messages[1].content[0].image_url.url, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(finalEventOf(events).segments[0].type, 'dialogue');
});

test('plain text model response keeps raw-text fallback via stream final', async () => {
  globalThis.fetch = async () => mimoSseResponse('这不是 JSON');

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'auto' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  const final = finalEventOf(events);
  assert.equal(final.translation, '这不是 JSON');
  assert.equal(final.source_language, 'en');
});

test('unescaped quotes in model JSON get repaired', async () => {
  const brokenJson = [
    '{',
    '  "source_language": "zh",',
    '  "target_language": "en",',
    '  "detected_style": "natural",',
    '  "translation": "We sat on the riverbank.",',
    '  "segments": [],',
    '  "notes": [',
    '    {',
    '      "source": "银行",',
    '      "translation": "riverbank",',
    '      "reason": "此处"银行"指河岸，而非金融机构"',
    '    }',
    '  ]',
    '}',
  ].join('\n');
  globalThis.fetch = async () => mimoSseResponse('```json\n' + brokenJson + '\n```');

  const response = await onRequest({
    request: makeRequest({ text: '我们坐在河边的银行上看夕阳。', mode: 'auto' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  const final = finalEventOf(events);
  assert.equal(final.translation, 'We sat on the riverbank.');
  assert.equal(final.notes.length, 1);
  assert.match(final.notes[0].reason, /指河岸/);
});

test('model reporting unknown language gets normalized', async () => {
  globalThis.fetch = async () => mimoSseResponse(JSON.stringify({
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
  const events = await readNdjson(response);

  assert.equal(finalEventOf(events).source_language, 'en');
  assert.equal(finalEventOf(events).target_language, 'zh');
});

test('non-Chinese non-English languages route to Chinese', async () => {
  globalThis.fetch = async () => mimoSseResponse(JSON.stringify({
    source_language: 'ja',
    target_language: 'unknown',
    translation: '这是测试。',
    segments: [],
    notes: [],
  }));

  const response = await onRequest({
    request: makeRequest({ text: 'これはテストです。', mode: 'auto' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  const final = finalEventOf(events);
  assert.equal(final.source_language, 'ja');
  assert.equal(final.target_language, 'zh');
  assert.equal(final.translation, '这是测试。');
});

test('Chinese input routes to English via heuristic fallback', async () => {
  globalThis.fetch = async () => mimoSseResponse(JSON.stringify({
    source_language: 'unknown',
    target_language: 'unknown',
    translation: 'This is a test.',
    segments: [],
    notes: [],
  }));

  const response = await onRequest({
    request: makeRequest({ text: '这是一个测试。', mode: 'auto' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  assert.equal(finalEventOf(events).source_language, 'zh');
  assert.equal(finalEventOf(events).target_language, 'en');
});

test('truncated structured output emits error event, never raw translation', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return mimoSseResponse('{"source_language":"en","target_language":"zh","translation":"很长的文学译文', { finishReason: 'length' });
    }
    return mimoSseResponse(JSON.stringify({
      source_language: 'en',
      target_language: 'zh',
      translation: '第二次完整输出',
      segments: [],
      notes: [],
    }));
  };

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'literary' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  assert.equal(calls, 2);
  assert.equal(finalEventOf(events).translation, '第二次完整输出');
  assert.ok(!events.some((e) => e.type === 'error'));
});

test('double truncation ends with error event and Chinese message', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return mimoSseResponse('{"source_language":"en","translation":"截断', { finishReason: 'length' });
  };

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'literary' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  assert.equal(calls, 2);
  const error = events.find((e) => e.type === 'error');
  assert.equal(error.code, 'OUTPUT_TRUNCATED');
  assert.match(error.message, /译文过长/);
  assert.ok(!events.some((e) => e.type === 'final'));
});

test('empty first attempt retries once and succeeds', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? mimoSseResponse('') : mimoSseResponse(JSON.stringify({
      source_language: 'en',
      target_language: 'zh',
      translation: '重试成功',
      segments: [],
      notes: [],
    }));
  };

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'auto' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  assert.equal(calls, 2);
  assert.equal(finalEventOf(events).translation, '重试成功');
});

test('empty twice ends with empty-response error', async () => {
  globalThis.fetch = async () => mimoSseResponse('');

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'auto' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  const error = events.find((e) => e.type === 'error');
  assert.equal(error.code, 'MODEL_EMPTY_RESPONSE');
  assert.ok(!events.some((e) => e.type === 'final'));
});

test('upstream HTTP error maps to upstream error event without provider detail', async () => {
  globalThis.fetch = async () => new Response('{"err":"quota exceeded internal"}', { status: 429 });

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'auto' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  const error = events.find((e) => e.type === 'error');
  assert.equal(error.code, 'MODEL_UPSTREAM_ERROR');
  assert.doesNotMatch(error.message, /quota/);
});

test('stream interruption maps to interrupted error event', async () => {
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{"}}]}\n\n'));
        controller.error(new Error('connection reset'));
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'auto' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  const error = events.find((e) => e.type === 'error');
  assert.equal(error.code, 'MODEL_STREAM_INTERRUPTED');
  assert.ok(!events.some((e) => e.type === 'final'));
});

test('retry emits reset after streamed deltas, then fresh deltas and final', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      // Content that streams some provisional translation, then truncates.
      return mimoSseResponse('{"source_language":"en","target_language":"zh","translation":"雨洗净了整', { finishReason: 'length' });
    }
    return mimoSseResponse(JSON.stringify({
      source_language: 'en',
      target_language: 'zh',
      translation: '完整重试译文',
      segments: [],
      notes: [],
    }));
  };

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'literary' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  assert.equal(calls, 2);
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['start', 'delta', 'reset', 'delta', 'final']);
  const reset = events[2];
  assert.equal(reset.reason, 'output_truncated');
  assert.equal(events[1].text, '雨洗净了整');
  assert.equal(events[3].text.startsWith('完整重试译文'), true);
  assert.equal(finalEventOf(events).translation, '完整重试译文');
});

test('comic mode streams no translation deltas (final only)', async () => {
  globalThis.fetch = async () => mimoSseResponse(JSON.stringify({
    source_language: 'ja',
    target_language: 'zh',
    detected_style: 'comic',
    translation: '模型自由排版',
    segments: [
      { id: 'b1', order: 1, speaker: '女生', type: 'dialogue', source: '遅いよ', translation: '你太慢了' },
      { id: 'b2', order: 2, speaker: '男生', type: 'dialogue', source: 'ごめん', translation: '抱歉', reply_to: 'b1' },
    ],
    notes: [],
  }));

  const response = await onRequest({
    request: makeRequest({ imageDataUrl: 'data:image/png;base64,AAAA', mode: 'comic' }),
    env: ENV,
  });
  const events = await readNdjson(response);

  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['start', 'final']);
  const final = finalEventOf(events);
  assert.equal(final.translation, '【女生】\n你太慢了\n\n【男生】\n抱歉');
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
