import { buildProviderRequest, resolveProvider } from './providers.mjs';
import { corsHeaders, jsonResponse } from './realtime/common.mjs';
import {
  MAX_ALIGNMENT_CHARACTERS,
  MAX_ALIGNMENT_REQUEST_BYTES,
  MAX_ALIGNMENT_RESPONSE_BYTES,
  buildAlignmentMessages,
  isWellFormedText,
  parseAlignmentProposal,
  validateAlignmentPairs,
} from './alignmentData.mjs';

const ALIGNMENT_TIMEOUT_MS = 75_000;
const MAX_UPSTREAM_BYTES = 192 * 1024;
const requestWindows = new Map();

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(number, maximum)) : fallback;
}

function checkAlignmentRateLimit(request, env) {
  const limit = boundedInteger(env.ALIGNMENT_RATE_LIMIT || env.RATE_LIMIT, 6, 1, 60);
  const windowMs = boundedInteger(env.ALIGNMENT_RATE_LIMIT_WINDOW_MS || env.RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000);
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || request.headers.get('eo-geo') || 'unknown';
  const now = Date.now();
  if (requestWindows.size >= 4096 && !requestWindows.has(ip)) {
    for (const [key, entry] of requestWindows) {
      if (now - entry.start >= windowMs) requestWindows.delete(key);
    }
    if (requestWindows.size >= 4096) return { allowed: false, windowMs };
  }
  let entry = requestWindows.get(ip);
  if (!entry || now - entry.start >= windowMs) {
    entry = { start: now, count: 0 };
    requestWindows.set(ip, entry);
  }
  if (entry.count >= limit) return { allowed: false, windowMs };
  entry.count++;
  return { allowed: true, windowMs };
}

async function readBoundedText(message, limit, signal) {
  const declaredLength = message.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > limit) {
    void message.body?.cancel().catch(() => undefined);
    throw new Error('BODY_TOO_LARGE');
  }
  if (!message.body) throw new Error('EMPTY_BODY');
  const reader = message.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    signal.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('BODY_TOO_LARGE');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

function validInput(input) {
  return input && typeof input.sourceText === 'string' && typeof input.targetText === 'string'
    && input.sourceText.trim() && input.targetText.trim()
    && input.sourceText.length + input.targetText.length <= MAX_ALIGNMENT_CHARACTERS
    && isWellFormedText(input.sourceText) && isWellFormedText(input.targetText)
    && ['zh', 'en'].includes(input.sourceLanguage) && ['zh', 'en'].includes(input.targetLanguage)
    && input.sourceLanguage !== input.targetLanguage
    && ['deepseek', 'glm'].includes(input.model);
}

export async function onRequest({ request, env = {} }) {
  const requestOrigin = request.headers.get('Origin');
  const origin = env.ALLOWED_ORIGIN || requestOrigin || '*';
  const headers = { ...corsHeaders(origin), 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*' && requestOrigin && requestOrigin !== env.ALLOWED_ORIGIN) {
    return jsonResponse({ error: 'ORIGIN_NOT_ALLOWED' }, 403, headers);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (request.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405, headers);
  if (env.SERVICE_ENABLED === 'false') return jsonResponse({ error: 'SERVICE_OFFLINE' }, 503, headers);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    return jsonResponse({ error: 'INVALID_CONTENT_TYPE' }, 415, headers);
  }
  const rate = checkAlignmentRateLimit(request, env);
  if (!rate.allowed) {
    return jsonResponse({ error: 'RATE_LIMITED' }, 429, { ...headers, 'Retry-After': String(Math.ceil(rate.windowMs / 1000)) });
  }

  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(request.signal.reason);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ALIGNMENT_TIMEOUT_MS);
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener('abort', abortFromRequest, { once: true });

  try {
    let input;
    try {
      input = JSON.parse(await readBoundedText(request, MAX_ALIGNMENT_REQUEST_BYTES, controller.signal));
    } catch (error) {
      if (controller.signal.aborted) throw error;
      return jsonResponse({ error: error?.message === 'BODY_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST' },
        error?.message === 'BODY_TOO_LARGE' ? 413 : 400, headers);
    }
    if (!validInput(input)) return jsonResponse({ error: 'INVALID_REQUEST' }, 400, headers);

    let provider;
    try { provider = resolveProvider(input.model, env); }
    catch { return jsonResponse({ error: 'SERVICE_NOT_CONFIGURED' }, 503, headers); }
    if (!provider.apiKey) return jsonResponse({ error: 'SERVICE_NOT_CONFIGURED' }, 503, headers);

    const upstream = buildProviderRequest(provider, {
      messages: buildAlignmentMessages(input),
      budget: Math.min(16_384, Math.max(2048, Math.ceil((input.sourceText.length + input.targetText.length) * 1.4) + 1024)),
      temperature: 0,
    });
    const response = await fetch(upstream.url, {
      method: 'POST',
      headers: upstream.headers,
      // Keep the provider helper's model, budget and disabled thinking. A single
      // bounded completion is sufficient; no speculative retries or streaming.
      body: JSON.stringify({ ...upstream.body, stream: false }),
      signal: controller.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      const rateLimited = response.status === 429;
      return jsonResponse({ error: rateLimited ? 'RATE_LIMITED' : 'ALIGNMENT_UPSTREAM_ERROR' }, rateLimited ? 429 : 502, headers);
    }
    let rows;
    try {
      const completion = JSON.parse(await readBoundedText(response, MAX_UPSTREAM_BYTES, controller.signal));
      const choice = completion?.choices?.[0];
      if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') {
        throw new Error('ALIGNMENT_INVALID_OUTPUT');
      }
      const proposal = parseAlignmentProposal(choice.message.content);
      rows = validateAlignmentPairs(proposal, input.sourceText, input.targetText);
    } catch (error) {
      if (controller.signal.aborted) throw error;
      return jsonResponse({ error: error?.message === 'ALIGNMENT_NOT_SEGMENTED' ? 'ALIGNMENT_NOT_SEGMENTED' : 'ALIGNMENT_INVALID_OUTPUT' }, 502, headers);
    }
    controller.signal.throwIfAborted();
    // No document strings, model prose, usage, reasoning or raw upstream fields
    // cross this boundary. All output fields are validated offsets or constants.
    const payload = JSON.stringify({ version: 1, method: 'ai', granularity: 'segment', rows });
    if (new TextEncoder().encode(payload).byteLength > MAX_ALIGNMENT_RESPONSE_BYTES) {
      return jsonResponse({ error: 'ALIGNMENT_INVALID_OUTPUT' }, 502, headers);
    }
    return new Response(payload, { status: 200, headers });
  } catch {
    return jsonResponse({ error: timedOut ? 'ALIGNMENT_TIMEOUT' : request.signal.aborted ? 'ALIGNMENT_CANCELLED' : 'ALIGNMENT_NETWORK_ERROR' },
      timedOut ? 504 : request.signal.aborted ? 499 : 502, headers);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abortFromRequest);
  }
}
