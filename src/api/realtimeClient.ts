import { API_BASE_URL, type TranslationModelId } from './client';
import { readEventStream } from './eventStream';
import { type RealtimeSourceLanguage } from '../services/realtime/config';
import { RealtimeApiError, withRealtimeRetry, type RetryNotice } from '../services/realtime/retry';

export interface RealtimeAudioRequest {
  audioDataUrl: string;
  language: RealtimeSourceLanguage;
  sequence: number;
}

export interface RealtimeTranslationRequest {
  model?: TranslationModelId;
  utteranceId?: string;
  requestId?: string;
  sourceText: string;
  sourceLanguage: 'zh' | 'en';
  targetLanguage: 'zh' | 'en';
  stage: 'provisional' | 'confirmed';
  sequence: number;
  revision: number;
  context?: string;
  terminology?: string;
  preserveNames?: boolean;
  sessionSummary?: string;
  confirmedContext?: Array<{
    source: string;
    translation: string;
    source_language?: string;
    target_language?: string;
  }>;
}

export interface RealtimePartialTranscript {
  sequence: number;
  revision: number;
  text: string;
}

export interface RealtimeASRHandlers {
  onPartial?: (event: RealtimePartialTranscript, timing: { firstResponseMs: number; firstPartialMs: number }) => void;
  onReset?: () => void;
  onRetry?: (notice: RetryNotice) => void;
}

export interface RealtimeASRResult extends RealtimePartialTranscript {
  responseLatencyMs: number;
  firstResponseMs: number;
  firstPartialMs: number;
}

export interface RealtimeTranslationResult {
  utteranceId?: string;
  requestId?: string;
  sequence: number;
  revision: number;
  stage: 'provisional' | 'confirmed';
  translation: string;
  latencyMs: number;
}

export interface RealtimeTranslationHandlers {
  /** Full text of this generation so far, replaced after onReset. */
  onDelta?: (text: string) => void;
  onReset?: (reason?: 'generation' | 'invalid') => void;
}

async function responseError(response: Response): Promise<RealtimeApiError> {
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
  return new RealtimeApiError(
    payload.message || '实时翻译请求失败，请稍后重试。',
    response.status,
    payload.error,
  );
}

async function transcribeOnce(
  request: RealtimeAudioRequest,
  handlers: RealtimeASRHandlers,
  signal: AbortSignal | undefined,
): Promise<RealtimeASRResult> {
  const startedAt = performance.now();
  const response = await fetch(`${API_BASE_URL}/realtime/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  const firstResponseMs = performance.now() - startedAt;
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new RealtimeApiError('语音识别连接中断，请重试。', 502, 'ASR_STREAM_INTERRUPTED');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLine = '';
  let dataSeen = false;
  let firstPartialMs = 0;
  let finalResult: RealtimePartialTranscript | null = null;
  let lastError: RealtimeApiError | null = null;
  let latestRevision = 0;

  const dispatch = (raw: string) => {
    let event: { type?: string; sequence?: number; revision?: number; text?: string; code?: string; message?: string };
    try { event = JSON.parse(raw); } catch { return; }
    if (event.sequence !== request.sequence) return;
    if (event.type === 'partial' && typeof event.text === 'string' && Number.isSafeInteger(event.revision)) {
      if ((event.revision as number) <= latestRevision) return;
      latestRevision = event.revision as number;
      if (!firstPartialMs) firstPartialMs = performance.now() - startedAt;
      handlers.onPartial?.({
        sequence: request.sequence,
        revision: latestRevision,
        text: event.text,
      }, { firstResponseMs, firstPartialMs });
    } else if (event.type === 'final' && typeof event.text === 'string' && Number.isSafeInteger(event.revision)) {
      if ((event.revision as number) <= latestRevision) return;
      latestRevision = event.revision as number;
      finalResult = { sequence: request.sequence, revision: latestRevision, text: event.text };
    } else if (event.type === 'error') {
      lastError = new RealtimeApiError(event.message || '语音识别失败，请重试。', undefined, event.code);
    }
  };

  const processLine = (line: string) => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!normalized) {
      if (dataSeen) dispatch(dataLine);
      dataLine = '';
      dataSeen = false;
    } else if (normalized.startsWith('data:')) {
      dataLine += (dataSeen ? '\n' : '') + normalized.slice(5).trimStart();
      dataSeen = true;
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        processLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) processLine(buffer);
    if (dataSeen) dispatch(dataLine);
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    throw new RealtimeApiError('语音识别连接中断，请重试。', 502, 'ASR_STREAM_INTERRUPTED');
  } finally {
    reader.releaseLock();
  }

  if (lastError) throw lastError;
  const resolvedFinal = finalResult as RealtimePartialTranscript | null;
  if (!resolvedFinal) throw new RealtimeApiError('语音识别连接中断，请重试。', 502, 'ASR_STREAM_INTERRUPTED');
  return {
    ...resolvedFinal,
    responseLatencyMs: performance.now() - startedAt,
    firstResponseMs,
    firstPartialMs: firstPartialMs || performance.now() - startedAt,
  };
}

export async function transcribeRealtimeAudio(
  request: RealtimeAudioRequest,
  handlers: RealtimeASRHandlers = {},
  signal?: AbortSignal,
): Promise<RealtimeASRResult> {
  return withRealtimeRetry(
    (attempt) => {
      if (attempt > 0) handlers.onReset?.();
      return transcribeOnce(request, handlers, signal);
    },
    { signal, onRetry: handlers.onRetry },
  );
}

export async function translateRealtimeSegment(
  request: RealtimeTranslationRequest,
  signal?: AbortSignal,
  onRetry?: (notice: RetryNotice) => void,
  handlers: RealtimeTranslationHandlers = {},
): Promise<RealtimeTranslationResult> {
  const logicalId = request.requestId || `translation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return withRealtimeRetry(async (attempt) => {
    const startedAt = performance.now();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    const timer = setTimeout(() => controller.abort(new RealtimeApiError('实时翻译等待超时，请重试。', 504, 'TRANSLATION_TIMEOUT')), 30_000);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const identity = { utteranceId: request.utteranceId || `realtime-${request.sequence}`, requestId: `${logicalId}:${attempt}` };
    const interrupted = () => new RealtimeApiError('实时翻译连接中断，请重试。', 502, 'TRANSLATION_STREAM_INTERRUPTED');
    handlers.onReset?.('generation');
    try {
      const response = await fetch(`${API_BASE_URL}/realtime/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ ...request, ...identity }), signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response);
      // Allow a frontend update to coexist with an older JSON endpoint during deployment.
      if (response.headers.get('Content-Type')?.includes('application/json')) {
        const payload = await response.json() as RealtimeTranslationResult;
        if (payload.sequence !== request.sequence || payload.revision !== request.revision || payload.stage !== request.stage
          || typeof payload.translation !== 'string' || !payload.translation.trim()) {
          throw new RealtimeApiError('实时翻译响应与当前字幕不匹配。', 502, 'STALE_TRANSLATION_RESPONSE');
        }
        return { ...payload, latencyMs: performance.now() - startedAt };
      }
      if (!response.body) throw interrupted();
      let translation = '';
      let final = false;
      await readEventStream(response.body, (raw) => {
        if (controller.signal.aborted) throw controller.signal.reason;
        let event: {
          type?: string; utteranceId?: string; requestId?: string; sequence?: number; revision?: number;
          stage?: string; text?: string; delta?: string; offset?: number; message?: string; code?: string;
        };
        try { event = JSON.parse(raw); } catch { throw interrupted(); }
        if (event.sequence !== request.sequence || event.revision !== request.revision || event.stage !== request.stage
          || event.utteranceId !== identity.utteranceId || event.requestId !== identity.requestId) return;
        if (event.type === 'delta' && typeof event.delta === 'string') {
          if (!Number.isSafeInteger(event.offset)) throw interrupted();
          if (event.offset! <= translation.length) return; // duplicate frame
          if (event.offset !== translation.length + event.delta.length) throw interrupted();
          translation += event.delta;
          handlers.onDelta?.(translation);
        } else if (event.type === 'final' && typeof event.text === 'string' && event.text.trim()) {
          translation = event.text;
          final = true;
          return false;
        } else if (event.type === 'error') {
          if (event.code === 'INVALID_TRANSLATION') handlers.onReset?.('invalid');
          throw new RealtimeApiError(event.message || '实时翻译失败，请重试。', 502, event.code || 'TRANSLATION_STREAM_ERROR');
        }
      }, controller.signal);
      if (!final) throw interrupted();
      return { ...identity, sequence: request.sequence, revision: request.revision, stage: request.stage,
        translation, latencyMs: performance.now() - startedAt };
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }, { signal, onRetry });
}
