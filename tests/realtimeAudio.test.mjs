import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(async () => vite.close());
const { resampleToMono16k, encodePcm16Wav, rmsForSamples, RealtimeAudioChunker } = await vite.ssrLoadModule('/src/services/realtime/audio.ts');
const { mergeTranscriptOverlap, detectRealtimeSourceLanguage, resolveRealtimeTarget } = await vite.ssrLoadModule('/src/services/realtime/transcript.ts');

test('audio is resampled to 16 kHz and encoded as mono PCM16 WAV', async () => {
  const input = Float32Array.from([0, 0.5, -0.5, 1]);
  const resampled = resampleToMono16k(input, 8_000);
  assert.equal(resampled.length, 8);
  assert.ok(Math.abs(resampled[2] - 0.5) < 0.001);
  const wav = new Uint8Array(await encodePcm16Wav(input).arrayBuffer());
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), 'WAVE');
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), input.length * 2);
  assert.equal(rmsForSamples(new Float32Array([0, 0])), 0);
});

test('energy VAD ignores silence and commits after a speech pause', () => {
  const chunker = new RealtimeAudioChunker();
  const voice = new Float32Array(1_600).fill(0.2);
  const silence = new Float32Array(9_600);
  assert.deepEqual(chunker.push(silence, 0), []);
  for (let i = 0; i < 4; i += 1) assert.deepEqual(chunker.push(voice, 1_000 + i * 100), []);
  const committed = chunker.push(silence, 1_400);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].reason, 'silence');
  assert.ok(committed[0].durationMs >= 350);
});

test('long continuous speech is windowed with deterministic overlap and ordered timestamps', () => {
  const chunker = new RealtimeAudioChunker();
  const chunks = [];
  for (let i = 0; i < 45; i += 1) chunks.push(...chunker.push(new Float32Array(1_600).fill(0.16), i * 100));
  chunks.push(...chunker.flush());
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].reason, 'window');
  assert.equal(Math.round(chunks[0].durationMs), 2_200);
  assert.ok(chunks[1].startTime < chunks[0].endTime, 'next window overlaps the previous one');
  assert.ok(chunks.every((chunk, index) => index === 0 || chunk.startTime > chunks[index - 1].startTime));
});

test('transcript merge removes CJK and English overlap despite punctuation drift', () => {
  assert.equal(mergeTranscriptOverlap('今天讨论人工智能的发展', '人工智能的发展，以及软件工程'), '今天讨论人工智能的发展，以及软件工程');
  assert.equal(mergeTranscriptOverlap('Today we discussed artificial intelligence', 'artificial intelligence, and software'), 'Today we discussed artificial intelligence, and software');
  assert.equal(mergeTranscriptOverlap('今天讨论人工智能的发展趋势', '人工智能的发张趋势，以及软件工程'), '今天讨论人工智能的发展趋势，以及软件工程');
  assert.equal(mergeTranscriptOverlap('We should monitor the optical link', 'the optical linc remains stable'), 'We should monitor the optical link remains stable');
  assert.equal(mergeTranscriptOverlap('你好。', '世界'), '你好。世界');
});

test('source and automatic target language are resolved only to zh/en', () => {
  assert.equal(detectRealtimeSourceLanguage('我们讨论 translation'), 'zh');
  assert.equal(detectRealtimeSourceLanguage('This is a spoken sentence'), 'en');
  assert.equal(resolveRealtimeTarget('zh', 'auto'), 'en');
  assert.equal(resolveRealtimeTarget('en', 'auto'), 'zh');
});
