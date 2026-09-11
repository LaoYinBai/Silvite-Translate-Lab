import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { translateDocument } = await vite.ssrLoadModule('/src/services/document/translateDocument.ts');

after(async () => vite.close());

function resultFor(text) {
  return { source_language: 'en', target_language: 'zh', translation: `[${text}]`, segments: [], notes: [] };
}

test('short documents use one request and return one canonical result', async () => {
  const calls = [];
  const result = await translateDocument({ text: 'Short document.', mode: 'natural' }, {
    targetChars: 100,
    translateChunk: async (request) => { calls.push(request.text); return resultFor(request.text); },
  });
  assert.deepEqual(calls, ['Short document.']);
  assert.equal(result.translation, '[Short document.]');
});

// The provider choice must reach every chunk request; a missing field would
// silently fall back to the default model for long documents only.
test('the selected model is forwarded to every chunk request', async () => {
  const models = [];
  const source = ['First paragraph. '.repeat(8), 'Second paragraph. '.repeat(8), 'Third paragraph. '.repeat(8)].join('\n\n');
  await translateDocument({ text: source, mode: 'natural', model: 'glm' }, {
    targetChars: 90,
    translateChunk: async (request) => { models.push(request.model); return resultFor(request.text); },
  });
  assert.ok(models.length > 1, 'the source must be split into several chunks');
  assert.ok(models.every((value) => value === 'glm'), `every chunk must carry the model, got ${models.join()}`);
});

test('long documents preserve chunk order and assemble without duplicated markers', async () => {
  const source = ['First paragraph. '.repeat(8), 'Second paragraph. '.repeat(8), 'Third paragraph. '.repeat(8)].join('\n\n');
  const calls = [];
  const result = await translateDocument({ text: source, mode: 'academic', context: 'paper' }, {
    targetChars: 90,
    translateChunk: async (request) => { calls.push(request.text); return resultFor(request.text); },
  });
  assert.ok(calls.length > 1);
  assert.equal(result.translation, calls.map((text) => `[${text}]`).join(''));
  assert.equal(new Set(calls).size, calls.length);
});

test('a failed chunk retries locally and completed chunks are not requested again', async () => {
  const source = 'One. '.repeat(20) + '\n\n' + 'Two. '.repeat(20);
  const attempts = new Map();
  const result = await translateDocument({ text: source }, {
    targetChars: 70,
    translateChunk: async (request) => {
      const count = (attempts.get(request.text) || 0) + 1;
      attempts.set(request.text, count);
      if (request.text.includes('Two') && count === 1) throw new Error('temporary');
      return resultFor(request.text);
    },
  });
  assert.ok(result.translation);
  assert.ok([...attempts.entries()].some(([text, count]) => text.includes('Two') && count === 2));
  assert.ok([...attempts.entries()].filter(([text]) => text.includes('One')).every(([, count]) => count === 1));
});

test('soft timeout splits only the current chunk and keeps earlier confirmed output', async () => {
  const source = 'Fast first paragraph.\n\n' + 'Slow sentence one. Slow sentence two. Slow sentence three.';
  const calls = [];
  const progress = [];
  const result = await translateDocument({ text: source }, {
    targetChars: 60,
    minChunkChars: 8,
    softTimeoutMs: 15,
    translateChunk: (request, _handlers, signal) => new Promise((resolve, reject) => {
      calls.push(request.text);
      if (request.text.length > 22 && request.text.includes('Slow')) {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      } else {
        resolve(resultFor(request.text));
      }
    }),
    onProgress: (event) => progress.push(event),
  });
  assert.ok(calls.some((text) => text.includes('Slow') && text.length > 22));
  assert.ok(calls.filter((text) => text.includes('Slow')).some((text) => text.length <= 22));
  assert.ok(result.translation.includes('[Fast first paragraph.\n\n]'));
  assert.ok(progress.some((event) => event.status === 'retrying-part'));
});

test('Markdown code blocks pass through unchanged', async () => {
  const source = 'Translate me.\n\n```js\nconst x = "原样";\n```\n\nTranslate too.';
  const requested = [];
  const result = await translateDocument({ text: source }, {
    targetChars: 30,
    translateChunk: async (request) => { requested.push(request.text); return resultFor(request.text); },
  });
  assert.ok(result.translation.includes('```js\nconst x = "原样";\n```'));
  assert.ok(requested.every((text) => !text.includes('const x')));
});

test('user abort stops the document without retrying', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = translateDocument({ text: 'Document to cancel.' }, {
    signal: controller.signal,
    translateChunk: (_request, _handlers, signal) => new Promise((_resolve, reject) => {
      calls++;
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  controller.abort(new DOMException('Aborted', 'AbortError'));
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
  assert.equal(calls, 1);
});
