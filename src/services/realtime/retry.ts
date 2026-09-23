import { REALTIME_CONFIG } from './config';

export interface RetryNotice {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  rateLimited: boolean;
}

export interface RetryOptions {
  signal?: AbortSignal;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (notice: RetryNotice) => void;
}

export class RealtimeApiError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'RealtimeApiError';
    this.status = status;
    this.code = code;
  }
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted)
    || (error instanceof Error && error.name === 'AbortError');
}

function isRetryable(error: unknown): boolean {
  if (error instanceof RealtimeApiError) {
    return error.status === 408 || error.status === 429 || (error.status ?? 0) >= 500
      || error.code === 'ASR_STREAM_INTERRUPTED';
  }
  return error instanceof TypeError;
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withRealtimeRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? REALTIME_CONFIG.maxRetries;
  const baseDelayMs = options.baseDelayMs ?? REALTIME_CONFIG.retryBaseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? REALTIME_CONFIG.retryMaxDelayMs;
  const jitterRatio = options.jitterRatio ?? REALTIME_CONFIG.retryJitterRatio;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? abortableSleep;

  for (let attempt = 0; ; attempt += 1) {
    if (options.signal?.aborted) throw abortError(options.signal);
    try {
      return await operation(attempt);
    } catch (error) {
      if (isAbort(error, options.signal)) throw abortError(options.signal);
      if (attempt >= maxRetries || !isRetryable(error)) throw error;
      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
      const jitter = 1 + ((random() * 2) - 1) * jitterRatio;
      const delayMs = Math.max(0, Math.round(exponential * jitter));
      options.onRetry?.({ attempt: attempt + 1, maxRetries, delayMs, rateLimited: error instanceof RealtimeApiError && error.status === 429 });
      await sleep(delayMs, options.signal);
    }
  }
}
