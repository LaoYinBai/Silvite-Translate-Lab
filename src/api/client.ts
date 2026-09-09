export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export interface TranslationRequest {
  text?: string;
  imageDataUrl?: string;
  mode?: string;
  context?: string;
  terminology?: string;
  preserveNames?: boolean;
  explainTranslation?: boolean;
}

export interface TranslationResponse {
  source_language: string;
  target_language: string;
  detected_style?: 'natural' | 'literary' | 'academic' | 'business' | 'comic';
  translation: string;
  detected_text?: string | null;
  segments: Array<{
    type: string;
    source: string;
    translation: string;
    panel?: number;
    order?: number;
    speaker?: string | null;
    id?: string;
    reply_to?: string | null;
  }>;
  notes: Array<{
    source: string;
    translation: string;
    reason: string;
  }>;
}

// Application-layer stream events (NDJSON, one JSON object per line).
// The frontend never sees MiMo's SSE or any provider protocol detail.
export type TranslationStreamEvent =
  | { type: 'start'; mode: string }
  | { type: 'delta'; text: string }
  | { type: 'reset'; reason: string }
  | { type: 'final'; result: TranslationResponse }
  | { type: 'error'; code?: string; message: string };

export interface TranslationStreamHandlers {
  onStart?: (event: Extract<TranslationStreamEvent, { type: 'start' }>) => void;
  onDelta?: (text: string) => void;
  onReset?: (reason: string) => void;
  /** Called with the canonical final result; resolving value of the promise. */
  onFinal?: (result: TranslationResponse) => void;
  onError?: (error: { code?: string; message: string }) => void;
}

/**
 * All model calls go through the EdgeOne edge function at /api/translate.
 * The MiMo API key never reaches the frontend bundle.
 *
 * Streaming: POST returns an NDJSON stream (start/delta/reset/final/error).
 * translateStream() consumes it incrementally; the promise resolves with the
 * canonical final result or rejects on transport errors / error events.
 */
export async function translateStream(
  request: TranslationRequest,
  handlers: TranslationStreamHandlers,
  signal?: AbortSignal,
): Promise<TranslationResponse> {
  const response = await fetch(`${API_BASE_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('翻译连接中断，请重试。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: TranslationResponse | null = null;
  let lastError: { code?: string; message: string } | null = null;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: TranslationStreamEvent;
    try {
      event = JSON.parse(trimmed) as TranslationStreamEvent;
    } catch {
      // Malformed event line: skip it, the stream stays alive.
      return;
    }
    switch (event.type) {
      case 'start':
        handlers.onStart?.(event);
        break;
      case 'delta':
        if (typeof event.text === 'string' && event.text) handlers.onDelta?.(event.text);
        break;
      case 'reset':
        handlers.onReset?.(event.reason);
        break;
      case 'final':
        finalResult = event.result;
        handlers.onFinal?.(event.result);
        break;
      case 'error':
        lastError = { code: event.code, message: event.message };
        handlers.onError?.(lastError);
        break;
      default:
        break;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineAt: number;
    while ((newlineAt = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineAt);
      buffer = buffer.slice(newlineAt + 1);
      processLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer);

  if (finalResult) return finalResult;
  // lastError is assigned inside processLine; TS flow analysis cannot see it,
  // so re-type it explicitly before use.
  const streamError = lastError as { code?: string; message: string } | null;
  if (streamError) {
    const error = new Error(streamError.message) as Error & { code?: string };
    error.code = streamError.code;
    throw error;
  }
  // Stream ended without final or error event: the connection was cut.
  throw new Error('翻译连接中断，请重试。');
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/translate`, { method: 'OPTIONS' });
    return response.ok;
  } catch {
    return false;
  }
}
