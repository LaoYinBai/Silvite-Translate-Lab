import { API_BASE_URL } from './client';
import { type RealtimeSourceLanguage } from '../services/realtime/config';
import { RealtimeApiError, withRealtimeRetry, type RetryNotice } from '../services/realtime/retry';

export interface RealtimeAudioRequest {
  audioDataUrl: string;
  language: RealtimeSourceLanguage;
  sequence: number;
}

export interface RealtimeTranslationRequest {
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
  sequence: number;
  revision: number;
  stage: 'provisional' | 'confirmed';
  translation: string;
  latencyMs: number;
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
): Promise<RealtimeTranslationResult> {
  return withRealtimeRetry(async () => {
    const startedAt = performance.now();
    const response = await fetch(`${API_BASE_URL}/realtime/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) throw await responseError(response);
    const payload = await response.json() as RealtimeTranslationResult;
    if (payload.sequence !== request.sequence || payload.revision !== request.revision
      || payload.stage !== request.stage || typeof payload.translation !== 'string') {
      throw new RealtimeApiError('实时翻译响应与当前字幕不匹配，请重试。', 502, 'STALE_TRANSLATION_RESPONSE');
    }
    return { ...payload, latencyMs: performance.now() - startedAt };
  }, { signal, onRetry });
}
