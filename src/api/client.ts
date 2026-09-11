export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// Wire value for the upstream provider. The server maps each id to an endpoint,
// credentials and request shape; unknown ids fall back to the default server
// side. Kept as the extension seam for a future selector.
export type TranslationModelId = 'mimo' | 'glm';

export interface TranslationRequest {
  text?: string;
  imageDataUrl?: string;
  mode?: string;
  context?: string;
  terminology?: string;
  preserveNames?: boolean;
  explainTranslation?: boolean;
  model?: TranslationModelId;
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

// Application-layer events framed as SSE data messages.
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

class TranslationServiceError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'TranslationServiceError';
    this.code = code;
  }
}

/**
 * All model calls go through the EdgeOne Cloud Function at /api/translate.
 * The MiMo API key never reaches the frontend bundle.
 *
 * Streaming: POST returns a custom SSE stream (start/delta/reset/final/error).
 * translateStream() consumes it incrementally; the promise resolves with the
 * canonical final result or rejects on transport errors / error events.
 */
async function translateStreamOnce(
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
    throw new TranslationServiceError(error.error || `HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('翻译连接中断，请重试。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // SSE framing: events are "data: <JSON>" lines terminated by a blank line.
  // The buffer is split into lines; a complete event is dispatched when the
  // blank-line terminator arrives.
  let buffer = '';
  let dataLine = '';
  let dataSeen = false;
  let finalResult: TranslationResponse | null = null;
  let lastError: { code?: string; message: string } | null = null;

  const dispatchEvent = (payload: string) => {
    let event: TranslationStreamEvent;
    try {
      event = JSON.parse(payload) as TranslationStreamEvent;
    } catch {
      // Malformed event payload: skip it, the stream stays alive.
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

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line) {
      // Blank line terminates the current event (handles \n\n and \r\n\r\n).
      if (dataSeen) dispatchEvent(dataLine);
      dataLine = '';
      dataSeen = false;
      return;
    }
    if (line.startsWith('data:')) {
      const value = line.slice(5);
      dataLine += (dataSeen ? '\n' : '') + value.trimStart();
      dataSeen = true;
    }
    // Non-data lines (comments, unknown fields) are ignored.
  };

  const consumeBuffer = (chunk: string) => {
    buffer += chunk;
    let newlineAt: number;
    while ((newlineAt = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineAt);
      buffer = buffer.slice(newlineAt + 1);
      processLine(line);
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    consumeBuffer(decoder.decode(value, { stream: true }));
    if (finalResult) {
      await reader.cancel().catch(() => undefined);
      return finalResult;
    }
  }
  consumeBuffer(decoder.decode());
  // Flush a trailing event that lacks its final blank line.
  if (dataSeen) dispatchEvent(dataLine);

  if (finalResult) return finalResult;
  // lastError is assigned inside processLine; TS flow analysis cannot see it,
  // so re-type it explicitly before use.
  const streamError = lastError as { code?: string; message: string } | null;
  if (streamError) {
    throw new TranslationServiceError(streamError.message, streamError.code);
  }
  // Stream ended without final or error event: the connection was cut.
  throw new Error('翻译连接中断，请重试。');
}

export async function translateStream(
  request: TranslationRequest,
  handlers: TranslationStreamHandlers,
  signal?: AbortSignal,
): Promise<TranslationResponse> {
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await translateStreamOnce(request, handlers, signal);
    } catch (error) {
      const canRetry = attempt < maxAttempts - 1
        && !signal?.aborted
        && !(error instanceof TranslationServiceError);
      if (!canRetry) throw error;
      handlers.onReset?.('transport_interrupted');
    }
  }

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
