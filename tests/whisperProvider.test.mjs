import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(() => vite.close());
const { WhisperASRProvider, decodeWhisperWav } = await vite.ssrLoadModule('/src/services/realtime/whisper.ts');
const { encodeWavDataUrl } = await vite.ssrLoadModule('/src/services/realtime/audio.ts');

class FakeWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  terminated = false;
  messages = [];
  respond = true;
  postMessage(message) {
    this.messages.push(message);
    if (!this.respond) return;
    queueMicrotask(() => this.onmessage?.({ data: message.type === 'prepare'
      ? { id: message.id, type: 'ready', device: 'wasm' }
      : { id: message.id, type: 'result', text: 'Hello world.', device: 'wasm' } }));
  }
  terminate() { this.terminated = true; }
}

test('local Whisper decodes 16 kHz PCM and returns the correct sequence without HTTP', async () => {
  const audioDataUrl = await encodeWavDataUrl(new Float32Array([0, 0.5, -0.5, 1]));
  const decoded = decodeWhisperWav(audioDataUrl);
  assert.equal(decoded.length, 4);
  assert.ok(Math.abs(decoded[1] - 0.5) < 0.001);
  assert.ok(Math.abs(decoded[2] + 0.5) < 0.001);
  assert.throws(() => decodeWhisperWav('data:audio/wav;base64,AAAA'), /音频/);
  const worker = new FakeWorker();
  const provider = new WhisperASRProvider(() => worker);
  await provider.prepare(() => {});
  const result = await provider.transcribe({ audioDataUrl, language: 'en', sequence: 14 }, {});
  assert.equal(result.text, 'Hello world.');
  assert.equal(result.sequence, 14);
  assert.equal(worker.messages.at(-1).language, 'en');
  assert.ok(worker.messages.at(-1).samples instanceof Float32Array);
  provider.dispose();
  assert.equal(worker.terminated, true);
});

test('cancelling model load terminates its Worker and a later session gets a fresh one', async () => {
  const workers = [];
  const provider = new WhisperASRProvider(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
  const controller = new AbortController();
  const loading = provider.prepare(() => {}, controller.signal);
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(workers[0].terminated, true);
  await provider.prepare(() => {});
  assert.equal(workers.length, 2);
  provider.dispose();
});
