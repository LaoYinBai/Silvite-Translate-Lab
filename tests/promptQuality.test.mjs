import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeTranslationPrompt } from '../cloud-functions/api/translate.js';
import { BUSINESS_PROMPT, QUALITY_CORE_PROMPT } from '../cloud-functions/api/prompts.mjs';

// The quality core is one compact block shared by every route/mode instead of a
// long list of loose rules, so it must reach all of them.

test('the quality core reaches every route and mode', () => {
  for (const mode of ['auto', 'natural', 'literary', 'academic', 'business', 'comic']) {
    const { prompt } = composeTranslationPrompt({ mode });
    assert.ok(prompt.includes(QUALITY_CORE_PROMPT), `${mode} is missing the quality core`);
  }
});

test('the quality core pins epistemic status and responsibility boundaries', () => {
  assert.match(QUALITY_CORE_PROMPT, /epistemic status/i);
  assert.match(QUALITY_CORE_PROMPT, /uncertainty must remain uncertainty/i);
  assert.match(QUALITY_CORE_PROMPT, /absence of evidence must not become evidence of absence/i);
  assert.match(QUALITY_CORE_PROMPT, /technical acknowledgment must not be interpreted as business completion/i);
  assert.match(QUALITY_CORE_PROMPT, /Never expand, reduce, infer, or redistribute/i);
  assert.match(QUALITY_CORE_PROMPT, /Preserve the ambiguity/i);
  assert.match(QUALITY_CORE_PROMPT, /Maintain terminology consistently/i);
  assert.match(QUALITY_CORE_PROMPT, /error codes, version numbers/i);
  assert.match(QUALITY_CORE_PROMPT, /Do not summarize, omit, merge, soften/i);
  assert.match(QUALITY_CORE_PROMPT, /from the beginning of the document to the end/i);
  // Natural professional writing over literal mirroring.
  assert.match(QUALITY_CORE_PROMPT, /nominalization/i);
  assert.match(QUALITY_CORE_PROMPT, /literal legalese/i);
});

// The five gaps that only showed up in real long-form business translation.

test('entity names are locked once established', () => {
  assert.match(QUALITY_CORE_PROMPT, /Entity names are immutable/i);
  assert.match(QUALITY_CORE_PROMPT, /Never rename, retranslate, abbreviate, normalize, or stylistically vary/i);
  assert.match(QUALITY_CORE_PROMPT, /company, product, system, department, project, or defined term/i);
});

test('broad business concepts are not narrowed into financial metrics', () => {
  assert.match(QUALITY_CORE_PROMPT, /Do not narrow a broad business concept into a more specific financial metric/i);
  assert.match(QUALITY_CORE_PROMPT, /distinguish revenue, profit, return, savings, benefits, proceeds, income, and ROI/i);
});

test('unambiguous source facts must not become ambiguous wording', () => {
  assert.match(QUALITY_CORE_PROMPT, /unambiguous frequency, quantity, or scope/i);
  assert.match(QUALITY_CORE_PROMPT, /once every two weeks/i);
  assert.match(QUALITY_CORE_PROMPT, /bi-weekly/i);
});

test('professional register beats mechanically compositional phrasing', () => {
  assert.match(QUALITY_CORE_PROMPT, /Prefer terminology actually used in professional English/i);
  assert.match(QUALITY_CORE_PROMPT, /Avoid mechanically compositional phrases/i);
  assert.match(QUALITY_CORE_PROMPT, /project-management documents/i);
});

test('paragraph and block structure must be preserved', () => {
  assert.match(QUALITY_CORE_PROMPT, /Preserve the paragraph and block structure/i);
  assert.match(QUALITY_CORE_PROMPT, /must not be merged or split/i);
  assert.match(QUALITY_CORE_PROMPT, /If the source contains N blocks, the translation contains N blocks/i);
});

test('the business channel carries concrete wrong/right pairs', () => {
  assert.match(BUSINESS_PROMPT, /交易金额/);
  assert.match(BUSINESS_PROMPT, /现有系统/);
  assert.match(BUSINESS_PROMPT, /不要机械|不是/);
  assert.match(BUSINESS_PROMPT, /transaction value/);
  assert.match(BUSINESS_PROMPT, /legacy systems/);
  assert.match(BUSINESS_PROMPT, /time-sensitive documentation/);
});
