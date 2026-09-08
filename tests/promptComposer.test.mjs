import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeTranslationPrompt,
  normalizeTranslationMode,
  SUPPORTED_TRANSLATION_MODES,
} from '../api/promptComposer.ts';

test('supports the six public translation modes', () => {
  assert.deepEqual(SUPPORTED_TRANSLATION_MODES, [
    'auto',
    'natural',
    'literary',
    'academic',
    'business',
    'comic',
  ]);
});

test('normalizes unknown modes to auto', () => {
  assert.equal(normalizeTranslationMode('academic'), 'academic');
  assert.equal(normalizeTranslationMode('unexpected-mode'), 'auto');
  assert.equal(normalizeTranslationMode(undefined), 'auto');
});

test('combines base, selected style, context and terminology', () => {
  const result = composeTranslationPrompt({
    mode: 'academic',
    context: '计算机视觉论文摘要',
    terminology: 'foundation model = 基础模型',
    preserveNames: true,
    explainTranslation: false,
  });

  assert.equal(result.mode, 'academic');
  assert.equal(result.usedFallback, false);
  assert.match(result.prompt, /专业译者和翻译学习者/);
  assert.match(result.prompt, /学术与技术模式/);
  assert.match(result.prompt, /计算机视觉论文摘要/);
  assert.match(result.prompt, /foundation model = 基础模型/);
});

test('each explicit mode loads its own markdown prompt', () => {
  const expectedMarker = {
    natural: '自然模式',
    literary: '文学模式',
    academic: '学术与技术模式',
    business: '商务模式',
    comic: '漫画模式',
  };

  for (const [mode, marker] of Object.entries(expectedMarker)) {
    const result = composeTranslationPrompt({ mode });
    assert.equal(result.mode, mode);
    assert.equal(result.usedFallback, false);
    assert.match(result.prompt, new RegExp(marker));
  }
});

test('auto uses dynamic classification instead of natural prompt', () => {
  const result = composeTranslationPrompt({ mode: 'auto' });
  assert.equal(result.mode, 'auto');
  assert.match(result.prompt, /自动判断最合适的翻译策略/);
  assert.doesNotMatch(result.prompt, /# 自然模式/);
});

test('falls back to base plus auto when a style file cannot be read', () => {
  const errors = [];
  const result = composeTranslationPrompt(
    { mode: 'literary' },
    {
      readPrompt(fileName) {
        if (fileName === 'literary.md') throw new Error('missing file');
        if (fileName === 'base.md') return '# 共用规则\n专业译者和翻译学习者';
        throw new Error(`unexpected file: ${fileName}`);
      },
      onError(message) {
        errors.push(message);
      },
    },
  );

  assert.equal(result.mode, 'auto');
  assert.equal(result.usedFallback, true);
  assert.match(result.prompt, /专业译者和翻译学习者/);
  assert.match(result.prompt, /自动判断最合适的翻译策略/);
  assert.equal(errors.length, 1);
});
