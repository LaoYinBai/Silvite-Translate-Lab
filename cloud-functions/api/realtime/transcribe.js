import {
  checkRealtimeRateLimit,
  corsHeaders,
  jsonResponse,
  readJsonBody,
} from './common.mjs';

const MIMO_CHAT_COMPLETIONS_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const ASR_MODEL = 'mimo-v2.5-asr';
const MAX_AUDIO_DATA_URL_CHARS = 450_000;
const ALLOWED_LANGUAGES = new Set(['auto', 'zh', 'en']);

function decodeWavDataUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_AUDIO_DATA_URL_CHARS) return null;
  const match = /^data:audio\/wav;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;
  const audio = Buffer.from(match[1], 'base64');
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return null;
  if (audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1) return null;
  if (audio.readUInt32LE(24) !== 16000 || audio.readUInt16LE(34) !== 16) return null;
  if (audio.length <= 44 || (audio.length - 44) % 2 !== 0) return null;
  return audio;
}

function upstreamError(status) {
  if (status === 429) return { status: 429, code: 'RATE_LIMITED', message: '语音识别请求较多，请稍候重试。' };
  return { status: 502, code: 'ASR_UPSTREAM_ERROR', message: '语音识别暂时不可用，请检查网络后重试。' };
}

function contentFromChunk(payload) {
  const content = payload?.choices?.[0]?.delta?.content ?? payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('');
  return '';
}

function startSseRelay(upstreamBody, sequence, controller) {
  const { signal } = controller;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let transcript = '';
      let revision = 0;
      let sawDone = false;

      const processLine = (line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trimStart();
        if (data === '[DONE]') {
          sawDone = true;
          return;
        }
        let payload;
        try { payload = JSON.parse(data); } catch { return; }
        const delta = contentFromChunk(payload);
        if (delta) {
          transcript += delta;
          revision += 1;
          emit({ type: 'partial', sequence, revision, text: transcript });
        }
        const finishReason = payload?.choices?.[0]?.finish_reason;
        if (finishReason === 'stop') sawDone = true;
      };

      try {
        for (;;) {
          if (signal.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            processLine(buffer.slice(0, newline).replace(/\r$/, ''));
            buffer = buffer.slice(newline + 1);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) processLine(buffer.trim());
        if (!transcript.trim()) {
          emit({ type: 'error', sequence, code: 'ASR_EMPTY', message: '没有识别到清晰语音，请继续说话或检查麦克风。' });
        } else if (sawDone) {
          emit({ type: 'final', sequence, revision: revision + 1, text: transcript.trim() });
        } else {
          emit({ type: 'error', sequence, code: 'ASR_STREAM_INTERRUPTED', message: '语音识别连接中断，请重试。' });
        }
        controller.close();
      } catch (error) {
        if (!signal.aborted) {
          emit({ type: 'error', sequence, code: 'ASR_STREAM_INTERRUPTED', message: '语音识别连接中断，请重试。' });
          controller.close();
        } else {
          controller.error(error);
        }
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      controller.abort(reason);
      upstreamBody.cancel(reason).catch(() => undefined);
    },
  });
  return stream;
}

export async function onRequest(context) {
  const { request, env = {} } = context;
  const headers = corsHeaders(env.ALLOWED_ORIGIN || request.headers.get('Origin') || '*');
  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, headers);
  if (!checkRealtimeRateLimit(request, env, 'asr')) {
    return jsonResponse({ error: 'RATE_LIMITED', message: '语音识别请求较多，请稍候重试。' }, 429, headers);
  }

  const payload = await readJsonBody(request);
  if (!payload || !decodeWavDataUrl(payload.audioDataUrl)) {
    return jsonResponse({ error: 'INVALID_WAV', message: '音频格式无效，请重新开始语音翻译。' }, 400, headers);
  }
  const language = ALLOWED_LANGUAGES.has(payload.language) ? payload.language : null;
  if (!language || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1) {
    return jsonResponse({ error: 'INVALID_REQUEST', message: '语音识别参数无效。' }, 400, headers);
  }
  if (!env.MIMO_API_KEY) {
    console.error('Realtime ASR is not configured: missing MIMO_API_KEY');
    return jsonResponse({ error: 'SERVICE_NOT_CONFIGURED', message: '语音翻译服务尚未配置。' }, 500, headers);
  }

  const upstreamController = new AbortController();
  const abortUpstream = () => upstreamController.abort(request.signal.reason);
  if (request.signal.aborted) abortUpstream();
  else request.signal.addEventListener('abort', abortUpstream, { once: true });

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(MIMO_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MIMO_API_KEY}`,
      },
      body: JSON.stringify({
        model: ASR_MODEL,
        messages: [{
          role: 'user',
          content: [{
            type: 'input_audio',
            input_audio: { data: payload.audioDataUrl, format: 'wav' },
          }],
        }],
        asr_options: { language },
        stream: true,
      }),
      signal: upstreamController.signal,
    });
  } catch {
    return jsonResponse({ error: 'ASR_NETWORK_ERROR', message: '无法连接语音识别服务，请检查网络后重试。' }, 502, headers);
  }

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    const failure = upstreamError(upstreamResponse.status);
    if (failure.status !== 429) console.error('Realtime ASR upstream returned status:', upstreamResponse.status);
    return jsonResponse({ error: failure.code, message: failure.message }, failure.status, headers);
  }

  const streamHeaders = {
    ...headers,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  };
  return new Response(startSseRelay(upstreamResponse.body, payload.sequence, upstreamController), {
    status: 200,
    headers: streamHeaders,
  });
}
