import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeTranslationPrompt, normalizeTranslationMode, SUPPORTED_TRANSLATION_MODES } from '../functions/api/translate.js';

test('supports the six public translation modes', () => {
  assert.deepEqual([...SUPPORTED_TRANSLATION_MODES], ['auto', 'natural', 'literary', 'academic', 'business', 'comic']);
});

test('normalizes unknown modes to auto', () => {
  assert.equal(normalizeTranslationMode('gibberish'), 'auto');
  assert.equal(normalizeTranslationMode(undefined), 'auto');
  assert.equal(normalizeTranslationMode(42), 'auto');
});

test('combines base, selected style, context and terminology', () => {
  const { prompt, mode } = composeTranslationPrompt({
    mode: 'academic',
    context: '科技产品官网文案',
    terminology: 'MoDi Connect 不翻译',
  });

  assert.equal(mode, 'academic');
  assert.match(prompt, /共用翻译规则/);
  assert.match(prompt, /学术与技术模式/);
  assert.match(prompt, /科技产品官网文案/);
  assert.match(prompt, /MoDi Connect 不翻译/);
});

test('each explicit mode loads its own markdown prompt', () => {
  const natural = composeTranslationPrompt({ mode: 'natural' });
  const literary = composeTranslationPrompt({ mode: 'literary' });
  const business = composeTranslationPrompt({ mode: 'business' });
  const comic = composeTranslationPrompt({ mode: 'comic' });

  assert.match(natural.prompt, /自然模式/);
  assert.match(literary.prompt, /文学模式/);
  assert.match(business.prompt, /商务模式/);
  assert.match(comic.prompt, /漫画模式/);
});

test('auto uses dynamic classification instead of natural prompt', () => {
  const auto = composeTranslationPrompt({ mode: 'auto' });
  assert.match(auto.prompt, /自动模式/);
  assert.doesNotMatch(auto.prompt, /自然模式\n/);
  assert.equal(auto.mode, 'auto');
});

test('preserve names and explain translation toggles adjust instructions', () => {
  const withNotes = composeTranslationPrompt({ explainTranslation: true });
  const withoutNotes = composeTranslationPrompt({ explainTranslation: false });
  const withNames = composeTranslationPrompt({ preserveNames: true });

  assert.match(withNotes.prompt, /在 notes 中给出简短说明/);
  assert.match(withoutNotes.prompt, /notes 必须返回空数组/);
  assert.match(withNames.prompt, /保留符合语境的专有名词/);
});
