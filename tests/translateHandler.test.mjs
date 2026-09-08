import assert from 'node:assert/strict';
import test from 'node:test';

process.env.MIMO_API_KEY = 'test-key';

const capturedRequests = [];
globalThis.fetch = async (_url, init) => {
  capturedRequests.push(JSON.parse(init.body));
  return {
    ok: true,
    async json() {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              source_language: 'zh',
              target_language: 'en',
              detected_style: 'academic',
              translation: 'Translated',
              segments: [],
              notes: [],
            }),
          },
        }],
      };
    },
  };
};

const { default: handler } = await import('../api/translate.ts');

function invoke(body, ip) {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', headers: { 'x-forwarded-for': ip }, body };
    const res = {
      code: 200,
      setHeader() {},
      status(code) { this.code = code; return this; },
      json(payload) { resolve({ status: this.code, payload }); return this; },
      end() { resolve({ status: this.code }); return this; },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('academic mode reaches MiMo with academic markdown, context and terminology', async () => {
  capturedRequests.length = 0;
  const response = await invoke({
    text: '测试内容',
    mode: 'academic',
    context: '论文摘要',
    terminology: 'agent = 智能体',
  }, 'test-academic');

  assert.equal(response.status, 200);
  const prompt = capturedRequests[0].messages[0].content;
  assert.match(prompt, /# 学术与技术模式/);
  assert.match(prompt, /论文摘要/);
  assert.match(prompt, /agent = 智能体/);
});

test('unknown mode falls back to dynamic auto prompt', async () => {
  capturedRequests.length = 0;
  await invoke({ text: '测试内容', mode: 'unknown' }, 'test-unknown');
  const prompt = capturedRequests[0].messages[0].content;
  assert.match(prompt, /# 自动模式/);
  assert.match(prompt, /自动判断最合适的翻译策略/);
});

test('comic image request combines comic prompt with visual input', async () => {
  capturedRequests.length = 0;
  await invoke({
    imageDataUrl: 'data:image/png;base64,AAAA',
    mode: 'comic',
  }, 'test-comic');

  const request = capturedRequests[0];
  assert.match(request.messages[0].content, /# 漫画模式/);
  assert.equal(Array.isArray(request.messages[1].content), true);
  assert.equal(request.messages[1].content[0].type, 'image_url');
  assert.match(request.messages[1].content[1].text, /视觉上下文|画格|阅读顺序/);
});
