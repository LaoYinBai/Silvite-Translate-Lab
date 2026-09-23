import {
  buildRealtimeTranslationMessages,
} from './prompts.mjs';
import {
  checkRealtimeRateLimit,
  corsHeaders,
  jsonResponse,
  readJsonBody,
} from './common.mjs';

const MIMO_CHAT_COMPLETIONS_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const TRANSLATION_MODEL = 'mimo-v2.6-flash';
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
    || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1
    || !Number.isSafeInteger(payload.revision) || payload.revision < 1) {
    return jsonResponse({ error: 'INVALID_REQUEST', message: '实时翻译内容或参数无效。' }, 400, headers);
  }
  if (!env.MIMO_API_KEY) {
    console.error('Realtime translation is not configured: missing MIMO_API_KEY');
    return jsonResponse({ error: 'SERVICE_NOT_CONFIGURED', message: '实时翻译服务尚未配置。' }, 500, headers);
  }

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

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(MIMO_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MIMO_API_KEY}`,
      },
      body: JSON.stringify({
        model: TRANSLATION_MODEL,
        messages,
        max_completion_tokens: 1024,
        temperature: 0.2,
        thinking: { type: 'disabled' },
        stream: false,
      }),
      signal: request.signal,
    });
  } catch {
    return jsonResponse({ error: 'TRANSLATION_NETWORK_ERROR', message: '无法连接实时翻译服务，请检查网络后重试。' }, 502, headers);
  }

  if (!upstreamResponse.ok) {
    const rateLimited = upstreamResponse.status === 429;
    if (!rateLimited) console.error('Realtime translation upstream returned status:', upstreamResponse.status);
    return jsonResponse({
      error: rateLimited ? 'RATE_LIMITED' : 'TRANSLATION_UPSTREAM_ERROR',
      message: rateLimited ? '实时翻译请求较多，请稍候重试。' : '实时翻译暂时不可用，请重试。',
    }, rateLimited ? 429 : 502, headers);
  }

  let upstreamPayload;
  try {
    upstreamPayload = await upstreamResponse.json();
  } catch {
    return jsonResponse({ error: 'INVALID_UPSTREAM_RESPONSE', message: '实时翻译返回格式异常，请重试。' }, 502, headers);
  }
  const content = upstreamPayload?.choices?.[0]?.message?.content;
  const translation = typeof content === 'string'
    ? content.trim()
    : Array.isArray(content)
      ? content.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim()
      : '';
  if (!translation || looksLikeStructuredProtocol(translation)) {
    return jsonResponse({ error: 'INVALID_TRANSLATION', message: '实时翻译结果为空或格式异常，请重试。' }, 502, headers);
  }

  return jsonResponse({
    sequence: payload.sequence,
    revision: payload.revision,
    stage: payload.stage,
    translation,
  }, 200, headers);
}
