import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(() => vite.close());
const { createWhisperModelCache } = await vite.ssrLoadModule('/src/services/realtime/whisperAssets.ts');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
const file = 'onnx/encoder_model.onnx';
const manifest = {
  revision: 'test-pinned-revision',
  files: [{ file, bytes: 5, sha256: digest(Buffer.concat(chunks)), parts: chunks.map((bytes, index) => ({
    file: file + '.part' + index, bytes: bytes.length, sha256: digest(bytes),
  })) }],
};

test('static model cache streams ordered same-origin parts without requesting a large ONNX', async () => {
  const requests = [];
  const cache = createWhisperModelCache('https://example.test/whisper/', manifest, async url => {
    requests.push(String(url));
    return new Response(chunks[Number(String(url).at(-1))]);
  }, null);
  const response = await cache.match('/whisper/models/whisper-tiny/' + file);
  assert.equal(response.headers.get('Content-Length'), '5');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3, 4, 5]));
  assert.deepEqual(requests, [0, 1].map(index => 'https://example.test/whisper/models/whisper-tiny/' + file + '.part' + index));
  assert.equal(await cache.match('https://huggingface.co/whisper-tiny/resolve/main/' + file), undefined);
});

test('corrupt or missing parts fail instead of producing a truncated model', async () => {
  for (const fetcher of [async () => new Response(new Uint8Array([8, 8, 8])), async () => new Response('', { status: 404 })]) {
    const cache = createWhisperModelCache('https://example.test/whisper/', manifest, fetcher, null);
    const response = await cache.match('/whisper/models/whisper-tiny/' + file);
    await assert.rejects(response.arrayBuffer(), /模型/);
  }
});

test('a completed model is reused from cache and cache quota failure still permits inference', async () => {
  const stored = new Map();
  let requests = 0;
  const storage = { open: async () => ({
    match: async key => stored.get(key)?.clone(),
    put: async (key, response) => { stored.set(key, new Response(await response.arrayBuffer(), { headers: response.headers })); },
  }) };
  const fetcher = async url => { requests += 1; return new Response(chunks[Number(String(url).at(-1))]); };
  const cache = createWhisperModelCache('https://example.test/whisper/', manifest, fetcher, storage);
  await (await cache.match('/whisper/models/whisper-tiny/' + file)).arrayBuffer();
  // Let the cache writer consume its stream clone.
  await new Promise(resolve => setImmediate(resolve));
  await (await cache.match('/whisper/models/whisper-tiny/' + file)).arrayBuffer();
  assert.equal(requests, 2);
  const unavailable = createWhisperModelCache('https://example.test/whisper/', manifest, fetcher,
    { open: async () => { throw new DOMException('Cache unavailable', 'QuotaExceededError'); } });
  assert.equal((await (await unavailable.match('/whisper/models/whisper-tiny/' + file)).arrayBuffer()).byteLength, 5);
});
