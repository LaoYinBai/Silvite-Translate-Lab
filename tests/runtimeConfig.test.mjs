import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('EdgeOne Cloud Functions runtime is configured for 120 seconds', async () => {
  const config = JSON.parse(await readFile(new URL('../edgeone.json', import.meta.url), 'utf8'));
  assert.equal(config.cloudFunctions?.nodejs?.maxDuration, 120);
});

test('translate has one Cloud Function handler and no legacy duplicate', async () => {
  await access(new URL('../cloud-functions/api/translate.js', import.meta.url));
  await assert.rejects(() => access(new URL('../functions/api/translate.js', import.meta.url)));
});
