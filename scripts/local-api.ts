import { createServer } from 'node:http';
import { onRequest } from '../functions/api/translate.js';

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
      ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
    },
  };

  try {
    const response = await onRequest(context);
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const responseBody = response.body ? Buffer.from(await response.arrayBuffer()) : undefined;
    res.writeHead(response.status, responseHeaders);
    res.end(responseBody);
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
