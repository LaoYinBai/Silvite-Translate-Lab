import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache', 'corpus');
const out = path.join(root, 'public', 'corpus');
const revision = 'minilm-2c4055b-pandoc-3.13-sqlite-3.54.1-v2';
const modelRevision = '2c4055b12046f11709e9df2c122e59ffbdc2f900';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const modelFiles = {
  'onnx/model_quantized.onnx': '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc',
  'tokenizer.json': 'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441',
  'config.json': '05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7',
  'tokenizer_config.json': '3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2',
  'special_tokens_map.json': '06e405a36dfe4b9604f484f6a1e619af1a7f7d09e34a8555eb0b77b66318067f',
  'README.md': '1faca2377fb36a7c5ee603ffdd170cf93126be37e7b3b422d319b8ed34081e73',
};
await mkdir(cache, { recursive: true });
await mkdir(out, { recursive: true });

async function download(urls, file, sha256) {
  try { const bytes = await readFile(file); if (!sha256 || hash(bytes) === sha256) return bytes; } catch { /* prepare below */ }
  await mkdir(path.dirname(file), { recursive: true });
  urls = urls.flatMap(url => {
    const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    return raw ? [url, 'https://api.github.com/repos/' + raw[1] + '/' + raw[2] + '/contents/' + raw[4] + '?ref=' + raw[3]] : [url];
  });
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of urls) {
      try {
        const headers = url.includes('/releases/assets/') ? { Accept: 'application/octet-stream' }
          : url.includes('/contents/') || url.includes('/git/blobs/') ? { Accept: 'application/vnd.github.raw+json' } : {};
        if (url.startsWith('https://api.github.com/') && process.env.GH_TOKEN) headers.Authorization = 'Bearer ' + process.env.GH_TOKEN;
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(240_000) });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (sha256 && hash(bytes) !== sha256) throw new Error('Asset hash mismatch');
        await writeFile(file, bytes);
        console.log('Prepared corpus: ' + path.relative(cache, file));
        return bytes;
      } catch (error) { last = error; }
    }
  }
  throw new Error('Cannot prepare ' + path.basename(file) + ': ' + last?.message);
}
const zip = path.join(cache, 'pandoc-3.13-wasm.zip.local');
await download([
  'https://github.com/jgm/pandoc/releases/download/3.13/pandoc-3.13-wasm.zip',
  'https://api.github.com/repos/jgm/pandoc/releases/assets/679544583',
], zip, '234d2020a7f3a9aab387bd35df3c17ca2ba0078a82490e2b3ede890d648d64fe');
let pandoc;
try {
  pandoc = await readFile(path.join(cache, 'pandoc-3.13-wasm', 'pandoc.wasm'));
  if (hash(pandoc) !== '6f4d43505a545fbfbe3ace4cd1204a7a5d5aea4a7a93c22f09056c0a9381bb4a') pandoc = null;
} catch { /* extract below */ }
if (!pandoc) {
  const result = spawnSync('tar', ['-xf', zip, '-C', cache], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Pandoc extraction failed');
  pandoc = await readFile(path.join(cache, 'pandoc-3.13-wasm', 'pandoc.wasm'));
}
if (hash(pandoc) !== '6f4d43505a545fbfbe3ace4cd1204a7a5d5aea4a7a93c22f09056c0a9381bb4a') throw new Error('Pandoc WASM hash mismatch');
const files = [];
async function publish(file, bytes, split = bytes.length > 20_000_000) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  const parts = [];
  if (split) {
    for (let offset = 0; offset < bytes.length; offset += 20_000_000) {
      const chunk = bytes.subarray(offset, offset + 20_000_000);
      const name = file + '.part' + parts.length;
      await writeFile(path.join(out, name), chunk);
      parts.push({ file: name, bytes: chunk.length, sha256: hash(chunk) });
    }
  } else await writeFile(path.join(out, file), bytes);
  files.push({ file, bytes: bytes.length, sha256: hash(bytes), ...(split ? { parts } : {}) });
}
await publish('pandoc.wasm', pandoc);
const sqliteRoot = path.join(root, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist');
const sqliteWasm = await readFile(path.join(sqliteRoot, 'sqlite3.wasm'));
if (hash(sqliteWasm) !== 'b8a92a19f441a90ff2339fe988fbe317c4adf3ed844096f12aee04aa72d58257') throw new Error('SQLite WASM version/hash mismatch');
await publish('sqlite/sqlite3.wasm', sqliteWasm);
const sdltmTemplate = await download([
  'https://api.github.com/repos/RWS/trados-studio-api-samples/git/blobs/6b429dd22e611042f5cf232f3ec3877c7b088d80',
], path.join(cache, 'official-empty.sdltm'), 'd0e367a1de5d1ed9f65d9cd031e8d9c551cb5fe4ecb1a5ec948f5a5e2db70eaf');
await publish('sqlite/empty.sdltm', sdltmTemplate);
for (const [file, digest] of Object.entries(modelFiles)) {
  const suffix = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/' + modelRevision + '/' + file;
  const base = process.env.CORPUS_MODEL_BASE_URL;
  const urls = [...(base ? [base.replace(/\/?$/, '/') + suffix] : []), 'https://huggingface.co/' + suffix, 'https://hf-mirror.com/' + suffix];
  const bytes = await download(urls, path.join(cache, 'minilm', file), digest);
  await publish('models/minilm/' + file, bytes);
}
const require = createRequire(import.meta.url);
const transformersEntry = require.resolve('@huggingface/transformers');
const ortDist = path.dirname(createRequire(transformersEntry).resolve('onnxruntime-web'));
await mkdir(path.join(out, 'runtime'), { recursive: true });
for (const file of await readdir(ortDist)) {
  if (/^ort-wasm.*\.(?:mjs|wasm)$/.test(file)) {
    const bytes = await readFile(path.join(ortDist, file));
    if (bytes.length > 25_000_000) throw new Error('ONNX runtime exceeds static hosting limit');
    await publish('runtime/' + file, bytes, false);
  }
}
for (const name of ['COPYING.md', 'COPYRIGHT']) await copyFile(path.join(cache, 'pandoc-3.13-wasm', name), path.join(out, 'PANDOC-' + name));
const wrapperLicense = 'Copyright (c) 2025 Tweag I/O Limited and John MacFarlane. MIT License.\nThe browser WASI bridge is adapted from https://github.com/jgm/pandoc/blob/3.13/wasm/pandoc.js\n';
await writeFile(path.join(out, 'PANDOC-WRAPPER-NOTICE'), wrapperLicense);
for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) await copyFile(path.join(root, 'node_modules', '@bjorn3', 'browser_wasi_shim', name), path.join(out, 'WASI-' + name));
await writeFile(path.join(out, 'SOURCES'), [
  'Pandoc 3.13: GPL-2.0-or-later; complete corresponding source: https://github.com/jgm/pandoc/releases/tag/3.13',
  'Pandoc WASM archive SHA256: 234d2020a7f3a9aab387bd35df3c17ca2ba0078a82490e2b3ede890d648d64fe',
  'WASI JS shim 0.3.0: MIT/Apache-2.0; https://github.com/bjorn3/browser_wasi_shim',
  'SQLite core/WASM: public domain, Emscripten glue MIT/NCSA; @sqlite.org/sqlite-wasm wrapper/types 3.54.1-build1 Apache-2.0: https://github.com/sqlite/sqlite-wasm',
  'Experimental SDLTM empty template: RWS/trados-studio-api-samples, Apache-2.0; Git blob 6b429dd22e611042f5cf232f3ec3877c7b088d80',
  'SDLTM template SHA256: d0e367a1de5d1ed9f65d9cd031e8d9c551cb5fe4ecb1a5ec948f5a5e2db70eaf; no private corpus samples are distributed.',
  'Transformers.js 3.8.1: Apache-2.0; https://github.com/huggingface/transformers.js',
  'MiniLM base model Apache-2.0: https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
  'ONNX conversion: https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tree/' + modelRevision,
  'The ONNX conversion repository does not separately declare a license; retain the Apache-2.0 base-model license and both provenance links.',
].join('\n') + '\n');
const baseLicense = await download(['https://www.apache.org/licenses/LICENSE-2.0.txt', 'https://raw.githubusercontent.com/UKPLab/sentence-transformers/master/LICENSE'], path.join(cache, 'MINILM-LICENSE'));
await writeFile(path.join(out, 'MINILM-LICENSE'), baseLicense);
await writeFile(path.join(out, 'SQLITE-PACKAGE-LICENSE'), baseLicense);
await writeFile(path.join(out, 'RWS-TEMPLATE-LICENSE'), baseLicense);
const sqliteJs = await readFile(path.join(sqliteRoot, 'index.mjs'), 'utf8');
await writeFile(path.join(out, 'SQLITE-WASM-NOTICE'), sqliteJs.slice(0, sqliteJs.indexOf('async function sqlite3InitModule')));
await copyFile(path.join(path.dirname(transformersEntry), '..', 'LICENSE'), path.join(out, 'TRANSFORMERS-LICENSE'));
const ortCommit = (await readFile(path.join(ortDist, '..', '__commit.txt'), 'utf8')).trim();
for (const name of ['LICENSE', 'ThirdPartyNotices.txt']) {
  const bytes = await download(['https://raw.githubusercontent.com/microsoft/onnxruntime/' + ortCommit + '/' + name], path.join(cache, 'ORT-' + name));
  await writeFile(path.join(out, 'ORT-' + name), bytes);
}
await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ revision, modelRevision, files }, null, 2));
console.log('Corpus static resources ready: ' + files.length + ' files, model revision ' + modelRevision);
