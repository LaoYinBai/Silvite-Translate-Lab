import {
  buildRealtimeTranslationMessages,
} from './prompts.mjs';
import {
  checkRealtimeRateLimit,
  corsHeaders,
  jsonResponse,
  readJsonBody,
} from './common.mjs';
import { relayTranslation } from './translationStream.mjs';
import { buildProviderRequest, resolveProvider } from '../providers.mjs';

const LANGUAGES = new Set(['zh', 'en']);
const STAGES = new Set(['provisional', 'confirmed']);

function normalizeRecentContext(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).map((segment) => ({
    source: String(segment?.source || '').slice(-300),
    translation: String(segment?.translation || '').slice(-300),
    source_language: LANGUAGES.has(segment?.source_language) ? segment.source_language : 'auto',
    target_language: LANGUAGES.has(segment?.target_language) ? segment.target_language : 'auto',
  }));
}

function looksLikeStructuredProtocol(value) {
  const text = String(value || '').trim();
  if (/^```(?:json)?(?:\s|$)/i.test(text) || /^(?:\{|\[)/.test(text)) return true;
  return /(?:^|\n)[^\n]{0,160}\{\s*"(?:translation|source_language|target_language|detected_text|segments|notes|detected_style)"\s*:/i.test(text)
    || /"(?:translation|source_language|target_language|segments|notes)"\s*:\s*(?:"|\[|\{)/i.test(text);
}

export async function onRequest(context) {
  const { request, env = {} } = context;
  const headers = corsHeaders(env.ALLOWED_ORIGIN || request.headers.get('Origin') || '*');
  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, headers);
  if (!checkRealtimeRateLimit(request, env, 'translate')) {
    return jsonResponse({ error: 'RATE_LIMITED', message: '实时翻译请求较多，请稍候重试。' }, 429, headers);
  }

  const payload = await readJsonBody(request);
  if (!payload || typeof payload.sourceText !== 'string' || !payload.sourceText.trim()
    || payload.sourceText.length > 1800
    || !LANGUAGES.has(payload.sourceLanguage)
    || !LANGUAGES.has(payload.targetLanguage)
    || !STAGES.has(payload.stage)
    || payload.utteranceId !== undefined && (typeof payload.utteranceId !== 'string' || !payload.utteranceId || payload.utteranceId.length > 128)
    || payload.requestId !== undefined && (typeof payload.requestId !== 'string' || !payload.requestId || payload.requestId.length > 160)
    || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1
    || !Number.isSafeInteger(payload.revision) || payload.revision < 1) {
    return jsonResponse({ error: 'INVALID_REQUEST', message: '实时翻译内容或参数无效。' }, 400, headers);
  }
  let provider;
  try {
    provider = resolveProvider(payload.model, env);
  } catch {
    return jsonResponse({ error: 'SERVICE_NOT_CONFIGURED', message: '翻译服务请求地址或参数配置无效。' }, 500, headers);
  }
  if (!provider.apiKey) {
    console.error(`Realtime translation: missing ${provider.apiKeyEnv}`);
    return jsonResponse({ error: 'SERVICE_NOT_CONFIGURED', message: `${provider.label} 翻译服务尚未配置。` }, 500, headers);
  }
  headers['X-Translation-Provider'] = provider.id;
  headers['X-Translation-Model'] = provider.model;

  const messages = buildRealtimeTranslationMessages({
    sourceText: payload.sourceText,
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    confirmedContext: normalizeRecentContext(payload.confirmedContext),
    sessionSummary: typeof payload.sessionSummary === 'string' ? payload.sessionSummary.slice(0, 900) : '',
    context: typeof payload.context === 'string' ? payload.context.slice(0, 1500) : '',
    terminology: typeof payload.terminology === 'string' ? payload.terminology.slice(0, 3000) : '',
    preserveNames: payload.preserveNames !== false,
    stage: payload.stage,
  });
  const upstream = buildProviderRequest(provider, { messages, budget: 1024, temperature: 0.2 });

  let upstreamResponse;
  const upstreamController = new AbortController();
  const requestSignal = request.signal;
  const abortUpstream = () => upstreamController.abort(requestSignal?.reason);
  const timer = setTimeout(() => upstreamController.abort(new Error('Translation timeout')), 28_000);
  const cleanup = () => { clearTimeout(timer); requestSignal?.removeEventListener('abort', abortUpstream); };
  if (requestSignal?.aborted) abortUpstream();
  else requestSignal?.addEventListener('abort', abortUpstream, { once: true });
  try {
    upstreamResponse = await fetch(upstream.url, {
      method: 'POST',
      headers: upstream.headers,
      body: JSON.stringify(upstream.body),
      signal: upstreamController.signal,
    });
  } catch {
    cleanup();
    return jsonResponse({ error: 'TRANSLATION_NETWORK_ERROR', message: '无法连接实时翻译服务，请检查网络后重试。' }, 502, headers);
  }

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    cleanup();
    void upstreamResponse.body?.cancel().catch(() => undefined);
    const rateLimited = upstreamResponse.status === 429;
    if (!rateLimited) console.error('Realtime translation upstream returned status:', upstreamResponse.status);
    return jsonResponse({
      error: rateLimited ? 'RATE_LIMITED' : 'TRANSLATION_UPSTREAM_ERROR',
      message: rateLimited ? '实时翻译请求较多，请稍候重试。' : '实时翻译暂时不可用，请重试。',
    }, rateLimited ? 429 : 502, headers);
  }

  const streamHeaders = { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' };
  const identity = { sequence: payload.sequence, revision: payload.revision, stage: payload.stage,
    utteranceId: payload.utteranceId || `realtime-${payload.sequence}`,
    requestId: payload.requestId || `legacy-${payload.sequence}-${payload.revision}` };
  const body = relayTranslation(upstreamResponse.body, identity, upstreamController, cleanup, looksLikeStructuredProtocol);
  return new Response(body, { status: 200, headers: streamHeaders });
}
