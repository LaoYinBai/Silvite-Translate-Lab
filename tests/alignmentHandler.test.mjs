import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../cloud-functions/api/alignment.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('AI alignment sends both complete passages to DeepSeek when the cloud request has no signal', async () => {
  const sourceText = '我们坚持以人民为中心的发展思想，统筹推进稳增长、促改革、调结构、惠民生各项工作，着力增强经济发展内生动力；围绕产业升级，支持传统产业改造提升，培育数字经济和绿色能源新增长点，推动科技创新与实体经济深度融合。';
  const sourceSplit = sourceText.indexOf('；') + 1;
  const targetFirst = 'We follow a people-centered development philosophy, coordinate efforts to stabilize growth, advance reform, adjust the economic structure, improve people’s livelihoods, and prevent risks, thereby strengthening the economy’s endogenous drivers; ';
  const targetSecond = 'On industrial upgrading, we support the transformation of traditional industries, cultivate new growth drivers such as the digital economy and green energy, and promote deeper integration of technological innovation with the real economy.';
  const targetText = targetFirst + targetSecond;
  let upstream;
  globalThis.fetch = async (url, init) => {
    upstream = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ pairs: [
      { source: sourceText.slice(0, sourceSplit), target: targetFirst },
      { source: sourceText.slice(sourceSplit), target: targetSecond },
    ] }) } }] }));
  };

  const body = JSON.stringify({ sourceText, targetText, sourceLanguage: 'zh', targetLanguage: 'en', model: 'deepseek' });
  const request = new Request('https://silvite.test/api/alignment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.230' },
    body,
  });
  // EdgeOne's deployed Request may omit signal, as seen in the production crash.
  Object.defineProperty(request, 'signal', { value: undefined });

  const response = await onRequest({
    request,
    env: { DEEPSEEK_API_KEY: 'alignment-test-key', DEEPSEEK_BASE_URL: 'https://gateway.example/v1' },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(upstream.url, 'https://gateway.example/v1/chat/completions');
  assert.equal(upstream.headers.Authorization, 'Bearer alignment-test-key');
  assert.equal(upstream.body.model, 'deepseek-flash');
  assert.deepEqual(upstream.body.thinking, { type: 'disabled' });
  assert.equal(upstream.body.stream, false);
  const systemPrompt = upstream.body.messages[0].content;
  assert.match(systemPrompt, /align the two complete passages/i);
  const userPrompt = upstream.body.messages[1].content;
  const data = JSON.parse(userPrompt.match(/<alignment_data>([\s\S]*?)<\/alignment_data>/)[1]);
  assert.deepEqual(data, {
    source_text: sourceText,
    target_text: targetText,
    source_language: 'zh',
    target_language: 'en',
  });
  assert.equal(payload.method, 'ai');
  assert.equal(payload.rows.length, 2);
  assert.equal(upstream.body.messages[0].content.includes(sourceText), false);
  assert.ok(upstream.body.messages[1].content.includes(sourceText));
  assert.ok(upstream.body.messages[1].content.includes(targetText));
});

test('alignment endpoint distinguishes malformed JSON from valid JSON with invalid fields', async () => {
  const request = (body, ip) => {
    const value = new Request('https://silvite.test/api/alignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body,
    });
    Object.defineProperty(value, 'signal', { value: undefined });
    return value;
  };
  globalThis.fetch = async () => { throw new Error('invalid input must not call DeepSeek'); };

  const malformed = await onRequest({ request: request('{broken', '192.0.2.231') });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'INVALID_JSON');

  const invalid = await onRequest({ request: request(JSON.stringify({ sourceText: 'Hello' }), '192.0.2.232') });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'INVALID_ALIGNMENT_INPUT');
});

test('alignment endpoint classifies unusable model responses without leaking model text', async () => {
  const sourceText = '中文甲；中文乙。';
  const targetText = 'English one; English two.';
  const cases = [
    { finish_reason: 'length', content: 'private truncated response', error: 'ALIGNMENT_INVALID_COMPLETION' },
    { finish_reason: 'stop', content: 'private non-json response', error: 'ALIGNMENT_INVALID_JSON' },
    { finish_reason: 'stop', content: JSON.stringify({ pairs: [{ source: 'rewritten', target: 'changed' }] }), error: 'ALIGNMENT_INVALID_PROPOSAL' },
  ];

  for (const [index, item] of cases.entries()) {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{
      finish_reason: item.finish_reason,
      message: { content: item.content },
    }] }));
    const request = new Request('https://silvite.test/api/alignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `192.0.2.${240 + index}` },
      body: JSON.stringify({ sourceText, targetText, sourceLanguage: 'zh', targetLanguage: 'en', model: 'deepseek' }),
    });
    const response = await onRequest({
      request,
      env: { DEEPSEEK_API_KEY: 'alignment-test-key' },
    });
    const body = await response.text();

    assert.equal(response.status, 502);
    assert.equal(JSON.parse(body).error, item.error);
    assert.doesNotMatch(body, /private|rewritten|changed/);
  }
});
