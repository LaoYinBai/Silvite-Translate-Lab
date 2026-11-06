import { createServer, type IncomingMessage } from 'node:http';
import { onRequest } from '../cloud-functions/api/translate.js';
import { onRequest as onAlignment } from '../cloud-functions/api/alignment.js';
import { MAX_ALIGNMENT_REQUEST_BYTES } from '../cloud-functions/api/alignmentData.mjs';
import { onRequest as onRealtimeTranscribe } from '../cloud-functions/api/realtime/transcribe.js';
import { onRequest as onRealtimeTranslate } from '../cloud-functions/api/realtime/translate.js';
import { onRequest as onModels } from '../cloud-functions/api/models.js';

const PORT = 3001;

function readBody(req: IncomingMessage, maxBytes = Infinity): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        chunks.length = 0;
        req.pause();
        reject(new Error('LOCAL_BODY_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('aborted', () => reject(new Error('LOCAL_REQUEST_ABORTED')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const isAlignment = url.pathname === '/api/alignment';
  const alignmentController = new AbortController();
  const abortAlignment = () => {
    if (!res.writableEnded) alignmentController.abort();
  };
  const bodyTimer = isAlignment ? setTimeout(() => {
    alignmentController.abort();
    req.destroy(new Error('Alignment request timeout'));
  }, 75_000) : undefined;
  if (isAlignment) {
    req.once('aborted', abortAlignment);
    res.once('close', abortAlignment);
  }

  try {
    const bodyBuffer = req.method === 'POST' || req.method === 'PUT'
      ? await readBody(req, isAlignment ? MAX_ALIGNMENT_REQUEST_BYTES : Infinity)
      : undefined;
    clearTimeout(bodyTimer);
    const requestHeaders = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach(item => requestHeaders.append(name, item));
      else if (value !== undefined) requestHeaders.set(name, value);
    }
    const request = new Request(url, {
      method: req.method,
      headers: requestHeaders,
      body: bodyBuffer ? new Uint8Array(bodyBuffer).buffer : undefined,
      signal: isAlignment ? alignmentController.signal : undefined,
    });
    const context = {
      request,
      params: {},
      env: {
        MIMO_API_KEY: process.env.MIMO_API_KEY,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
        DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
        DEEPSEEK_MAX_COMPLETION_TOKENS: process.env.DEEPSEEK_MAX_COMPLETION_TOKENS,
        DEEPSEEK_BUDGET_PARAM: process.env.DEEPSEEK_BUDGET_PARAM,
        SERVICE_ENABLED: process.env.SERVICE_ENABLED,
        RATE_LIMIT: process.env.RATE_LIMIT,
        RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
        ALIGNMENT_RATE_LIMIT: process.env.ALIGNMENT_RATE_LIMIT,
        ALIGNMENT_RATE_LIMIT_WINDOW_MS: process.env.ALIGNMENT_RATE_LIMIT_WINDOW_MS,
        MAX_INPUT_LENGTH: process.env.MAX_INPUT_LENGTH,
        MAX_COMPLETION_TOKENS: process.env.MAX_COMPLETION_TOKENS,
        ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
        REALTIME_ASR_RATE_LIMIT: process.env.REALTIME_ASR_RATE_LIMIT,
        REALTIME_TRANSLATE_RATE_LIMIT: process.env.REALTIME_TRANSLATE_RATE_LIMIT,
        REALTIME_RATE_LIMIT_WINDOW_MS: process.env.REALTIME_RATE_LIMIT_WINDOW_MS,
      },
    };
    const handler = url.pathname === '/api/realtime/transcribe'
      ? onRealtimeTranscribe
      : url.pathname === '/api/realtime/translate'
        ? onRealtimeTranslate
        : isAlignment
          ? onAlignment
          : url.pathname === '/api/models'
            ? onModels
            : onRequest;
    const response = await handler(context);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (isAlignment) {
      if (res.destroyed || alignmentController.signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        return;
      }
      // Alignment is bounded JSON. Avoid waiting for an SSE drain event on a
      // connection the browser closed while cancelling a background request.
      const payload = await response.arrayBuffer();
      if (!res.destroyed && !alignmentController.signal.aborted) {
        res.writeHead(response.status, responseHeaders);
        res.end(new Uint8Array(payload));
      }
      return;
    }

    // Stream the body incrementally (SSE streaming must reach the browser
    // chunk by chunk, not as one buffered blob).
    res.writeHead(response.status, responseHeaders);
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!res.write(value)) {
          await new Promise<void>((resolve) => res.once('drain', resolve));
        }
      }
    }
    res.end();
  } catch (error) {
    if (!isAlignment) console.error('[local-api] Unhandled error:', error);
    if (!res.writableEnded && !res.destroyed) {
      const oversized = isAlignment && error instanceof Error && error.message === 'LOCAL_BODY_TOO_LARGE';
      res.writeHead(oversized ? 413 : 500, {
        'Content-Type': 'application/json; charset=utf-8',
        ...(isAlignment ? { 'Cache-Control': 'no-store', Connection: 'close' } : {}),
      });
      res.end(JSON.stringify({ error: oversized ? 'REQUEST_TOO_LARGE' : 'Internal server error' }));
    }
  } finally {
    clearTimeout(bodyTimer);
    req.removeListener('aborted', abortAlignment);
    res.removeListener('close', abortAlignment);
  }
});

server.listen(PORT, () => {
  console.log(`[local-api] Listening on http://localhost:${PORT}`);
});
