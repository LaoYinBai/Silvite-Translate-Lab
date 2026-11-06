import type { RealtimeAudioRequest, RealtimeTranslationRequest, RealtimeTranslationResult } from '../../api/realtimeClient';
import { REALTIME_CONFIG, type RealtimeSourceLanguage, type RealtimeTargetLanguage } from './config';
import { encodeWavDataUrl, RealtimeAudioChunker, resampleToMono16k, type AudioCapture, type RealtimeAudioChunk } from './audio';
import type { ASRAudioStream, ASRPreparation, ASRProvider, StreamingTranscript, TranslationProvider } from './providers';
import { detectRealtimeSourceLanguage, mergeTranscriptOverlap, resolveRealtimeTarget } from './transcript';
import type { RetryNotice } from './retry';
import { RealtimeTranslationScheduler } from './translationScheduler';

export type RealtimeStatus = 'idle' | 'preparing-model' | 'requesting-microphone' | 'listening' | 'recognizing' | 'translating'
  | 'backpressure' | 'network-reconnecting' | 'network-disconnected' | 'rate-limited' | 'paused'
  | 'recognition-failed' | 'stopping' | 'error';

export type SubtitleTranslationStatus = 'off' | 'queued' | 'streaming' | 'draft' | 'confirmed' | 'error';

export interface RealtimeSubtitleSegment {
  id: string;
  sequence: number;
  startTime: number;
  endTime: number;
  capturedAt: number;
  sourceText: string;
  stableSourceText: string;
  translatedText: string;
  sourceLanguage: 'zh' | 'en';
  targetLanguage: 'zh' | 'en';
  status: 'provisional' | 'confirmed';
  revision: number;
  translationStatus: SubtitleTranslationStatus;
  translationError: string | null;
  translationSourceRevision: number | null;
  translationRevision: number;
  translationRequestId: string | null;
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
  preparation: ASRPreparation | null;
  translationPending: number;
  recognitionPending: number;
  isPaused: boolean;
  isStarting: boolean;
}

export interface RealtimeSessionOptions {
  capture: AudioCapture;
  asr: ASRProvider;
  translation: TranslationProvider;
  model?: RealtimeTranslationRequest['model'];
  sourceLanguage: RealtimeSourceLanguage;
  targetLanguage: RealtimeTargetLanguage;
  context?: string;
  terminology?: string;
  preserveNames?: boolean;
  transcriptionOnly?: boolean;
  onChange?: (state: RealtimeSessionState) => void;
  now?: () => number;
}

interface QueuedChunk extends RealtimeAudioChunk {
  sequence: number;
  capturedAt: number;
  baseText?: string;
  committedPrefix?: string;
  stableReference?: string;
}

const emptyMetrics = (): RealtimeMetrics => ({
  captureTimestamp: null, chunkDurationMs: 0, asrLatencyMs: null,
  asrFirstResponseLatencyMs: null, translationLatencyMs: null,
  endToEndSubtitleLatencyMs: null, revisions: 0,
  discardedStaleResponses: 0, retryCount: 0, rateLimitCount: 0,
});

function joinSource(left: string, right: string) {
  if (!left) return right;
  if (!right) return left;
  return left + (/\p{Script=Han}$/u.test(left) || /^\p{Script=Han}/u.test(right) ? '' : ' ') + right;
}

function sharedPrefix(previous: string, next: string) {
  let length = 0;
  while (length < previous.length && length < next.length && previous[length] === next[length]) length++;
  let prefix = next.slice(0, length);
  if (length < next.length && /[A-Za-z]$/.test(prefix)) prefix = prefix.replace(/[A-Za-z]+$/, '');
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
}

function boundedPrefix(text: string) {
  const maximum = REALTIME_CONFIG.maximumUtteranceCharacters;
  let length = maximum;
  const candidates = text.slice(0, maximum).matchAll(/[。！？.!?;；,，\s]/g);
  for (const match of candidates) if (match.index >= maximum / 2) length = match.index + match[0].length;
  if (/[\uD800-\uDBFF]/.test(text[length - 1])) length--;
  return length;
}

export class RealtimeSessionEngine {
  private readonly options: RealtimeSessionOptions;
  private readonly now: () => number;
  private state: RealtimeSessionState = {
    status: 'idle', error: null, current: null, segments: [], metrics: emptyMetrics(),
    isListening: false, preparation: null, translationPending: 0, recognitionPending: 0, isPaused: false, isStarting: false,
  };
  private chunker = new RealtimeAudioChunker();
  private translations: RealtimeTranslationScheduler;
  private startController: AbortController | null = null;
  private activeASR: AbortController | null = null;
  private audioStream: ASRAudioStream | null = null;
  private streamController: AbortController | null = null;
  private streamBufferedMs = 0;
  private streamUtterance: string | null = null;
  private streamRevision = 0;
  private streamBackpressure = false;
  private acceptingStreamTail = false;
  private openingStream: Promise<void> | null = null;
  private finishingStream: Promise<void> | null = null;
  private queue: QueuedChunk[] = [];
  private sequence = 0;
  private generation = 0;
  private utteranceCounter = 0;
  private requestCounter = 0;
  private committedTail = '';
  private pumping = false;
  private pausedByUser = false;
  private pauseToken = 0;
  private asrBlocked = false;
  private asrFailure: { status: RealtimeStatus; error: string } | null = null;
  private stopping = false;
  private stopPromise: Promise<void> | null = null;
  private disposed = false;
  private drainWaiters: Array<() => void> = [];
  private networkHandlers: { online: () => void; offline: () => void } | null = null;

  constructor(options: RealtimeSessionOptions) {
    this.options = options;
    this.now = options.now || (() => performance.now());
    this.translations = new RealtimeTranslationScheduler(REALTIME_CONFIG.provisionalTranslationIntervalMs, this.now);
  }
  getSnapshot = () => this.state;

  updateSettings(settings: Partial<Pick<RealtimeSessionOptions, 'model' | 'sourceLanguage' | 'targetLanguage' | 'context' | 'terminology' | 'preserveNames' | 'asr' | 'transcriptionOnly'>>) {
    if (this.state.isListening || this.startController || this.stopping || this.queue.length || this.state.translationPending || this.disposed) return;
    if (settings.asr && settings.asr !== this.options.asr) this.options.asr.dispose?.();
    Object.assign(this.options, settings);
  }

  async start() {
    if (this.state.isListening || this.startController || this.stopping || this.queue.length || this.state.translationPending || this.disposed) return;
    this.streamController?.abort();
    this.audioStream?.dispose();
    this.audioStream = null;
    this.streamController = null;
    this.streamBufferedMs = 0;
    this.streamUtterance = null;
    this.streamRevision = 0;
    this.streamBackpressure = false;
    const controller = new AbortController();
    this.startController = controller;
    this.generation++;
    this.translations.dispose();
    this.translations = new RealtimeTranslationScheduler(REALTIME_CONFIG.provisionalTranslationIntervalMs, this.now);
    this.chunker = new RealtimeAudioChunker(this.options.asr.chunkOptions);
    this.queue = [];
    this.sequence = 0;
    this.utteranceCounter = 0;
    this.committedTail = '';
    this.pausedByUser = false;
    this.pauseToken++;
    this.asrBlocked = false;
    this.asrFailure = null;
    this.patch({ status: this.options.asr.prepare ? 'preparing-model' : 'requesting-microphone',
      error: null, preparation: null, current: null, segments: [], metrics: emptyMetrics(), isListening: false });
    try {
      // Keep Web Audio unlocking in the original tap, before asynchronous model loading.
      await this.options.capture.prepare?.();
      if (controller.signal.aborted || this.disposed) return;
      await this.options.asr.prepare?.((preparation) => {
        if (!controller.signal.aborted && !this.disposed) this.patch({ preparation });
      }, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      await this.openStreamingAudio();
      if (controller.signal.aborted || this.disposed) { this.closeStreamingAudio(); return; }
      this.patch({ status: 'requesting-microphone' });
      await this.options.capture.start((samples, sampleRate, startTime) => {
        if (this.disposed || this.pausedByUser && !this.acceptingStreamTail) return;
        const pcm = resampleToMono16k(samples, sampleRate);
        if (this.audioStream) this.audioStream.push(pcm, startTime);
        else for (const chunk of this.chunker.push(pcm, startTime)) this.enqueue(chunk);
      });
      if (this.disposed || controller.signal.aborted) { await this.options.capture.stop(false); return; }
      this.installNetworkHandlers();
      this.patch({ status: 'listening', isListening: true });
      this.syncCapture();
    } catch (error) {
      if (!this.disposed && !controller.signal.aborted) {
        this.patch({ status: 'error', isListening: false, error: this.permissionMessage(error) });
      }
      await this.options.capture.stop(false).catch(() => undefined);
      this.closeStreamingAudio();
    } finally {
      if (controller.signal.aborted) await this.options.capture.stop(false).catch(() => undefined);
      if (this.startController === controller) this.startController = null;
      if (controller.signal.aborted) this.refreshStatus();
      else this.patch({});
    }
  }

  async pause() {
    if (!this.state.isListening || this.pausedByUser || this.stopping) return;
    const token = ++this.pauseToken;
    const generation = this.generation;
    this.pausedByUser = true;
    this.acceptingStreamTail = !!this.audioStream;
    this.options.capture.setPaused(true);
    this.patch({ status: 'paused' });
    if (this.audioStream) {
      await this.finishStreamingAudio();
      this.acceptingStreamTail = false;
      this.refreshStatus();
      return;
    }
    for (const chunk of this.chunker.flush()) this.enqueue(chunk);
    await this.waitForDrain();
    if (token === this.pauseToken && generation === this.generation && this.pausedByUser && !this.stopping
      && !this.queue.length && !this.disposed) { this.confirmCurrent(); this.committedTail = ''; }
    this.refreshStatus();
  }

  async resume() {
    if (!this.state.isListening || !this.pausedByUser || this.stopping) return;
    if (this.options.asr.openStream) {
      try {
        await this.finishingStream;
        if (this.disposed || this.stopping) return;
        await this.openStreamingAudio();
      } catch (error) {
        this.streamingError(error instanceof Error ? error : new Error('流式识别无法继续，请结束后重新开始。'));
        return;
      }
      if (this.disposed || this.stopping) return;
    }
    this.pausedByUser = false;
    this.pauseToken++;
    this.syncCapture();
    this.refreshStatus();
  }

  async retryPending() {
    if (this.disposed || this.startController) return;
    if (this.options.asr.openStream && this.asrBlocked) {
      this.patch({ error: '本机流式识别已中断，请结束后重新开始。已显示的文字仍保留。' });
      return;
    }
    this.asrBlocked = false;
    this.asrFailure = null;
    this.patch({ error: null });
    this.retryTranslation();
    void this.pump();
    await this.waitForDrain();
    if (!this.queue.length && (!this.state.isListening || this.pausedByUser)) {
      this.confirmCurrent();
      this.committedTail = '';
    }
    this.syncCapture();
    this.refreshStatus();
  }

  retryTranslation(id?: string) {
    if (this.disposed || this.options.transcriptionOnly) return;
    const failed = [...this.state.segments, ...(this.state.current ? [this.state.current] : [])]
      .filter((segment) => segment.translationStatus === 'error' && (!id || segment.id === id));
    for (const segment of failed) this.scheduleTranslation(segment, segment.status);
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.finishCapture().finally(() => { this.stopPromise = null; });
    return this.stopPromise;
  }

  private async finishCapture() {
    if (this.disposed || !this.state.isListening && !this.startController && !this.queue.length) return;
    this.stopping = true;
    this.pauseToken++;
    this.startController?.abort(new DOMException('Session stopped', 'AbortError'));
    this.patch({ status: 'stopping' });
    await this.options.capture.stop(true).catch(() => undefined);
    if (this.options.asr.openStream) await this.finishStreamingAudio();
    for (const chunk of this.chunker.flush()) this.enqueue(chunk);
    this.patch({ isListening: false });
    await this.waitForDrain();
    if (!this.queue.length && !this.disposed) { this.confirmCurrent(); this.committedTail = ''; }
    this.removeNetworkHandlers();
    await this.translations.whenIdle();
    this.stopping = false;
    this.refreshStatus();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.startController?.abort(new DOMException('Session disposed', 'AbortError'));
    this.activeASR?.abort(new DOMException('Session disposed', 'AbortError'));
    this.closeStreamingAudio();
    this.translations.dispose();
    this.queue = [];
    this.options.asr.dispose?.();
    this.removeNetworkHandlers();
    this.notifyDrain();
    await this.options.capture.stop(false).catch(() => undefined);
  }

  private enqueue(chunk: RealtimeAudioChunk) {
    if (this.disposed) return;
    // Pausing starts before the configured depth is reached. Preserve an already
    // delivered worklet tail instead of discarding recorded speech.
    this.queue.push({ ...chunk, sequence: ++this.sequence, capturedAt: this.now() });
    this.patch({ metrics: { ...this.state.metrics, chunkDurationMs: chunk.durationMs } });
    this.syncCapture();
    this.refreshStatus();
    void this.pump();
  }

  private openStreamingAudio(): Promise<void> {
    if (!this.options.asr.openStream || this.audioStream || this.disposed || this.stopping) return Promise.resolve();
    if (this.openingStream) return this.openingStream;
    const controller = new AbortController();
    const generation = this.generation;
    this.streamController = controller;
    this.streamUtterance = null;
    this.streamRevision = 0;
    this.streamBufferedMs = 0;
    this.streamBackpressure = false;
    const live = () => !this.disposed && !controller.signal.aborted && this.generation === generation && this.streamController === controller;
    const startSignal = this.startController?.signal;
    const cancelStart = () => controller.abort(startSignal?.reason);
    startSignal?.addEventListener('abort', cancelStart, { once: true });
    this.openingStream = (async () => {
      try {
        const stream = await this.options.asr.openStream!({
          onTranscript: event => { if (live()) this.acceptStreamingTranscript(event); else this.countStale(); },
          onPending: bufferedMs => {
            if (!live()) return;
            this.streamBufferedMs = bufferedMs;
            if (bufferedMs >= 1500) this.streamBackpressure = true;
            else if (bufferedMs <= 400) this.streamBackpressure = false;
            this.syncCapture();
            this.refreshStatus();
          },
          onError: error => { if (live()) this.streamingError(error); },
        }, controller.signal);
        if (!live() || this.stopping) stream.dispose();
        else this.audioStream = stream;
      } finally {
        startSignal?.removeEventListener('abort', cancelStart);
        this.openingStream = null;
      }
    })();
    return this.openingStream;
  }

  private finishStreamingAudio(): Promise<void> {
    if (this.finishingStream) return this.finishingStream;
    const stream = this.audioStream;
    if (!stream) return Promise.resolve();
    this.finishingStream = (async () => {
      try {
        await this.options.capture.flush?.();
        await stream.finish();
      } catch (error) {
        stream.dispose();
        if (!this.disposed) this.streamingError(error instanceof Error ? error : new Error('最后一段识别未完成，已显示文字仍保留。'));
      } finally {
        if (this.audioStream === stream) {
          this.audioStream = null;
          this.streamController = null;
          this.streamBufferedMs = 0;
          this.streamBackpressure = false;
        }
        this.finishingStream = null;
        this.patch({});
      }
    })();
    return this.finishingStream;
  }

  private closeStreamingAudio() {
    this.streamController?.abort(new DOMException('Streaming session closed', 'AbortError'));
    this.audioStream?.dispose();
    this.audioStream = null;
    this.streamController = null;
    this.streamBufferedMs = 0;
    this.streamBackpressure = false;
  }

  private streamingError(error: Error) {
    if (this.disposed) return;
    this.asrBlocked = true;
    this.asrFailure = { status: 'recognition-failed', error: error.message + ' 已显示文字保留，请结束后重新开始。' };
    this.options.capture.setPaused(true);
    this.patch(this.asrFailure);
  }

  private acceptStreamingTranscript(event: StreamingTranscript) {
    if (this.streamUtterance !== event.utteranceId) {
      if (this.state.current) this.confirmCurrent();
      this.streamUtterance = event.utteranceId;
      this.streamRevision = 0;
    }
    if (event.revision <= this.streamRevision) { this.countStale(); return; }
    this.streamRevision = event.revision;
    const text = event.text.trim();
    if (!text) { if (event.final) this.confirmCurrent(); return; }
    const previous = this.state.current;
    const sourceLanguage = this.options.sourceLanguage === 'auto' ? detectRealtimeSourceLanguage(text) : this.options.sourceLanguage;
    const changed = previous?.sourceText !== text;
    const segment: RealtimeSubtitleSegment = {
      id: previous?.id || this.nextUtteranceId(), sequence: previous?.sequence || ++this.sequence,
      startTime: previous?.startTime ?? event.startTime, endTime: event.endTime,
      capturedAt: previous?.capturedAt ?? event.startTime,
      sourceText: text, stableSourceText: event.final ? text : sharedPrefix(previous?.sourceText || '', text),
      translatedText: previous?.translatedText || '', sourceLanguage,
      targetLanguage: resolveRealtimeTarget(sourceLanguage, this.options.targetLanguage),
      status: 'provisional', revision: (previous?.revision || 0) + (changed ? 1 : 0),
      translationStatus: this.options.transcriptionOnly ? 'off' : previous?.translationRequestId ? previous.translationStatus : 'draft',
      translationError: null, translationSourceRevision: previous?.translationSourceRevision ?? null,
      translationRevision: previous?.translationRevision || 0,
      translationRequestId: previous?.translationRequestId || null,
    };
    this.patch({ current: segment, metrics: { ...this.state.metrics,
      captureTimestamp: segment.capturedAt, chunkDurationMs: event.endTime - event.startTime,
      asrLatencyMs: event.latencyMs,
      asrFirstResponseLatencyMs: this.state.metrics.asrFirstResponseLatencyMs ?? Math.max(0, this.now() - event.startTime),
      revisions: this.state.metrics.revisions + (changed ? 1 : 0),
    } });
    if (event.final) {
      this.confirmCurrent();
      this.committedTail = '';
    } else if (!this.options.transcriptionOnly && changed && text.length >= REALTIME_CONFIG.minimumTranslationCharacters
      && text.length <= REALTIME_CONFIG.maximumUtteranceCharacters) this.scheduleTranslation(segment, 'provisional');
  }

  private async pump() {
    if (this.pumping || this.disposed || this.asrBlocked) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.disposed && !this.asrBlocked) {
        const chunk = this.queue.shift()!;
        this.syncCapture();
        const success = await this.processChunk(chunk);
        if (!success && !this.disposed) { this.queue.unshift(chunk); this.asrBlocked = true; }
        this.syncCapture();
      }
    } finally {
      this.pumping = false;
      this.patch({});
      this.notifyDrain();
      this.refreshStatus();
    }
  }

  private async processChunk(chunk: QueuedChunk): Promise<boolean> {
    const controller = new AbortController();
    const generation = this.generation;
    this.activeASR = controller;
    const live = () => !this.disposed && !controller.signal.aborted && generation === this.generation && this.activeASR === controller;
    if (chunk.baseText === undefined) {
      chunk.committedPrefix = this.committedTail;
      chunk.stableReference = this.state.current?.sourceText || '';
      chunk.baseText = joinSource(this.committedTail, chunk.stableReference);
    }
    this.refreshStatus();
    this.patch({ error: null });
    try {
      const request: RealtimeAudioRequest = {
        audioDataUrl: await encodeWavDataUrl(chunk.samples), language: this.options.sourceLanguage, sequence: chunk.sequence,
      };
      if (!this.options.asr.transcribe) throw new Error('语音识别引擎不支持音频分段。');
      const result = await this.options.asr.transcribe(request, {
        onPartial: (event) => { if (live()) this.acceptTranscript(chunk, event.text); else this.countStale(); },
        onReset: () => {
          if (live() && this.state.current) {
            this.translations.discardDraft(this.state.current.id);
            this.patch({ current: { ...this.state.current, translationRequestId: null,
              translationStatus: this.options.transcriptionOnly ? 'off' : 'draft', translationError: null } });
          }
        },
        onRetry: (notice) => { if (live()) this.onASRRetry(notice); },
      }, controller.signal);
      if (!live()) { this.countStale(); return false; }
      this.patch({ metrics: { ...this.state.metrics, asrLatencyMs: result.responseLatencyMs, asrFirstResponseLatencyMs: result.firstResponseMs }, error: null });
      this.acceptTranscript(chunk, result.text);
      const segment = this.state.current;
      const boundary = chunk.reason !== 'window' || !!segment && (
        /[。！？.!?][”’"'）)\]]*$/u.test(segment.sourceText)
        || segment.endTime - segment.startTime >= REALTIME_CONFIG.maximumUtteranceMs);
      this.confirmCurrent(boundary);
      if (chunk.reason !== 'window') this.committedTail = '';
      return true;
    } catch (error) {
      if (!live()) return false;
      const rateLimited = typeof error === 'object' && error !== null && 'status' in error && error.status === 429;
      this.asrFailure = { status: rateLimited ? 'rate-limited' : this.options.asr.execution === 'local' ? 'recognition-failed' : 'network-disconnected',
        error: error instanceof Error ? error.message : '语音识别失败，当前音频已保留，可重试。' };
      this.patch(this.asrFailure);
      return false;
    } finally {
      if (this.activeASR === controller) this.activeASR = null;
    }
  }

  private acceptTranscript(chunk: QueuedChunk, text: string) {
    if (!text.trim()) return;
    let merged = mergeTranscriptOverlap(chunk.baseText || '', text);
    if (chunk.committedPrefix && merged.startsWith(chunk.committedPrefix)) merged = merged.slice(chunk.committedPrefix.length).trim();
    if (!merged) return;
    const previous = this.state.current;
    if (previous?.sourceText === merged) {
      const current = { ...previous, endTime: chunk.endTime, sequence: chunk.sequence };
      this.patch({ current });
      if (!this.options.transcriptionOnly && !current.translationRequestId && merged.length >= REALTIME_CONFIG.minimumTranslationCharacters
        && merged.length <= REALTIME_CONFIG.maximumUtteranceCharacters) this.scheduleTranslation(current, 'provisional');
      return;
    }
    const sourceLanguage = this.options.sourceLanguage === 'auto' ? detectRealtimeSourceLanguage(merged) : this.options.sourceLanguage;
    const segment: RealtimeSubtitleSegment = {
      id: previous?.id || this.nextUtteranceId(), sequence: chunk.sequence,
      startTime: previous?.startTime ?? chunk.startTime, endTime: chunk.endTime,
      capturedAt: previous?.capturedAt ?? chunk.capturedAt, sourceText: merged,
      stableSourceText: sharedPrefix(chunk.stableReference || '', merged),
      translatedText: previous?.translatedText || '', sourceLanguage,
      targetLanguage: resolveRealtimeTarget(sourceLanguage, this.options.targetLanguage),
      status: 'provisional', revision: (previous?.revision || 0) + 1,
      translationStatus: this.options.transcriptionOnly ? 'off' : previous?.translationRequestId ? previous.translationStatus : 'draft', translationError: null,
      translationSourceRevision: previous?.translationSourceRevision ?? null,
      translationRevision: previous?.translationRevision || 0, translationRequestId: previous?.translationRequestId || null,
    };
    this.patch({ current: segment, metrics: { ...this.state.metrics, captureTimestamp: segment.capturedAt, revisions: this.state.metrics.revisions + 1 } });
    if (!this.options.transcriptionOnly && merged.length >= REALTIME_CONFIG.minimumTranslationCharacters
      && merged.length <= REALTIME_CONFIG.maximumUtteranceCharacters) this.scheduleTranslation(segment, 'provisional');
  }

  private confirmCurrent(force = true) {
    while (this.state.current?.sourceText.trim()) {
      const segment = this.state.current;
      const oversized = segment.sourceText.length > REALTIME_CONFIG.maximumUtteranceCharacters;
      if (!force && !oversized) return;
      const length = oversized ? boundedPrefix(segment.sourceText) : segment.sourceText.length;
      const sourceText = segment.sourceText.slice(0, length).trim();
      const remainder = segment.sourceText.slice(length).trim();
      const endTime = segment.startTime + (segment.endTime - segment.startTime) * length / segment.sourceText.length;
      const confirmed: RealtimeSubtitleSegment = {
        ...segment, sourceText, stableSourceText: sourceText, endTime, revision: segment.revision + 1,
        translatedText: oversized ? '' : segment.translatedText, status: 'confirmed',
        translationStatus: this.options.transcriptionOnly ? 'off' : 'queued', translationError: null, translationRequestId: null,
      };
      const current: RealtimeSubtitleSegment | null = remainder ? {
        ...segment, id: this.nextUtteranceId(), startTime: endTime, sourceText: remainder, stableSourceText: '',
        translatedText: '', revision: 1, translationStatus: this.options.transcriptionOnly ? 'off' : 'draft',
        translationSourceRevision: null, translationRevision: 0, translationRequestId: null, translationError: null,
      } : null;
      this.committedTail = Array.from(joinSource(this.committedTail, sourceText)).slice(-160).join('');
      this.patch({ segments: [...this.state.segments, confirmed], current });
      if (!this.options.transcriptionOnly) this.scheduleTranslation(confirmed, 'confirmed');
      this.syncCapture();
      if (!force && current && current.sourceText.length <= REALTIME_CONFIG.maximumUtteranceCharacters) {
        this.scheduleTranslation(current, 'provisional');
      }
    }
  }

  private scheduleTranslation(snapshot: RealtimeSubtitleSegment, stage: 'provisional' | 'confirmed') {
    if (this.disposed || this.options.transcriptionOnly) return;
    const generation = this.generation;
    const requestId = snapshot.id + '-t' + ++this.requestCounter;
    const segment = { ...snapshot };
    let retainedDraft = { text: segment.translatedText, sourceRevision: segment.translationSourceRevision };
    let generationDraft: typeof retainedDraft | null = null;
    let runCount = 0;
    const currentSegment = () => this.state.current?.id === segment.id ? this.state.current : this.state.segments.find((item) => item.id === segment.id);
    const eligible = () => {
      const current = currentSegment();
      return !this.disposed && generation === this.generation && !!current
        && current.status === stage && current.sourceLanguage === segment.sourceLanguage && current.targetLanguage === segment.targetLanguage
        && (stage === 'confirmed' ? current.revision === segment.revision : current.revision >= segment.revision);
    };
    // A draft translating a slightly earlier source snapshot may remain visible
    // while speech grows. It is tagged with its own source revision; it cannot
    // overwrite a newer translation generation or a confirmed sentence.
    const live = () => eligible() && currentSegment()?.translationRequestId === requestId;
    const waiting = currentSegment();
    if (waiting && !waiting.translationRequestId) this.replaceSegment({ ...waiting, translationStatus: 'queued', translationError: null });
    const change = (partial: Partial<RealtimeSubtitleSegment>) => {
      if (!live()) { this.countStale(); return; }
      this.replaceSegment({ ...currentSegment()!, ...partial });
    };
    this.translations.submit({
      utteranceId: segment.id, revision: segment.revision, stage,
      run: (signal, handlers) => live() ? this.options.translation.translate(this.translationRequest(segment, stage, `${requestId}-g${++runCount}`), signal,
        (notice) => {
          if (!live()) return;
          this.recordRetry(notice);
          change({ translationError: `正在重试（${notice.attempt}/${notice.maxRetries}）…` });
        }, handlers) : Promise.reject(new DOMException('Translation snapshot superseded', 'AbortError')),
      onStart: () => {
        if (!eligible()) return;
        const current = currentSegment()!;
        retainedDraft = { text: current.translatedText, sourceRevision: current.translationSourceRevision };
        this.replaceSegment({ ...current, translationRequestId: requestId, translationStatus: 'streaming',
          translationError: null, translationRevision: current.translationRevision + 1 });
      },
      onReset: (reason) => {
        if (reason !== 'invalid' && generationDraft) retainedDraft = generationDraft;
        generationDraft = null;
        // Reset the new generation's accumulator without discarding the last
        // readable draft. Invalid protocol text never becomes the fallback.
        change({ translatedText: retainedDraft.text, translationSourceRevision: retainedDraft.sourceRevision, translationError: null });
      },
      onDelta: (text) => {
        generationDraft = { text, sourceRevision: segment.revision };
        change({ translatedText: text, translationStatus: 'streaming', translationSourceRevision: segment.revision });
      },
      onComplete: (result: RealtimeTranslationResult) => {
        if (!live()) { this.countStale(); return; }
        if (result.sequence !== segment.sequence || result.revision !== segment.revision || result.stage !== stage || !result.translation?.trim()) {
          change({ translationStatus: 'error', translationError: '译文与当前语段不匹配，可重试。' }); return;
        }
        change({ translatedText: result.translation, translationSourceRevision: segment.revision,
          translationStatus: stage === 'confirmed' ? 'confirmed' : 'draft', translationError: null });
        this.patch({ metrics: { ...this.state.metrics, translationLatencyMs: result.latencyMs, endToEndSubtitleLatencyMs: this.now() - segment.capturedAt } });
        this.syncCapture();
        this.refreshStatus();
      },
      onError: (error) => {
        if (generationDraft) retainedDraft = generationDraft;
        change({ translatedText: retainedDraft.text, translationSourceRevision: retainedDraft.sourceRevision,
          translationStatus: 'error', translationError: error instanceof Error ? error.message : '译文生成失败，可重试。' });
        this.syncCapture();
        this.refreshStatus();
      },
    });
  }

  private translationRequest(segment: RealtimeSubtitleSegment, stage: 'provisional' | 'confirmed', requestId: string): RealtimeTranslationRequest {
    const position = this.state.segments.findIndex((item) => item.id === segment.id);
    const previous = position < 0 ? this.state.segments : this.state.segments.slice(0, position);
    const confirmedContext = previous.slice(-REALTIME_CONFIG.recentContextSegments).map((item) => ({
      source: item.sourceText, translation: item.translationStatus === 'confirmed' ? item.translatedText : '',
      source_language: item.sourceLanguage, target_language: item.targetLanguage,
    }));
    return {
      utteranceId: segment.id, requestId, sourceText: segment.sourceText,
      model: this.options.model,
      sourceLanguage: segment.sourceLanguage, targetLanguage: segment.targetLanguage,
      stage, sequence: segment.sequence, revision: segment.revision,
      context: this.options.context, terminology: this.options.terminology,
      preserveNames: this.options.preserveNames, confirmedContext,
    };
  }

  private replaceSegment(segment: RealtimeSubtitleSegment) {
    if (this.state.current?.id === segment.id) this.patch({ current: segment });
    else this.patch({ segments: this.state.segments.map((item) => item.id === segment.id ? segment : item) });
  }
  private nextUtteranceId() { return `realtime-${this.generation}-${++this.utteranceCounter}`; }
  private finalBacklog() { return this.state.segments.filter((item) => item.translationStatus === 'queued' || item.translationStatus === 'streaming').length; }
  private syncCapture() {
    if (!this.state.isListening || this.disposed || this.stopping) return;
    this.options.capture.setPaused(this.pausedByUser || this.asrBlocked
      || this.streamBackpressure
      || this.queue.length >= REALTIME_CONFIG.maxQueuedAudioChunks - 1
      || this.finalBacklog() >= REALTIME_CONFIG.maximumPendingTranslations);
  }
  private refreshStatus() {
    if (this.disposed) return;
    if (this.stopping) { this.patch({ status: 'stopping' }); return; }
    if (this.startController && !this.state.isListening) {
      if (this.startController.signal.aborted) this.patch({ status: 'stopping' });
      return;
    }
    if (this.asrBlocked) { if (this.asrFailure) this.patch(this.asrFailure); return; }
    if (this.pausedByUser && this.state.isListening) { this.patch({ status: 'paused' }); return; }
    if (!this.state.isListening) { this.patch({ status: 'idle' }); return; }
    if (this.streamBackpressure || this.queue.length >= REALTIME_CONFIG.maxQueuedAudioChunks - 1 || this.finalBacklog() >= REALTIME_CONFIG.maximumPendingTranslations) {
      this.patch({ status: 'backpressure', error: '积压较多，已暂停收音；处理后自动继续。暂停期间的讲话不会录入。' }); return;
    }
    this.patch({ status: this.activeASR || this.streamBufferedMs > 0 ? 'recognizing' : 'listening', error: null });
  }
  private countStale() { if (!this.disposed) this.patch({ metrics: { ...this.state.metrics, discardedStaleResponses: this.state.metrics.discardedStaleResponses + 1 } }); }
  private recordRetry(notice: RetryNotice) {
    this.patch({ metrics: { ...this.state.metrics, retryCount: this.state.metrics.retryCount + 1,
      rateLimitCount: this.state.metrics.rateLimitCount + (notice.rateLimited ? 1 : 0) } });
  }
  private onASRRetry(notice: RetryNotice) {
    this.recordRetry(notice);
    this.patch({ status: this.stopping ? 'stopping' : this.pausedByUser ? 'paused' : 'network-reconnecting',
      error: `语音识别正在重试（${notice.attempt}/${notice.maxRetries}）…` });
  }
  private permissionMessage(error: unknown) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return '麦克风权限未开启，请在浏览器设置中允许使用麦克风。';
    if (error instanceof DOMException && error.name === 'NotFoundError') return '未检测到可用麦克风。';
    return error instanceof Error ? error.message : '无法启动麦克风，请检查设备后重试。';
  }
  private patch(partial: Partial<RealtimeSessionState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...partial };
    const subtitles = this.state.current ? [...this.state.segments, this.state.current] : this.state.segments;
    this.state = { ...this.state, translationPending: subtitles.filter((item) => item.translationStatus === 'queued' || item.translationStatus === 'streaming').length,
      recognitionPending: this.queue.length + (this.activeASR ? 1 : 0) + (this.streamBufferedMs > 0 ? 1 : 0), isPaused: this.pausedByUser, isStarting: this.startController !== null };
    this.options.onChange?.(this.state);
  }
  private waitForDrain() {
    if (this.disposed || !this.pumping && (!this.queue.length || this.asrBlocked)) return Promise.resolve();
    return new Promise<void>((resolve) => this.drainWaiters.push(resolve));
  }
  private notifyDrain() {
    if (!this.disposed && (this.pumping || this.queue.length && !this.asrBlocked)) return;
    for (const resolve of this.drainWaiters.splice(0)) resolve();
  }
  private installNetworkHandlers() {
    if (typeof window === 'undefined' || this.options.asr.execution === 'local' && this.options.transcriptionOnly) return;
    this.removeNetworkHandlers();
    this.networkHandlers = {
      online: () => { void this.retryPending(); },
      offline: () => {
        if (this.options.asr.execution !== 'local') this.patch({ error: '网络已断开，已采集音频保留，可在恢复连接后重试。' });
      },
    };
    window.addEventListener('online', this.networkHandlers.online);
    window.addEventListener('offline', this.networkHandlers.offline);
  }
  private removeNetworkHandlers() {
    if (!this.networkHandlers || typeof window === 'undefined') return;
    window.removeEventListener('online', this.networkHandlers.online);
    window.removeEventListener('offline', this.networkHandlers.offline);
    this.networkHandlers = null;
  }
}
