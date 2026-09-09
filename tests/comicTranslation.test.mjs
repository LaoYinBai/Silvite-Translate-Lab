import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, buildComicTranslation, enforceReplyOrders } from '../functions/api/translate.js';

const MIMO_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const ENV = { MIMO_API_KEY: 'test-key', RATE_LIMIT: '100' };

function makeRequest(body) {
  return new Request('http://localhost:3001/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  globalThis.fetch = async () => {
    throw new Error('fetch should be stubbed per-test');
  };
});

// Test 2: single panel, two speakers - the question must precede the answer
// when order says so, regardless of the model's raw array order.
test('T2: order sorts question before answer even if array is reversed', () => {
  const segments = [
    { panel: 1, order: 2, speaker: '男生', type: 'dialogue', source: '因为……', translation: '因为……' },
    { panel: 1, order: 1, speaker: '女生', type: 'dialogue', source: '为什么？', translation: '为什么？' },
  ];
  const built = buildComicTranslation(segments);
  assert.equal(built, '【女生】\n为什么？\n\n【男生】\n因为……');
  assert.ok(built.indexOf('为什么？') < built.indexOf('因为……'));
});

// Test 3: same speaker, consecutive dialogue lines merge into one block.
test('T3: consecutive same-speaker dialogue merges into one block', () => {
  const segments = [
    { panel: 1, order: 1, speaker: '角色A', type: 'dialogue', source: '先走一句', translation: '第一句' },
    { panel: 1, order: 2, speaker: '角色A', type: 'dialogue', source: '再来一句', translation: '第二句' },
    { panel: 1, order: 3, speaker: '角色B', type: 'dialogue', source: '回应', translation: '回应' },
  ];
  assert.equal(
    buildComicTranslation(segments),
    '【角色A】\n第一句\n第二句\n\n【角色B】\n回应'
  );
});

// Test 4: A -> B -> A must NOT be globally grouped by speaker.
test('T4: A->B->A keeps three separate turn blocks', () => {
  const segments = [
    { panel: 1, order: 1, speaker: '女生', type: 'dialogue', translation: '一' },
    { panel: 1, order: 2, speaker: '男生', type: 'dialogue', translation: '二' },
    { panel: 2, order: 3, speaker: '女生', type: 'dialogue', translation: '三' },
  ];
  const built = buildComicTranslation(segments);
  assert.equal(built, '【女生】\n一\n\n【男生】\n二\n\n【女生】\n三');
});

// Test 5: unknown speaker renders as 【对白】, never an invented name.
test('T5: null speaker renders as 对白', () => {
  const segments = [
    { panel: 1, order: 1, speaker: null, type: 'dialogue', translation: '谁在说话' },
  ];
  assert.equal(buildComicTranslation(segments), '【对白】\n谁在说话');
});

// Extra: missing order keeps the model's original array order; environment
// text (background_text/sign) trails after the dialogue flow; caption stays
// inline at its narrative position.
test('T-extra: missing order preserves array order; env text trails; caption inline', () => {
  const segments = [
    { type: 'dialogue', speaker: '女生', translation: '开场' },
    { type: 'background_text', speaker: null, translation: '县立东云高中' },
    { type: 'caption', speaker: null, translation: '放学后' },
    { type: 'dialogue', speaker: '男生', translation: '回应' },
  ];
  assert.equal(
    buildComicTranslation(segments),
    '【女生】\n开场\n\n【场景】\n放学后\n\n【男生】\n回应\n\n【背景文字】\n县立东云高中'
  );
});

test('T-extra: non-dialogue segments never merge, even with same label', () => {
  const segments = [
    { panel: 1, order: 1, speaker: null, type: 'caption', translation: '场景一' },
    { panel: 2, order: 2, speaker: null, type: 'caption', translation: '场景二' },
  ];
  assert.equal(buildComicTranslation(segments), '【场景】\n场景一\n\n【场景】\n场景二');
});

// Test 6 (fallback): comic + image + NO usable segments -> model's free
// translation passes through untouched.
test('T6: comic without segments falls back to parsed translation', async () => {
  globalThis.fetch = async () =>
    fakeMimoResponse(JSON.stringify({
      source_language: 'ja',
      target_language: 'zh',
      detected_style: 'comic',
      translation: '模型自由排版的译文',
      segments: [],
      notes: [],
    }));

  const response = await onRequest({
    request: makeRequest({ imageDataUrl: 'data:image/png;base64,AAAA', mode: 'comic' }),
    env: ENV,
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.translation, '模型自由排版的译文');
});

// Builder applies ONLY for comic + image + usable segments; other modes keep
// the model's own translation verbatim.
test('comic + image + valid segments: translation is rebuilt deterministically', async () => {
  const modelTranslation = '女生：迟到了 男生：抱歉（平铺对白）';
  globalThis.fetch = async () =>
    fakeMimoResponse(JSON.stringify({
      source_language: 'ja',
      target_language: 'zh',
      detected_style: 'comic',
      translation: modelTranslation,
      segments: [
        { panel: 1, order: 1, speaker: '女生', type: 'dialogue', source: '遅いよ', translation: '你太慢了' },
        { panel: 2, order: 2, speaker: '男生', type: 'dialogue', source: 'ごめん', translation: '抱歉' },
      ],
      notes: [],
    }));

  const response = await onRequest({
    request: makeRequest({ imageDataUrl: 'data:image/png;base64,AAAA', mode: 'comic' }),
    env: ENV,
  });
  const payload = await response.json();

  assert.equal(payload.translation, '【女生】\n你太慢了\n\n【男生】\n抱歉');
  // Segments pass through with panel/order/speaker intact.
  assert.equal(payload.segments.length, 2);
  assert.equal(payload.segments[0].panel, 1);
  assert.equal(payload.segments[0].order, 1);
  assert.equal(payload.segments[0].speaker, '女生');
});

test('non-comic image mode keeps model free translation untouched', async () => {
  globalThis.fetch = async () =>
    fakeMimoResponse(JSON.stringify({
      source_language: 'ja',
      target_language: 'zh',
      detected_style: 'natural',
      translation: '自然模式自由译文',
      segments: [
        { type: 'text', source: 'x', translation: 'x' },
      ],
      notes: [],
    }));

  const response = await onRequest({
    request: makeRequest({ imageDataUrl: 'data:image/png;base64,AAAA', mode: 'natural' }),
    env: ENV,
  });
  const payload = await response.json();

  assert.equal(payload.translation, '自然模式自由译文');
});

test('comic image request carries the dedicated visual-narrative instruction', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return fakeMimoResponse(JSON.stringify({
      source_language: 'ja',
      target_language: 'zh',
      detected_style: 'comic',
      translation: 'x',
      segments: [],
      notes: [],
    }));
  };

  const response = await onRequest({
    request: makeRequest({ imageDataUrl: 'data:image/png;base64,AAAA', mode: 'comic' }),
    env: ENV,
  });

  assert.equal(response.status, 200);
  const userText = captured.messages[1].content.find((part) => part.type === 'text').text;
  assert.match(userText, /漫画视觉叙事理解/);
  assert.match(userText, /对话连贯性/);
  assert.match(userText, /panel、order、speaker、type、source、translation/);
  assert.doesNotMatch(userText, /翻译图片中的全部文字/);
});

test('buildComicTranslation returns empty string for unusable input', () => {
  assert.equal(buildComicTranslation([]), '');
  assert.equal(buildComicTranslation(undefined), '');
  assert.equal(buildComicTranslation([{ type: 'dialogue', translation: '   ' }]), '');
});

// reply_to: the model's explicitly declared dependency must win over its own
// order mistake - a violation swaps the two order values deterministically.
test('enforceReplyOrders swaps orders when response precedes its target', () => {
  const segments = [
    { id: 'bubble_1', order: 1, speaker: '角色A', type: 'dialogue', translation: '解释' },
    { id: 'bubble_2', order: 2, speaker: '角色B', type: 'dialogue', translation: '真的？' },
    { id: 'bubble_3', order: 3, speaker: '角色A', type: 'dialogue', translation: '回应', reply_to: 'bubble_2' },
  ];
  // Simulate the model's spatial mistake: response (bubble_3) ordered before
  // its target (bubble_2).
  segments[1].order = 3;
  segments[2].order = 2;

  enforceReplyOrders(segments);
  const built = buildComicTranslation(segments);
  assert.equal(built, '【角色A】\n解释\n\n【角色B】\n真的？\n\n【角色A】\n回应');
});

test('enforceReplyOrders enforces mutual declarations exactly once', () => {
  // Model declared BOTH directions (a pathological but observed output).
  // First declaration in array order wins; the duplicate must not undo it.
  const segments = [
    { id: 'b1', order: 1, type: 'dialogue', translation: '解释' },
    { id: 'b2', order: 2, type: 'dialogue', translation: '质疑' },
    { id: 'b3', order: 3, type: 'dialogue', translation: '回应', reply_to: 'b2' },
  ];
  // Simulate the spatial mistake: response ordered before its target, plus a
  // mutual back-declaration from the target to the response.
  segments[1].order = 4;
  segments[2].order = 3;
  segments[1].reply_to = 'b3';

  enforceReplyOrders(segments);
  assert.equal(segments[1].order, 3);
  assert.equal(segments[2].order, 4);
  const built = buildComicTranslation(segments);
  assert.ok(built.indexOf('质疑') < built.indexOf('回应'));
});

test('enforceReplyOrders leaves already-valid orders untouched', () => {
  const segments = [
    { id: 'b1', order: 1, type: 'dialogue', translation: '问' },
    { id: 'b2', order: 2, type: 'dialogue', translation: '答', reply_to: 'b1' },
  ];
  enforceReplyOrders(segments);
  assert.equal(segments[0].order, 1);
  assert.equal(segments[1].order, 2);
});

test('enforceReplyOrders ignores dangling or unresolvable reply_to', () => {
  const segments = [
    { id: 'b1', order: 1, type: 'dialogue', translation: '一' },
    { reply_to: 'missing', order: 2, type: 'dialogue', translation: '二' },
  ];
  enforceReplyOrders(segments);
  assert.equal(segments[0].order, 1);
  assert.equal(segments[1].order, 2);
});
