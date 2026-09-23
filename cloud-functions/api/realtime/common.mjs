const requestWindows = new Map();

export const MIMO_CHAT_COMPLETIONS_URL = 'https://api.xiaomimimo.com/v1/chat/completions';

export function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export function jsonResponse(payload, status, headers) {
  return new Response(JSON.stringify(payload), { status, headers });
}

export function checkRealtimeRateLimit(request, env, kind) {
  const variable = kind === 'asr' ? 'REALTIME_ASR_RATE_LIMIT' : 'REALTIME_TRANSLATE_RATE_LIMIT';
  const defaultLimit = kind === 'asr' ? 90 : 60;
  const configuredLimit = Number.parseInt(env[variable] || String(defaultLimit), 10);
  const configuredWindow = Number.parseInt(env.REALTIME_RATE_LIMIT_WINDOW_MS || '60000', 10);
  const limit = Number.isFinite(configuredLimit) ? Math.max(1, Math.min(configuredLimit, 10_000)) : defaultLimit;
  const windowMs = Number.isFinite(configuredWindow) ? Math.max(1_000, Math.min(configuredWindow, 3_600_000)) : 60_000;
  const forwardedFor = request.headers.get('x-forwarded-for') || '';
  const ip = forwardedFor.split(',')[0].trim() || request.headers.get('eo-geo') || 'unknown';
  const key = `${kind}:${ip}`;
  const now = Date.now();
  if (requestWindows.size >= 4_096 && !requestWindows.has(key)) {
    for (const [entryKey, timestamps] of requestWindows) {
      if (!timestamps.length || now - timestamps[timestamps.length - 1] >= windowMs) requestWindows.delete(entryKey);
      if (requestWindows.size < 4_096) break;
    }
    if (requestWindows.size >= 4_096) requestWindows.delete(requestWindows.keys().next().value);
  }
  const recent = (requestWindows.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= Math.max(1, limit)) {
    requestWindows.set(key, recent);
    return false;
  }
  recent.push(now);
  requestWindows.set(key, recent);
  return true;
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}
