import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as transcribe } from '../cloud-functions/api/realtime/transcribe.js';
import { onRequest as translateRealtime } from '../cloud-functions/api/realtime/translate.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function makeWavDataUrl() {
  const pcm = Buffer.alloc(320, 0);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return `data:audio/wav;base64,${wav.toString('base64')}`;
}

function makeRequest(path, body, ip = '192.0.2.10') {
  return new Request(`https://silvite.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function customEvents(value) {
  return value.split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

test('ASR endpoint sends WAV to the ASR model and relays sequence-tagged provisional/final text', async () => {
  let upstreamRequest;
  globalThis.fetch = async (url, init) => {
    upstreamRequest = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return new Response([
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world."}}]}\n\n',
      'data: [DONE]\n\n',
    ].join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  };

  const response = await transcribe({
    request: makeRequest('/api/realtime/transcribe', {
      audioDataUrl: makeWavDataUrl(), language: 'en', sequence: 7,
    }),
    env: { MIMO_API_KEY: 'test-only-key' },
  });
  const events = customEvents(await response.text());

  assert.equal(response.status, 200);
  assert.equal(upstreamRequest.url, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(upstreamRequest.headers.Authorization, 'Bearer test-only-key');
  assert.equal(upstreamRequest.body.model, 'mimo-v2.5-asr');
  assert.deepEqual(upstreamRequest.body.asr_options, { language: 'en' });
  assert.equal(upstreamRequest.body.stream, true);
  assert.equal(upstreamRequest.body.messages[0].content[0].input_audio.format, 'wav');
  assert.deepEqual(events.map((event) => event.type), ['partial', 'partial', 'final']);
  assert.ok(events.every((event) => event.sequence === 7));
  assert.equal(events.at(-1).text, 'Hello world.');
});

test('ASR endpoint rejects malformed audio before contacting Xiaomi', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not call upstream'); };
  const response = await transcribe({
    request: makeRequest('/api/realtime/transcribe', {
      audioDataUrl: 'data:audio/webm;base64,AAAA', language: 'auto', sequence: 1,
    }, '192.0.2.11'),
    env: { MIMO_API_KEY: 'test-only-key' },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_WAV');
  assert.equal(calls, 0);
});

test('ASR endpoint does not finalize a partial transcript on unexpected clean EOF', async () => {
  globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"partial transcript"}}]}\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  });
  const response = await transcribe({
    request: makeRequest('/api/realtime/transcribe', {
      audioDataUrl: makeWavDataUrl(), language: 'en', sequence: 8,
    }, '192.0.2.18'),
    env: { MIMO_API_KEY: 'test-only-key' },
  });
  const events = customEvents(await response.text());
  assert.deepEqual(events.map((event) => event.type), ['partial', 'error']);
  assert.equal(events.at(-1).code, 'ASR_STREAM_INTERRUPTED');
});

test('realtime translation uses MiMo V2.6 Flash with thinking disabled and bounded context', async () => {
  let upstreamRequest;
  globalThis.fetch = async (url, init) => {
    upstreamRequest = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return Response.json({ choices: [{ message: { content: '光链路保持稳定。' } }] });
  };
  const response = await translateRealtime({
    request: makeRequest('/api/realtime/translate', {
      sourceText: 'The optical link remains stable.',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      stage: 'provisional',
      sequence: 3,
      revision: 4,
      context: 'Fiber optics lab status.',
      terminology: 'optical link = 光链路',
      preserveNames: true,
      confirmedContext: Array.from({ length: 12 }, (_, index) => ({
        source: `source ${index}`, translation: `translation ${index}`,
      })),
    }, '192.0.2.12'),
    env: { MIMO_API_KEY: 'test-only-key' },
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(upstreamRequest.url, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(upstreamRequest.headers.Authorization, 'Bearer test-only-key');
  assert.equal(upstreamRequest.body.model, 'mimo-v2.6-flash');
  assert.deepEqual(upstreamRequest.body.thinking, { type: 'disabled' });
  assert.equal(upstreamRequest.body.stream, false);
  assert.ok(upstreamRequest.body.max_completion_tokens <= 1024);
  const userMessage = upstreamRequest.body.messages[1].content;
  assert.match(userMessage, /光链路/);
  assert.match(userMessage, /source 11/);
  assert.doesNotMatch(userMessage, /source 0"/);
  assert.equal(result.translation, '光链路保持稳定。');
  assert.equal(result.sequence, 3);
  assert.equal(result.revision, 4);
});

test('realtime API surfaces 429 without leaking provider response content', async () => {
  globalThis.fetch = async () => new Response('private upstream payload', { status: 429 });
  const response = await translateRealtime({
    request: makeRequest('/api/realtime/translate', {
      sourceText: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh',
      stage: 'confirmed', sequence: 1, revision: 1,
    }, '192.0.2.13'),
    env: { MIMO_API_KEY: 'test-only-key' },
  });
  assert.equal(response.status, 429);
  const result = await response.json();
  assert.equal(result.error, 'RATE_LIMITED');
  assert.doesNotMatch(JSON.stringify(result), /private upstream payload/);
});

test('realtime translation refuses internal JSON, including explanation-prefixed and partial payloads', async () => {
  for (const content of [
    '```json\n{"translation":"private"}',
    'Here is the result: {"translation":"private"}',
    '{"translation":"partial',
  ]) {
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content } }] });
    const response = await translateRealtime({
      request: makeRequest('/api/realtime/translate', {
        sourceText: 'Hello.', sourceLanguage: 'en', targetLanguage: 'zh',
        stage: 'provisional', sequence: 6, revision: 2,
      }, `192.0.2.${20 + content.length % 200}`),
      env: { MIMO_API_KEY: 'test-only-key' },
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'INVALID_TRANSLATION');
  }
});
