import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCompletionBudget, getRetryCompletionBudget } from '../functions/api/translate.js';

test('short text gets the small budget', () => {
  assert.equal(getCompletionBudget({ textLength: 100 }), 4096);
  assert.equal(getCompletionBudget({ textLength: 800 }), 4096);
});

test('medium and long text scale the budget', () => {
  assert.equal(getCompletionBudget({ textLength: 801 }), 8192);
  assert.equal(getCompletionBudget({ textLength: 2500 }), 8192);
  assert.equal(getCompletionBudget({ textLength: 4000 }), 16384);
});

test('image mode raises the budget floor', () => {
  assert.equal(getCompletionBudget({ textLength: 0, hasImage: true }), 8192);
});

test('comic + image gets the largest default budget', () => {
  assert.equal(getCompletionBudget({ textLength: 0, hasImage: true, mode: 'comic' }), 16384);
});

test('env override is respected', () => {
  assert.equal(getCompletionBudget({ textLength: 10, env: { MAX_COMPLETION_TOKENS: '6144' } }), 6144);
});

test('unreasonable env values are clamped', () => {
  assert.equal(getCompletionBudget({ textLength: 10, env: { MAX_COMPLETION_TOKENS: '999999' } }), 65536);
  assert.equal(getCompletionBudget({ textLength: 10, env: { MAX_COMPLETION_TOKENS: '1' } }), 1024);
  assert.equal(getCompletionBudget({ textLength: 10, env: { MAX_COMPLETION_TOKENS: 'abc' } }), 4096);
});

test('retry budget doubles but stays clamped', () => {
  assert.equal(getRetryCompletionBudget(4096), 8192);
  assert.equal(getRetryCompletionBudget(16384), 32768);
  assert.equal(getRetryCompletionBudget(32768), 65536);
});
