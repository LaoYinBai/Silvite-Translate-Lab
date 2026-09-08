import { createServer } from 'node:http';
import handler from '../api/translate.ts';

const PORT = 3001;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const wrappedReq = Object.assign(req, { body });
  const wrappedRes = {
    headers: {},
    statusCode: 200,
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
      res.setHeader(name, value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = JSON.stringify(payload);
      res.writeHead(this.statusCode, { 'Content-Type': 'application/json', ...this.headers });
      res.end(this.body);
    },
    end(payload) {
      if (payload) this.body = payload;
      res.writeHead(this.statusCode, this.headers);
      res.end(this.body);
    },
  };

  try {
    await handler(wrappedReq, wrappedRes);
  } catch (error) {
    console.error('[local-api] Unhandled error:', error);
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`[local-api] Listening on http://localhost:${PORT}`);
});
