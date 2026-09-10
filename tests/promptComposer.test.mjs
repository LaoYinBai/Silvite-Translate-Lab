import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeTranslationPrompt,
  normalizeTranslationMode,
  buildTerminologySection,
  SUPPORTED_TRANSLATION_MODES,
} from '../cloud-functions/api/translate.js';

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

test('buildTerminologySection parses fixed mapping, keep-as-is and free text', () => {
  const section = buildTerminologySection(
    '沈理 -> Shenyang Ligong University\n墨堤 = MoDi Connect\nSilvite Translate Lab -> 保持原样\nMoDi Connect -> KEEP\n品牌统一叫官方名'
  );

  assert.match(section, /沈理 → Shenyang Ligong University/);
  assert.match(section, /墨堤 → MoDi Connect/);
  assert.match(section, /保持原文/);
  assert.match(section, /Silvite Translate Lab/);
  assert.match(section, /MoDi Connect/);
  assert.match(section, /品牌统一叫官方名/);
});

test('terminology returns null for empty input', () => {
  assert.equal(buildTerminologySection(''), null);
  assert.equal(buildTerminologySection(undefined), null);
  assert.equal(buildTerminologySection('   \n  '), null);
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
  assert.match(auto.prompt, /不要默认使用自然翻译/);
  assert.doesNotMatch(auto.prompt, /# 自然模式/);
  assert.equal(auto.mode, 'auto');
});

test('preserveNames true and false produce different instructions', () => {
  const on = composeTranslationPrompt({ preserveNames: true });
  const off = composeTranslationPrompt({ preserveNames: false });

  assert.match(on.prompt, /Preserve Proper Names：开启/);
  assert.match(off.prompt, /Preserve Proper Names：关闭/);
  assert.match(off.prompt, /Terminology 约束不受此设置影响/);
});

test('explainTranslation=false reduces notes, default keeps normal generation', () => {
  const withNotes = composeTranslationPrompt({ explainTranslation: true });
  const withoutNotes = composeTranslationPrompt({ explainTranslation: false });
  const omitted = composeTranslationPrompt({});

  assert.doesNotMatch(withNotes.prompt, /notes 尽量返回空数组/);
  assert.match(withoutNotes.prompt, /notes 尽量返回空数组/);
  assert.doesNotMatch(omitted.prompt, /notes 尽量返回空数组/);
});

test('prompt declares rule priority with terminology on top', () => {
  const { prompt } = composeTranslationPrompt({ mode: 'auto' });
  assert.match(prompt, /规则优先级/);
  assert.match(prompt, /最高，硬约束/);
  assert.match(prompt, /不得擅自强化或弱化/);
  assert.match(prompt, /语境级判断/);
  assert.match(prompt, /不要编造看似正式的译名|不要自行创造/);
});
