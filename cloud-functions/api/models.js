import { resolveProvider, listProviders } from './providers.mjs';
import { corsHeaders, jsonResponse, checkRealtimeRateLimit } from './realtime/common.mjs';

// Query the configured gateway on the server; never return credentials or the
// unrestricted gateway catalog. Only the two configured translation models qualify.
export async function onRequest({ request, env = {} }) {
  const headers = {
    ...corsHeaders(env.ALLOWED_ORIGIN || request.headers.get('Origin') || '*'),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, headers);
  if (!checkRealtimeRateLimit(request, env, 'models')) {
    return jsonResponse({ error: 'RATE_LIMITED' }, 429, headers);
  }
  let provider;
  try { provider = resolveProvider('deepseek', env); }
  catch { return jsonResponse({ error: 'INVALID_PROVIDER_CONFIGURATION' }, 500, headers); }
  if (!provider.apiKey) return jsonResponse({ error: 'SERVICE_NOT_CONFIGURED' }, 500, headers);
  const url = new URL(provider.url);
  url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return jsonResponse({ error: 'MODELS_UPSTREAM_ERROR', upstreamStatus: response.status }, 502, headers);
    }
    const body = await response.json();
    if (!Array.isArray(body.data)) return jsonResponse({ error: 'INVALID_MODEL_CATALOG' }, 502, headers);
    const ids = [...new Set(body.data.map((item) => item?.id).filter((id) => typeof id === 'string'))];
    const models = listProviders().flatMap((candidate) => {
      const id = candidate.model;
      return ids.includes(id) ? [{ id, provider: candidate.id }] : [];
    });
    return jsonResponse({ models }, 200, headers);
  } catch {
    return jsonResponse({ error: 'MODELS_NETWORK_ERROR' }, 502, headers);
  } finally { clearTimeout(timer); }
}
