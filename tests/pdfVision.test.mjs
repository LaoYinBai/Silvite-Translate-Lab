import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(async () => vite.close());

const { translatePdfAsImages, MAX_VISION_PAGES } = await vite.ssrLoadModule('/src/services/document/pdfVision.ts');

const scanFile = () => new File(['%PDF-1.4 scanned'], 'scan.pdf', { type: 'application/pdf' });

function sourceWith(pageCount, renderPage) {
  return {
    pageCount,
    renderPage: renderPage ?? (async (pageNumber) => `data:image/jpeg;base64,page-${pageNumber}`),
  };
}

function okResponse(translation) {
  return {
    source_language: 'en',
    target_language: 'zh',
    detected_style: 'natural',
    translation,
    detected_text: null,
    segments: [],
    notes: [],
  };
}

function pageNumberOf(request) {
  return request.imageDataUrl.split('-').pop();
}

test('pages are translated in order and joined with page breaks', async () => {
  const progress = [];
  const result = await translatePdfAsImages(
    { file: scanFile(), mode: 'natural' },
    {
      openSource: async () => sourceWith(3),
      translatePage: async (request, handlers) => {
        const page = pageNumberOf(request);
        handlers.onDelta(`译${page}`);
        return okResponse(`译${page}`);
      },
      onProgress: (entry) => progress.push(entry),
    },
  );

  assert.equal(result.translation, '译1\n\n译2\n\n译3');
  assert.equal(result.source_language, 'en');
  assert.equal(result.target_language, 'zh');
  assert.equal(progress.at(-1).percent, 100);
  assert.equal(progress.at(-1).status, 'assembling');
  assert.ok(progress.some((entry) => entry.provisionalText.includes('译1')), 'provisional text is streamed to the UI');
});

test('each page request says which page it is', async () => {
  const contexts = [];
  await translatePdfAsImages(
    { file: scanFile(), context: '产品手册' },
    {
      openSource: async () => sourceWith(2),
      translatePage: async (request) => {
        contexts.push(request.context);
        return okResponse('ok');
      },
    },
  );

  assert.match(contexts[1], /第 2 页（共 2 页）/);
  assert.match(contexts[1], /产品手册/);
});

test('a failing page is retried once and confirmed pages are kept', async () => {
  const attempts = new Map();
  const result = await translatePdfAsImages(
    { file: scanFile() },
    {
      openSource: async () => sourceWith(3),
      translatePage: async (request) => {
        const page = pageNumberOf(request);
        attempts.set(page, (attempts.get(page) || 0) + 1);
        if (page === '2' && attempts.get(page) === 1) throw new Error('模型返回为空');
        return okResponse(`译${page}`);
      },
    },
  );

  assert.equal(attempts.get('2'), 2, 'the failed page is retried');
  assert.equal(attempts.get('1'), 1, 'earlier pages are never requested twice');
  assert.equal(result.translation, '译1\n\n译2\n\n译3');
});

test('a page that keeps failing fails the run instead of returning a partial result', async () => {
  await assert.rejects(
    () => translatePdfAsImages(
      { file: scanFile() },
      {
        openSource: async () => sourceWith(2),
        translatePage: async () => { throw new Error('翻译服务暂时不可用'); },
      },
    ),
    /翻译服务暂时不可用/,
  );
});

test('the page limit blocks the run before any page is sent', async () => {
  let calls = 0;
  await assert.rejects(
    () => translatePdfAsImages(
      { file: scanFile() },
      {
        openSource: async () => sourceWith(MAX_VISION_PAGES + 1),
        translatePage: async () => { calls += 1; return okResponse('x'); },
      },
    ),
    (error) => /最多处理/.test(error.message),
  );
  assert.equal(calls, 0, 'an oversized scan must not spend any request');
});

test('aborting stops the run and does not retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    () => translatePdfAsImages(
      { file: scanFile() },
      {
        openSource: async () => sourceWith(5),
        translatePage: async () => {
          calls += 1;
          controller.abort();
          return okResponse('译1');
        },
        signal: controller.signal,
      },
    ),
    (error) => error.name === 'AbortError',
  );
  assert.equal(calls, 1);
});
