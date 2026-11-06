import type { RealtimeASRHandlers, RealtimeAudioRequest, RealtimeASRResult } from '../../api/realtimeClient';
import type { ASRPreparation, ASRProvider } from './providers';
import type { WhisperCommand, WhisperWorkerReply } from './whisperProtocol';

/** Decode the same mono PCM16 WAV produced by the microphone pipeline. */
export function decodeWhisperWav(dataUrl: string): Float32Array {
  const encoded = /^data:audio\/wav;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)?.[1];
  if (!encoded) throw new Error('本机识别收到的音频格式无效。');
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const text = (offset: number, length: number) => new TextDecoder().decode(bytes.subarray(offset, offset + length));
  if (bytes.length < 44 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw new Error('音频 WAV 文件无效。');
  let validFormat = false;
  let pcm: Uint8Array | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length) throw new Error('音频 WAV 数据不完整。');
    if (text(offset, 4) === 'fmt ' && length >= 16) {
      validFormat = view.getUint16(start, true) === 1 && view.getUint16(start + 2, true) === 1
        && view.getUint32(start + 4, true) === 16_000 && view.getUint16(start + 14, true) === 16;
    }
    if (text(offset, 4) === 'data') pcm = bytes.subarray(start, start + length);
    offset = start + length + length % 2;
  }
  if (!validFormat || !pcm?.length || pcm.length % 2) throw new Error('音频必须为 16 kHz 单声道 PCM16。');
  const samples = new Float32Array(pcm.length / 2);
  const pcmView = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let index = 0; index < samples.length; index += 1) samples[index] = pcmView.getInt16(index * 2, true) / 32768;
  return samples;
}

interface PendingJob {
  resolve: (reply: WhisperWorkerReply) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ASRPreparation) => void;
  cleanup: () => void;
}

/** All inference and model loading stays in a dedicated browser Worker. */
export class WhisperASRProvider implements ASRProvider {
  readonly execution = 'local';
  readonly chunkOptions = { chunkMs: 6_000, overlapMs: 800, silenceCommitMs: 650 };
  private readonly createWorker: () => Worker;
  private readonly preferredDevice: 'auto' | 'wasm';
  private worker: Worker | null = null;
  private device: 'webgpu' | 'wasm' | null = null;
  private reportProgress: ((progress: ASRPreparation) => void) | undefined;
  private nextId = 0;
  private pending = new Map<number, PendingJob>();

  constructor(createWorker = () => new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' }), device: 'auto' | 'wasm' = 'auto') {
    this.createWorker = createWorker;
    this.preferredDevice = device;
  }

  async prepare(onProgress: (progress: ASRPreparation) => void, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.reportProgress = onProgress;
    if (!this.device) {
      const reply = await this.run({ type: 'prepare', assetBase: `${import.meta.env.BASE_URL}whisper/`, device: this.preferredDevice }, signal, onProgress);
      signal?.throwIfAborted();
      if (reply.type !== 'ready') throw new Error('本机语音模型未能就绪。');
      this.device = reply.device;
    }
    onProgress({ message: this.device === 'webgpu' ? '本机 GPU 识别已就绪' : '本机 CPU 识别已就绪', progress: 100 });
  }

  async transcribe(request: RealtimeAudioRequest, _handlers: RealtimeASRHandlers, signal?: AbortSignal): Promise<RealtimeASRResult> {
    signal?.throwIfAborted();
    if (!this.device) await this.prepare(this.reportProgress || (() => {}), signal);
    const startedAt = performance.now();
    const samples = decodeWhisperWav(request.audioDataUrl);
    const reply = await this.run({ type: 'transcribe', samples, language: request.language }, signal, this.reportProgress);
    if (reply.type !== 'result') throw new Error('本机语音识别结果无效。');
    if (reply.device !== this.device) {
      this.device = reply.device;
      this.reportProgress?.({ message: this.device === 'webgpu' ? '本机 GPU 识别已就绪' : '本机 CPU 识别已就绪', progress: 100 });
    }
    const latency = performance.now() - startedAt;
    return { sequence: request.sequence, revision: 1, text: reply.text,
      responseLatencyMs: latency, firstResponseMs: latency, firstPartialMs: latency };
  }

  dispose() { this.reset(new DOMException('Whisper disposed', 'AbortError')); }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<WhisperWorkerReply>) => {
      if (this.worker !== worker) return;
      const job = this.pending.get(data.id);
      if (!job) return;
      if (data.type === 'progress') { job.onProgress?.(data.progress); return; }
      this.pending.delete(data.id);
      job.cleanup();
      if (data.type === 'error') job.reject(new Error(data.message));
      else job.resolve(data);
    };
    worker.onerror = () => this.reset(new Error('本机语音识别无法运行，请检查浏览器或重新加载模型。'));
    worker.onmessageerror = () => this.reset(new Error('本机语音识别通信失败，请重试。'));
    return worker;
  }

  private run(command: WhisperCommand, signal?: AbortSignal, onProgress?: PendingJob['onProgress']): Promise<WhisperWorkerReply> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const worker = this.ensureWorker();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const abort = () => this.reset(signal?.reason || new DOMException('Cancelled', 'AbortError'));
      const cleanup = () => signal?.removeEventListener('abort', abort);
      this.pending.set(id, { resolve, reject, onProgress, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        worker.postMessage({ ...command, id }, command.type === 'transcribe' ? [command.samples.buffer as ArrayBuffer] : []);
      } catch (error) {
        this.reset(error instanceof Error ? error : new Error('本机语音识别启动失败。'));
      }
    });
  }

  private reset(error: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.device = null;
    this.reportProgress = undefined;
    for (const job of this.pending.values()) { job.cleanup(); job.reject(error); }
    this.pending.clear();
  }
}
