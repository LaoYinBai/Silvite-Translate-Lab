import { createServer } from 'node:http';
import { onRequest } from '../cloud-functions/api/translate.js';

const PORT = 3001;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const bodyBuffer = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : undefined;
  const url = new URL(req.url, `http://localhost:${PORT}`);

  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: bodyBuffer,
  });

  const context = {
    request,
    params: {},
    env: {
      MIMO_API_KEY: process.env.MIMO_API_KEY,
      SERVICE_ENABLED: process.env.SERVICE_ENABLED,
      RATE_LIMIT: process.env.RATE_LIMIT,
      RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
      MAX_INPUT_LENGTH: process.env.MAX_INPUT_LENGTH,
      MAX_COMPLETION_TOKENS: process.env.MAX_COMPLETION_TOKENS,
      ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
    },
  };

  try {
    const response = await onRequest(context);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

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
    console.error('[local-api] Unhandled error:', error);
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`[local-api] Listening on http://localhost:${PORT}`);
});
