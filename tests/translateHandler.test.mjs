import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/translate.js';
import { mimoSseResponse, readSseEvents, finalEventOf, makeRequest } from './helpers.mjs';

const ENV = { MIMO_API_KEY: 'test-key', RATE_LIMIT: '10' };

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error('fetch should be stubbed per-test');
  };
});

test('academic mode reaches MiMo with academic prompt, context and terminology', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url).startsWith('https://api.xiaomimimo.com/v1/chat/completions'), true);
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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

  assert.equal(calls, 2);
  assert.equal(finalEventOf(events).translation, '重试成功');
});

test('empty twice ends with empty-response error', async () => {
  globalThis.fetch = async () => mimoSseResponse('');

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'auto' }),
    env: ENV,
  });
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

  const error = events.find((e) => e.type === 'error');
  assert.equal(error.code, 'MODEL_UPSTREAM_ERROR');
  assert.doesNotMatch(error.message, /quota/);
});

test('stream interruption resets provisional text and retries with the same budget', async () => {
  let calls = 0;
  const budgets = [];
  globalThis.fetch = async (url, init) => {
    calls++;
    budgets.push(JSON.parse(init.body).max_completion_tokens);
    if (calls === 2) {
      return mimoSseResponse(JSON.stringify({
        source_language: 'en',
        target_language: 'zh',
        translation: '完整重试译文',
        segments: [],
        notes: [],
      }));
    }

    const encoder = new TextEncoder();
    let sentChunk = false;
    return new Response(new ReadableStream({
      pull(controller) {
        if (sentChunk) {
          controller.error(new Error('connection reset'));
          return;
        }
        sentChunk = true;
        const event = { choices: [{ delta: { content: '{"translation":"半篇译文' } }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'auto' }),
    env: ENV,
  });
  const events = await readSseEvents(response);

  assert.equal(calls, 2);
  assert.deepEqual(budgets, [4096, 4096]);
  assert.deepEqual(events.map((event) => event.type), ['start', 'delta', 'reset', 'delta', 'final']);
  assert.equal(events[2].reason, 'stream_interrupted');
  assert.equal(finalEventOf(events).translation, '完整重试译文');
});

test('two stream interruptions map to interrupted error event', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
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
  const events = await readSseEvents(response);

  assert.equal(calls, 2);
  const error = events.find((e) => e.type === 'error');
  assert.equal(error.code, 'MODEL_STREAM_INTERRUPTED');
  assert.ok(!events.some((e) => e.type === 'final'));
});

test('stream EOF without finish reason retries with the same budget', async () => {
  let calls = 0;
  const budgets = [];
  globalThis.fetch = async (url, init) => {
    calls++;
    budgets.push(JSON.parse(init.body).max_completion_tokens);
    if (calls === 2) {
      return mimoSseResponse(JSON.stringify({
        source_language: 'en',
        target_language: 'zh',
        translation: '完整重试译文',
        segments: [],
        notes: [],
      }));
    }

    const partial = { choices: [{ delta: { content: '{"translation":"半篇译文' }, finish_reason: null }] };
    const body = `data: ${JSON.stringify(partial)}\n\ndata: [DONE]\n\n`;
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'auto' }),
    env: ENV,
  });
  const events = await readSseEvents(response);

  assert.equal(calls, 2);
  assert.deepEqual(budgets, [4096, 4096]);
  assert.deepEqual(events.map((event) => event.type), ['start', 'delta', 'reset', 'delta', 'final']);
  assert.equal(events[2].reason, 'stream_interrupted');
  assert.equal(finalEventOf(events).translation, '完整重试译文');
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
  const events = await readSseEvents(response);

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
  const events = await readSseEvents(response);

  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['start', 'final']);
  const final = finalEventOf(events);
  assert.equal(final.translation, '【女生】\n你太慢了\n\n【男生】\n抱歉');
});

test('SSE frame split mid-event still parses (transport framing)', async () => {
  globalThis.fetch = async () => {
    const inner = JSON.stringify({
      source_language: 'en',
      target_language: 'zh',
      translation: '分段帧',
      segments: [],
      notes: [],
    });
    const sseText =
      `data: ${JSON.stringify({ choices: [{ delta: { content: inner }, finish_reason: null }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n` +
      'data: [DONE]\n\n';
    // Byte-split the stream at arbitrary points: lines and events straddle
    // network chunk boundaries.
    const bytes = new TextEncoder().encode(sseText);
    const cut1 = Math.floor(bytes.length / 3);
    const cut2 = Math.floor((bytes.length * 2) / 3);
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut1));
        controller.enqueue(bytes.slice(cut1, cut2));
        controller.enqueue(bytes.slice(cut2));
        controller.close();
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  const response = await onRequest({
    request: makeRequest({ text: 'Hello', mode: 'auto' }),
    env: ENV,
  });
  const events = await readSseEvents(response);

  assert.deepEqual(events.map((e) => e.type), ['start', 'delta', 'final']);
  assert.equal(finalEventOf(events).translation, '分段帧');
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
