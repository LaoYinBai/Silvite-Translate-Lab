import type { RealtimeAudioRequest, RealtimeTranslationRequest } from '../../api/realtimeClient';
import { REALTIME_CONFIG, type RealtimeSourceLanguage, type RealtimeTargetLanguage } from './config';
import { encodeWavDataUrl, RealtimeAudioChunker, resampleToMono16k, type AudioCapture, type RealtimeAudioChunk } from './audio';
import type { ASRProvider, TranslationProvider } from './providers';
import { detectRealtimeSourceLanguage, mergeTranscriptOverlap, resolveRealtimeTarget } from './transcript';
import type { RetryNotice } from './retry';

export type RealtimeStatus = 'idle' | 'requesting-microphone' | 'listening' | 'recognizing' | 'translating'
  | 'backpressure' | 'network-reconnecting' | 'network-disconnected' | 'rate-limited' | 'paused'
  | 'stopping' | 'error';

export interface RealtimeSubtitleSegment {
  id: string;
  sequence: number;
  startTime: number;
  endTime: number;
  sourceText: string;
  translatedText: string;
  sourceLanguage: 'zh' | 'en';
  targetLanguage: 'zh' | 'en';
  status: 'provisional' | 'confirmed';
  revision: number;
}

export interface RealtimeMetrics {
  captureTimestamp: number | null;
  chunkDurationMs: number;
  asrLatencyMs: number | null;
  asrFirstResponseLatencyMs: number | null;
  translationLatencyMs: number | null;
  endToEndSubtitleLatencyMs: number | null;
  revisions: number;
  discardedStaleResponses: number;
  retryCount: number;
  rateLimitCount: number;
}

export interface RealtimeSessionState {
  status: RealtimeStatus;
  error: string | null;
  current: RealtimeSubtitleSegment | null;
  segments: RealtimeSubtitleSegment[];
  metrics: RealtimeMetrics;
  isListening: boolean;
}

export interface RealtimeSessionOptions {
  capture: AudioCapture;
  asr: ASRProvider;
  translation: TranslationProvider;
  sourceLanguage: RealtimeSourceLanguage;
  targetLanguage: RealtimeTargetLanguage;
  context?: string;
  terminology?: string;
  preserveNames?: boolean;
  onChange?: (state: RealtimeSessionState) => void;
  now?: () => number;
}

interface QueuedChunk extends RealtimeAudioChunk { sequence: number; capturedAt: number }

const emptyMetrics = (): RealtimeMetrics => ({
  captureTimestamp: null, chunkDurationMs: 0, asrLatencyMs: null,
  asrFirstResponseLatencyMs: null, translationLatencyMs: null,
  endToEndSubtitleLatencyMs: null, revisions: 0,
  discardedStaleResponses: 0, retryCount: 0, rateLimitCount: 0,
});

export class RealtimeSessionEngine {
  private readonly options: RealtimeSessionOptions;
  private state: RealtimeSessionState = { status: 'idle', error: null, current: null, segments: [], metrics: emptyMetrics(), isListening: false };
  private readonly chunker = new RealtimeAudioChunker();
  private queue: QueuedChunk[] = [];
  private sequence = 0;
  private currentTranscript = '';
  private currentBaseTranscript = '';
  private currentSegmentSequence = 0;
  private currentRevision = 0;
  private activeTranslation: AbortController | null = null;
  private activeASR: AbortController | null = null;
  private lastProvisionalTranslationAt = 0;
  private pumping = false;
  private pausedByUser = false;
  private disposed = false;
  private drainWaiters: Array<() => void> = [];
  private readonly now: () => number;
  private networkHandlers: { online: () => void; offline: () => void } | null = null;

  constructor(options: RealtimeSessionOptions) { this.options = options; this.now = options.now || (() => performance.now()); }
  getSnapshot = () => this.state;

  updateSettings(settings: Pick<RealtimeSessionOptions, 'sourceLanguage' | 'targetLanguage' | 'context' | 'terminology' | 'preserveNames'>) {
    if (this.state.isListening || this.disposed) return;
    Object.assign(this.options, settings);
  }

  async start() {
    if (this.state.isListening || this.disposed) return;
    this.queue = [];
    this.sequence = 0;
    this.currentTranscript = '';
    this.currentBaseTranscript = '';
    this.lastProvisionalTranslationAt = 0;
    this.currentSegmentSequence = 0;
    this.currentRevision = 0;
    this.pausedByUser = false;
    this.patch({ status: 'requesting-microphone', error: null, current: null, segments: [], metrics: emptyMetrics(), isListening: false });
    try {
      await this.options.capture.start((samples, sampleRate, startTime) => {
        if (this.disposed || this.pausedByUser) return;
        const normalized = resampleToMono16k(samples, sampleRate);
        const chunks = this.chunker.push(normalized, startTime);
        for (const chunk of chunks) this.enqueue(chunk);
      });
      if (this.disposed) {
        await this.options.capture.stop(false);
        return;
      }
      this.networkHandlers = {
        online: () => {
          if (this.state.status !== 'network-disconnected') return;
          this.patch({ status: 'listening', error: null });
          void this.retryPending();
        },
        offline: () => this.patch({ status: 'network-disconnected', error: '网络已断开，当前语音片段已保留。恢复连接后可重试。' }),
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('online', this.networkHandlers.online);
        window.addEventListener('offline', this.networkHandlers.offline);
      }
      this.patch({ status: 'listening', isListening: true });
    } catch (error) {
      this.patch({ status: 'error', isListening: false, error: this.permissionMessage(error) });
      await this.options.capture.stop(false).catch(() => undefined);
    }
  }

  async pause() {
    if (!this.state.isListening) return;
    this.pausedByUser = true;
    this.options.capture.setPaused(true);
    const tail = this.chunker.flush();
    for (const chunk of tail) this.enqueue(chunk);
    this.patch({ status: 'paused' });
    await this.waitForDrain();
    await this.confirmCurrent();
  }

  async resume() {
    if (!this.state.isListening || !this.pausedByUser) return;
    this.pausedByUser = false;
    this.options.capture.setPaused(false);
    this.patch({ status: 'listening', error: null });
  }

  async retryPending() {
    if (this.disposed) return;
    this.patch({ status: 'listening', error: null });
    if (this.state.current?.status === 'confirmed') {
      await this.confirmCurrent();
      return;
    }
    this.pump();
  }

  async stop() {
    if (!this.state.isListening && this.state.status === 'idle') return;
    this.patch({ status: 'stopping' });
    await this.options.capture.stop(true).catch(() => undefined);
    for (const chunk of this.chunker.flush()) this.enqueue(chunk);
    await this.waitForDrain();
    await this.confirmCurrent();
    this.removeNetworkHandlers();
    this.patch({ status: 'idle', isListening: false });
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.activeTranslation?.abort(new DOMException('Session disposed', 'AbortError'));
    this.activeASR?.abort(new DOMException('Session disposed', 'AbortError'));
    this.queue = [];
    this.removeNetworkHandlers();
    await this.options.capture.stop(false).catch(() => undefined);
    this.notifyDrain();
  }

  private enqueue(chunk: RealtimeAudioChunk) {
    if (this.queue.length >= REALTIME_CONFIG.maxQueuedAudioChunks) {
      this.options.capture.setPaused(true);
      this.patch({ status: 'backpressure', error: '语音请求已排满，已暂停采集以避免丢失内容。' });
      return;
    }
    const sequence = ++this.sequence;
    this.queue.push({ ...chunk, sequence, capturedAt: this.now() });
    this.patch({ metrics: { ...this.state.metrics, chunkDurationMs: chunk.durationMs } });
    if (this.queue.length >= REALTIME_CONFIG.maxQueuedAudioChunks - 1) {
      this.options.capture.setPaused(true);
      this.patch({ status: 'backpressure', error: '正在处理已采集语音…' });
    }
    this.pump();
  }

  private async pump() {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.disposed) {
        const queued = this.queue.shift()!;
        if (this.queue.length <= REALTIME_CONFIG.resumeQueueDepth && !this.pausedByUser && this.state.isListening) {
          this.options.capture.setPaused(false);
        }
        await this.processChunk(queued);
        if (this.state.status === 'network-disconnected' || this.state.status === 'rate-limited') {
          this.queue.unshift(queued);
          break;
        }
      }
    } finally {
      this.pumping = false;
      this.notifyDrain();
      if (!this.queue.length && !this.pausedByUser && this.state.isListening && ['recognizing', 'translating', 'backpressure'].includes(this.state.status)) {
        this.patch({ status: 'listening', error: null });
      }
    }
  }

  private async processChunk(chunk: QueuedChunk) {
    this.patch({ status: 'recognizing', error: null });
    const audioDataUrl = await encodeWavDataUrl(chunk.samples);
    const request: RealtimeAudioRequest = { audioDataUrl, language: this.options.sourceLanguage, sequence: chunk.sequence };
    const controller = new AbortController();
    this.activeASR = controller;
    let chunkTranscript = '';
    try {
      const result = await this.options.asr.transcribe(request, {
        onPartial: (event, timing) => {
          if (!this.isLiveSequence(chunk.sequence)) { this.countStale(); return; }
          chunkTranscript = event.text;
          this.acceptTranscript(chunk, chunkTranscript, event.revision, timing.firstResponseMs);
        },
        onReset: () => {
          if (this.isLiveSequence(chunk.sequence)) this.patch({ current: this.state.current ? { ...this.state.current, translatedText: '' } : null });
        },
        onRetry: (notice) => this.onRetry(notice),
      }, controller.signal);
      if (!this.isLiveSequence(chunk.sequence)) { this.countStale(); return; }
      chunkTranscript = result.text;
      this.patch({ metrics: {
        ...this.state.metrics,
        asrLatencyMs: result.responseLatencyMs,
        asrFirstResponseLatencyMs: result.firstResponseMs,
      } });
      this.acceptTranscript(chunk, chunkTranscript, result.revision, result.firstResponseMs);
      if (chunk.reason === 'silence' || chunk.reason === 'stop') await this.confirmCurrent();
    } catch (error) {
      if (this.disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
      const rateLimited = typeof error === 'object' && error !== null && 'status' in error && error.status === 429;
      this.patch({
        status: rateLimited ? 'rate-limited' : 'network-disconnected',
        error: error instanceof Error ? error.message : '语音识别失败，当前片段已保留，可重试。',
      });
    } finally {
      if (this.activeASR === controller) this.activeASR = null;
    }
  }

  private acceptTranscript(chunk: QueuedChunk, text: string, revision: number, firstResponseMs: number) {
    if (!text.trim()) return;
    const sequenceChanged = this.currentSegmentSequence !== chunk.sequence;
    if (sequenceChanged) {
      this.currentSegmentSequence = chunk.sequence;
      this.currentRevision = 0;
      this.currentBaseTranscript = this.currentTranscript;
    }
    this.currentTranscript = mergeTranscriptOverlap(this.currentBaseTranscript, text);
    this.currentRevision = Math.max(this.currentRevision + 1, revision);
    const detected = detectRealtimeSourceLanguage(this.currentTranscript);
    const target = resolveRealtimeTarget(detected, this.options.targetLanguage);
    const segment: RealtimeSubtitleSegment = {
      id: `realtime-${chunk.sequence}`,
      sequence: chunk.sequence,
      startTime: this.state.current?.startTime ?? chunk.startTime,
      endTime: chunk.endTime,
      sourceText: this.currentTranscript,
      translatedText: '',
      sourceLanguage: detected,
      targetLanguage: target,
      status: 'provisional',
      revision: this.currentRevision,
    };
    this.patch({
      status: 'translating', current: segment,
      metrics: { ...this.state.metrics, captureTimestamp: chunk.capturedAt, revisions: this.state.metrics.revisions + 1 },
    });
    this.translateProvisional(segment, firstResponseMs);
  }

  private async translateProvisional(segment: RealtimeSubtitleSegment, firstResponseMs: number) {
    const now = this.now();
    if (segment.sourceText.trim().length < REALTIME_CONFIG.minimumTranslationCharacters
      || now - this.lastProvisionalTranslationAt < REALTIME_CONFIG.provisionalTranslationIntervalMs) return;
    this.lastProvisionalTranslationAt = now;
    this.activeTranslation?.abort(new DOMException('Superseded revision', 'AbortError'));
    const controller = new AbortController(); this.activeTranslation = controller;
    const request = this.translationRequest(segment, 'provisional');
    try {
      const result = await this.options.translation.translate(request, controller.signal, (notice) => this.onRetry(notice));
      if (!this.isCurrentRevision(segment, controller)) { this.countStale(); return; }
      this.patch({
        status: this.state.isListening ? 'listening' : this.state.status,
        current: { ...segment, translatedText: result.translation },
        metrics: { ...this.state.metrics, translationLatencyMs: result.latencyMs,
          endToEndSubtitleLatencyMs: this.state.metrics.captureTimestamp === null
            ? null : this.now() - this.state.metrics.captureTimestamp },
      });
    } catch (error) {
      if (!controller.signal.aborted) this.patch({ error: error instanceof Error ? error.message : '实时翻译暂时失败。' });
    } finally {
      if (this.activeTranslation === controller) this.activeTranslation = null;
    }
    void firstResponseMs;
  }

  private async confirmCurrent() {
    const segment = this.state.current;
    if (!segment?.sourceText.trim()) return;
    this.activeTranslation?.abort(new DOMException('Final correction', 'AbortError'));
    const controller = new AbortController(); this.activeTranslation = controller;
    const confirmedRevision = segment.revision + 1;
    const confirmed = { ...segment, status: 'confirmed' as const, revision: confirmedRevision };
    this.currentTranscript = '';
    this.currentBaseTranscript = '';
    this.currentSegmentSequence = 0;
    this.currentRevision = 0;
    this.patch({ status: 'translating', current: confirmed });
    try {
      const result = await this.options.translation.translate(this.translationRequest(confirmed, 'confirmed'), controller.signal,
        (notice) => this.onRetry(notice));
      if (this.disposed || controller.signal.aborted || this.state.current?.sequence !== segment.sequence
        || this.state.current.revision !== confirmedRevision) { this.countStale(); return; }
      const finalSegment = { ...confirmed, translatedText: result.translation };
      this.patch({
        segments: [...this.state.segments, finalSegment], current: null,
        status: this.state.isListening ? 'listening' : this.state.status,
        metrics: { ...this.state.metrics, translationLatencyMs: result.latencyMs,
          endToEndSubtitleLatencyMs: this.state.metrics.captureTimestamp === null
            ? null : this.now() - this.state.metrics.captureTimestamp },
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      // Keep the source and provisional translation visible; the segment is not silently lost.
      this.patch({ current: confirmed, status: 'network-disconnected', error: error instanceof Error ? error.message : '最终字幕校正失败，可重试。' });
    } finally {
      if (this.activeTranslation === controller) this.activeTranslation = null;
    }
  }

  private translationRequest(segment: RealtimeSubtitleSegment, stage: 'provisional' | 'confirmed'): RealtimeTranslationRequest {
    const confirmedContext = this.state.segments.slice(-REALTIME_CONFIG.recentContextSegments).map((item) => ({
      source: item.sourceText, translation: item.translatedText,
      source_language: item.sourceLanguage, target_language: item.targetLanguage,
    }));
    return {
      sourceText: segment.sourceText, sourceLanguage: segment.sourceLanguage, targetLanguage: segment.targetLanguage,
      stage, sequence: segment.sequence, revision: segment.revision,
      context: this.options.context, terminology: this.options.terminology,
      preserveNames: this.options.preserveNames, confirmedContext,
    };
  }

  private isLiveSequence(sequence: number) { return !this.disposed && sequence <= this.sequence && sequence >= this.currentSegmentSequence; }
  private isCurrentRevision(segment: RealtimeSubtitleSegment, controller: AbortController) {
    return !this.disposed && !controller.signal.aborted && this.state.current?.sequence === segment.sequence
      && this.state.current.revision === segment.revision;
  }
  private countStale() { this.patch({ metrics: { ...this.state.metrics, discardedStaleResponses: this.state.metrics.discardedStaleResponses + 1 } }); }
  private onRetry(notice: RetryNotice) {
    this.patch({ status: 'network-reconnecting', error: `网络不稳定，正在重试（${notice.attempt}/${notice.maxRetries}）…`, metrics: {
      ...this.state.metrics, retryCount: this.state.metrics.retryCount + 1,
      rateLimitCount: this.state.metrics.rateLimitCount + (notice.rateLimited ? 1 : 0),
    } });
  }
  private permissionMessage(error: unknown) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return '麦克风权限未开启，请在浏览器设置中允许使用麦克风。';
    if (error instanceof DOMException && error.name === 'NotFoundError') return '未检测到可用麦克风。';
    return error instanceof Error ? error.message : '无法启动麦克风，请检查设备后重试。';
  }
  private patch(partial: Partial<RealtimeSessionState>) {
    if (this.disposed && partial.status !== 'idle') return;
    this.state = { ...this.state, ...partial };
    this.options.onChange?.(this.state);
  }
  private waitForDrain() {
    if (!this.pumping && this.queue.length === 0 || ['network-disconnected', 'rate-limited'].includes(this.state.status)) return Promise.resolve();
    return new Promise<void>((resolve) => this.drainWaiters.push(resolve));
  }
  private notifyDrain() {
    if (this.pumping || (this.queue.length && !['network-disconnected', 'rate-limited'].includes(this.state.status))) return;
    for (const resolve of this.drainWaiters.splice(0)) resolve();
  }
  private removeNetworkHandlers() {
    if (!this.networkHandlers) return;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.networkHandlers.online);
      window.removeEventListener('offline', this.networkHandlers.offline);
    }
    this.networkHandlers = null;
  }
}
