import type { ASRAudioStream, ASRPreparation, ASRProvider, StreamingASRHandlers } from '../providers';
import type { SherpaCommand, SherpaReply } from './protocol';

interface Job {
  resolve: (value: SherpaReply) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  progress?: (value: ASRPreparation) => void;
}

/** Browser adapter. Native mobile STT can later replace this provider while
 * keeping the same PCM input and partial/final text-event interfaces. */
export class SherpaStreamingASRProvider implements ASRProvider {
  readonly execution = 'local';
  private worker: Worker | null = null;
  private ready = false;
  private nextId = 0;
  private nextStreamId = 0;
  private active: { id: string; handlers: StreamingASRHandlers } | null = null;
  private stopActive: ((error: Error) => void) | null = null;
  private pending = new Map<number, Job>();
  private readonly createWorker: () => Worker;

  constructor(createWorker = () => new Worker(new URL('./sherpa.worker.ts', import.meta.url), { type: 'module' })) {
    this.createWorker = createWorker;
  }

  async prepare(onProgress: (value: ASRPreparation) => void, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!this.ready) {
      const base = new URL(import.meta.env.BASE_URL + 'asr/', location.origin).href;
      await this.run({ type: 'prepare', assetBase: base }, signal, onProgress);
      this.ready = true;
    }
    onProgress({ message: '中英流式识别已就绪 · 本机 CPU', progress: 100 });
  }

  async openStream(handlers: StreamingASRHandlers, signal: AbortSignal): Promise<ASRAudioStream> {
    signal.throwIfAborted();
    if (!this.ready) await this.prepare(() => {}, signal);
    if (this.active) throw new Error('请先结束上一次语音识别。');
    const streamId = 'sherpa-' + ++this.nextStreamId;
    this.active = { id: streamId, handlers };
    try { await this.run({ type: 'start', streamId }, signal); }
    catch (error) { this.reset(error instanceof Error ? error : new Error('流式识别无法开始。')); throw error; }
    let closed = false;
    let finishing = false;
    let inFlight = false;
    let buffered: Array<{ samples: Float32Array; startTime: number }> = [];
    let bufferedSamples = 0;
    let error: Error | null = null;
    let finishPromise: Promise<void> | null = null;
    const waiters: Array<() => void> = [];
    const pendingMs = () => handlers.onPending(bufferedSamples / 16 + (inFlight ? 100 : 0));
    const isActive = () => !closed && this.active?.id === streamId && !signal.aborted;
    const settle = () => { for (const resolve of waiters.splice(0)) resolve(); };
    const fail = (cause: unknown) => {
      if (closed) return;
      error = cause instanceof Error ? cause : new Error('本机流式识别失败，请重新开始。');
      if (!closed && !signal.aborted) handlers.onError(error);
      buffered = []; bufferedSamples = 0;
      closed = true;
      signal.removeEventListener('abort', abort);
      this.reset(error);
      settle();
    };
    this.stopActive = fail;
    const pump = async () => {
      if (!isActive() || inFlight || !bufferedSamples) return;
      // Batch a short amount of newly arrived PCM; never re-decode overlapping
      // windows. The recognizer retains its own streaming state.
      const blocks = buffered;
      const length = bufferedSamples;
      buffered = []; bufferedSamples = 0; inFlight = true;
      const samples = new Float32Array(length);
      let offset = 0;
      for (const block of blocks) { samples.set(block.samples, offset); offset += block.samples.length; }
      pendingMs();
      try {
        await this.run({ type: 'audio', streamId, samples, startTime: blocks[0].startTime }, signal);
      } catch (cause) { if (!closed) fail(cause); }
      finally {
        inFlight = false;
        if (isActive()) {
          pendingMs();
          if (bufferedSamples) void pump();
          else settle();
        } else settle();
      }
    };
    const abort = () => {
      if (closed) return;
      closed = true;
      buffered = []; bufferedSamples = 0;
      signal.removeEventListener('abort', abort);
      if (this.active?.id === streamId) this.reset(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
      settle();
    };
    signal.addEventListener('abort', abort, { once: true });
    return {
      push: (samples, startTime) => {
        if (!isActive() || finishing || !samples.length) return;
        // Backpressure normally pauses capture at 1.5 s. The hard limit also
        // protects a slow/frozen worker and fails visibly instead of dropping.
        if (bufferedSamples + samples.length > 16000 * 12) { fail(new Error('本机识别处理跟不上收音，已停止接收，请暂停后重新开始。')); return; }
        buffered.push({ samples: samples.slice(), startTime });
        bufferedSamples += samples.length;
        pendingMs();
        void pump();
      },
      finish: () => {
        finishPromise ??= (async () => {
          if (error) throw error;
          if (!isActive()) return;
          finishing = true;
          if (inFlight || bufferedSamples) await new Promise<void>(resolve => waiters.push(resolve));
          if (error) throw error;
          if (!isActive()) return;
          await this.run({ type: 'finish', streamId }, signal);
          closed = true;
          signal.removeEventListener('abort', abort);
          if (this.active?.id === streamId) this.active = null;
          this.stopActive = null;
          handlers.onPending(0);
        })();
        return finishPromise;
      },
      dispose: abort,
    };
  }

  dispose(): void { this.reset(new DOMException('Streaming STT disposed', 'AbortError')); }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<SherpaReply>) => {
      if (this.worker !== worker) return;
      if (data.type === 'transcript') {
        if (this.active?.id === data.streamId) this.active.handlers.onTranscript(data.event);
        return;
      }
      const job = this.pending.get(data.id);
      if (!job) return;
      if (data.type === 'progress') { job.progress?.(data.progress); return; }
      this.pending.delete(data.id);
      job.cleanup();
      if (data.type === 'error') job.reject(new Error(data.message));
      else job.resolve(data);
    };
    const crashed = () => {
      const error = new Error('本机流式识别引擎已中断，请重新开始。');
      if (this.stopActive) this.stopActive(error);
      else this.reset(error);
    };
    worker.onerror = crashed;
    worker.onmessageerror = crashed;
    return worker;
  }

  private run(command: SherpaCommand, signal?: AbortSignal, progress?: Job['progress']): Promise<SherpaReply> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const worker = this.ensureWorker();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const abort = () => this.reset(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
      const timer = setTimeout(() => this.reset(new Error('本机语音识别响应超时，请重新开始。')), command.type === 'prepare' ? 240_000 : 30_000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.pending.set(id, { resolve, reject, cleanup, progress });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        worker.postMessage({ ...command, id }, command.type === 'audio' ? [command.samples.buffer as ArrayBuffer] : []);
      } catch (cause) { this.reset(cause instanceof Error ? cause : new Error('本机识别无法启动。')); }
    });
  }

  private reset(error: Error) {
    this.worker?.terminate();
    this.worker = null; this.ready = false; this.active = null;
    this.stopActive = null;
    for (const job of this.pending.values()) { job.cleanup(); job.reject(error); }
    this.pending.clear();
  }
}
