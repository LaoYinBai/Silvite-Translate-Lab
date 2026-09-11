import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { initOfficeWasm, minimalPptx, minimalXlsx } from './helpers.mjs';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(async () => vite.close());

const { parseDocumentFile, DocumentFileError, MAX_DOCUMENT_FILE_SIZE } = await vite.ssrLoadModule('/src/services/document/fileParser.ts');

await initOfficeWasm();

function fileOf(parts, name, type) {
  return new File(parts, name, { type });
}

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('a PowerPoint deck is parsed through the lazy Office parser', async () => {
  const parsed = await parseDocumentFile(fileOf([minimalPptx('幻灯片标题', '正文要点')], 'deck.pptx', PPTX_MIME));
  assert.equal(parsed.kind, 'pptx');
  assert.match(parsed.text, /幻灯片标题/);
  assert.match(parsed.text, /正文要点/);
});

test('a spreadsheet is parsed and keeps its rows', async () => {
  const parsed = await parseDocumentFile(fileOf([minimalXlsx()], 'book.xlsx', XLSX_MIME));
  assert.equal(parsed.kind, 'xlsx');
  assert.match(parsed.text, /角色名/);
  assert.match(parsed.text, /Silvite/);
});

test('a legacy DOC without the OLE signature is rejected before parsing', async () => {
  await assert.rejects(
    () => parseDocumentFile(fileOf(['not an ole file'], 'old.doc', 'application/msword')),
    (error) => error instanceof DocumentFileError && error.code === 'INVALID_FILE',
  );
});

test('a deck whose bytes are not a ZIP is rejected before parsing', async () => {
  await assert.rejects(
    () => parseDocumentFile(fileOf(['%PDF-1.4 masquerading'], 'deck.pptx', PPTX_MIME)),
    (error) => error instanceof DocumentFileError && error.code === 'INVALID_FILE',
  );
});

test('legacy XLS gets an actionable message instead of a generic rejection', async () => {
  await assert.rejects(
    () => parseDocumentFile(fileOf(['anything'], 'old.xls', 'application/vnd.ms-excel')),
    (error) => error instanceof DocumentFileError
      && error.code === 'UNSUPPORTED_FILE'
      && /xlsx/.test(error.message),
  );
});

test('Office files may exceed the text-file size limit, other formats may not', async () => {
  const officeBytes = Buffer.alloc(12 * 1024 * 1024, 0x61);
  officeBytes.write('PK', 0, 'utf8');
  let deckError = null;
  try {
    await parseDocumentFile(fileOf([officeBytes], 'big.pptx', PPTX_MIME));
  } catch (error) {
    deckError = error;
  }
  assert.ok(deckError instanceof DocumentFileError, 'garbage deck must still fail to parse');
  assert.notEqual(deckError.code, 'FILE_TOO_LARGE', 'a 12MB deck must not be rejected for size');

  const hugeDeck = Buffer.alloc(26 * 1024 * 1024, 0x61);
  hugeDeck.write('PK', 0, 'utf8');
  await assert.rejects(
    () => parseDocumentFile(fileOf([hugeDeck], 'huge.pptx', PPTX_MIME)),
    (error) => error instanceof DocumentFileError && error.code === 'FILE_TOO_LARGE',
  );

  const oversizedText = Buffer.alloc(MAX_DOCUMENT_FILE_SIZE + 1, 0x61);
  await assert.rejects(
    () => parseDocumentFile(fileOf([oversizedText], 'big.txt', 'text/plain')),
    (error) => error instanceof DocumentFileError && error.code === 'FILE_TOO_LARGE',
  );
});
