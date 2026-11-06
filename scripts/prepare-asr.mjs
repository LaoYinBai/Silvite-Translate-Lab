// Build-time preparation only. Browser inference has no Node/backend dependency.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache', 'sherpa');
const output = path.join(root, 'public', 'asr');
const runtimeDirectory = 'sherpa-onnx-wasm-simd-v1.12.33-zh-en-asr-zipformer';
const modelDirectory = 'sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16';
const revision = 'zipformer-small-zh-en-int8-sherpa-1.12.33-v1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const extractedHashes = {
  'sherpa-onnx-asr.js': 'c71a9817c2dd3ab69fd1967a81260428650890980d11d97cfa8e00d551e34f2b',
  'sherpa-onnx-wasm-main-asr.js': '861c4b9f390334cffa04f76ee41d53c9504255a1050180fc65163eb6a07d58c2',
  'sherpa-onnx-wasm-main-asr.wasm': 'd152117fd2d251edd617f0a066d53672ecd5a61c38096647f09aed403dc4b0cb',
  'encoder-epoch-99-avg-1.int8.onnx': 'db6f51551762e40e549166fe041ea3e45464370b595e9ad23f06478ec3794fbb',
  'decoder-epoch-99-avg-1.int8.onnx': '4b618d383af304cfae281dbf0a53e8bf442c2f0502256cd5694bd6567ebdd834',
  'joiner-epoch-99-avg-1.int8.onnx': 'bdda356d6f9b8c2d7cee9ee0e26075fa537490f7fd06520be408d287073667b9',
  'tokens.txt': 'a8e0e4ec53810e433789b54a5c0134a7eaa2ffca595a6334d54c00da858841d3',
};
const archives = [
  { name: 'runtime', id: 380303244, bytes: 181528215, sha256: 'bab1d513c4aeca462996bcef5b35d2a9768e5e18b92bdb24a1b26178a23270e4',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.33/' + runtimeDirectory + '.tar.bz2',
    files: ['sherpa-onnx-asr.js', 'sherpa-onnx-wasm-main-asr.js', 'sherpa-onnx-wasm-main-asr.wasm'] },
  { name: 'models', id: 157661357, bytes: 458187351, sha256: '2b7c63322b32e5e0f2526043a1103366119ca58dd615cd7105a37c01db9553d7',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/' + modelDirectory + '.tar.bz2',
    files: ['encoder-epoch-99-avg-1.int8.onnx', 'decoder-epoch-99-avg-1.int8.onnx', 'joiner-epoch-99-avg-1.int8.onnx', 'tokens.txt'] },
];

async function download(url, filename, expectedHash, expectedBytes) {
  try {
    const bytes = await readFile(filename);
    if ((!expectedBytes || bytes.length === expectedBytes) && (!expectedHash || digest(bytes) === expectedHash)) return;
  } catch { /* download below */ }
  const urls = [url];
  const archive = archives.find(item => item.url === url);
  if (archive) urls.push('https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/assets/' + archive.id);
  const githubRaw = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (githubRaw) urls.push('https://api.github.com/repos/' + githubRaw[1] + '/' + githubRaw[2] + '/contents/' + githubRaw[4] + '?ref=' + githubRaw[3]);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const candidate of urls) {
      try {
        const headers = candidate.includes('/releases/assets/') ? { Accept: 'application/octet-stream' }
          : candidate.includes('/contents/') ? { Accept: 'application/vnd.github.raw+json' } : {};
        if (candidate.startsWith('https://api.github.com/') && process.env.GH_TOKEN) headers.Authorization = 'Bearer ' + process.env.GH_TOKEN;
        const response = await fetch(candidate, { headers, signal: AbortSignal.timeout(600_000) });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (expectedBytes && bytes.length !== expectedBytes || expectedHash && digest(bytes) !== expectedHash) throw new Error('Asset hash/length mismatch');
        await writeFile(filename, bytes);
        console.log('Prepared ASR source: ' + path.basename(filename));
        return;
      } catch (error) { lastError = error; }
    }
  }
  throw new Error('Cannot prepare ' + path.basename(filename) + ': ' + lastError?.message);
}

await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const runtime = path.join(cache, 'runtime', runtimeDirectory);
const models = path.join(cache, 'model', modelDirectory);
for (const archive of archives) {
  const filename = path.join(cache, archive.name + '.tar.bz2.local');
  await download(archive.url, filename, archive.sha256, archive.bytes);
  const destination = path.join(cache, archive.name === 'runtime' ? 'runtime' : 'model');
  const directory = archive.name === 'runtime' ? runtimeDirectory : modelDirectory;
  let missing = false;
  for (const file of archive.files) {
    try { if (digest(await readFile(path.join(destination, directory, file))) !== extractedHashes[file]) missing = true; }
    catch { missing = true; }
  }
  if (missing) {
    await mkdir(destination, { recursive: true });
    const names = archive.files.map(file => (archive.name === 'runtime' ? './' : '') + directory + '/' + file);
    const extraction = spawnSync('tar', ['-xjf', filename, '-C', destination, ...names], { stdio: 'inherit' });
    if (extraction.status !== 0) throw new Error('ASR archive extraction failed');
  }
  for (const file of archive.files) {
    if (digest(await readFile(path.join(destination, directory, file))) !== extractedHashes[file]) throw new Error('Pinned ASR source hash mismatch: ' + file);
  }
}

const virtualFiles = [];
const buffers = [];
let offset = 0;
for (const [name, filename] of [
  ['encoder.onnx', 'encoder-epoch-99-avg-1.int8.onnx'],
  ['decoder.onnx', 'decoder-epoch-99-avg-1.int8.onnx'],
  ['joiner.onnx', 'joiner-epoch-99-avg-1.int8.onnx'],
  ['tokens.txt', 'tokens.txt'],
]) {
  const bytes = await readFile(path.join(models, filename));
  virtualFiles.push({ filename: '/' + name, start: offset, end: offset + bytes.length });
  buffers.push(bytes);
  offset += bytes.length;
}
// The shipped engine is generic. Replace only the pinned generated loader's
// virtual-file metadata; do not ship its 199 MB demonstration model package.
const originalLoader = await readFile(path.join(runtime, 'sherpa-onnx-wasm-main-asr.js'), 'utf8');
const metadataPattern = /loadPackage\((\{"files":\[[^\n]*?\],"remote_package_size":\d+\})\)/;
const metadataMatch = originalLoader.match(metadataPattern);
if (!metadataMatch || JSON.parse(metadataMatch[1]).remote_package_size !== 199059238) throw new Error('Pinned ASR loader layout changed');
const metadata = JSON.stringify({ files: virtualFiles, remote_package_size: offset });
const prefix = 'var Module=typeof Module!="undefined"?Module:{};';
if (!originalLoader.startsWith(prefix)) throw new Error('Pinned ASR runtime prefix changed');
const loader = originalLoader.replace(metadataMatch[1], metadata)
  .replace(prefix, 'var Module=globalThis.__translateLabSherpaModule;') + '\nexport default Module;\n';
await writeFile(path.join(output, 'sherpa-onnx-wasm-main-asr.js'), loader);
await writeFile(path.join(output, 'sherpa-onnx-asr.js'), await readFile(path.join(runtime, 'sherpa-onnx-asr.js'), 'utf8') + '\nexport { createOnlineRecognizer };\n');

const files = [];
async function publish(file, bytes, split = false) {
  const parts = [];
  const partSize = 20_000_000;
  if (split) {
    for (let index = 0; index < bytes.length; index += partSize) {
      const part = bytes.subarray(index, index + partSize);
      const name = file + '.part' + parts.length;
      await writeFile(path.join(output, name), part);
      parts.push({ file: name, bytes: part.length, sha256: digest(part) });
    }
  } else await writeFile(path.join(output, file), bytes);
  files.push({ file, bytes: bytes.length, sha256: digest(bytes), ...(split ? { parts } : {}) });
}
await publish('model.data', Buffer.concat(buffers), true);
// The pinned demo reserves 512 MiB up front. Its module defines one growable
// memory (max 2 GiB); reduce only the minimum to 128 MiB. Decode the section
// rather than scanning/replacing byte patterns in arbitrary executable data.
const engine = await readFile(path.join(runtime, 'sherpa-onnx-wasm-main-asr.wasm'));
let position = 8;
let tunedMemory = false;
const readLeb = () => {
  let value = 0, shift = 0, byte;
  do {
    if (position >= engine.length || shift > 28) throw new Error('Invalid pinned WASM section');
    byte = engine[position++]; value += (byte & 127) * 2 ** shift; shift += 7;
  } while (byte & 128);
  return value;
};
while (position < engine.length) {
  const sectionId = engine[position++];
  const sectionSize = readLeb();
  const start = position;
  if (start + sectionSize > engine.length) throw new Error('Invalid pinned WASM section size');
  if (sectionId === 5) {
    if (JSON.stringify([...engine.subarray(start, start + sectionSize)]) !== '[1,1,128,64,128,128,2]') throw new Error('Pinned WASM memory declaration changed');
    engine[start + 3] = 16; // LEB128 8192 pages -> 2048 pages; each page is 64 KiB.
    tunedMemory = true;
  }
  position = start + sectionSize;
}
if (!tunedMemory || !WebAssembly.validate(engine)) throw new Error('Invalid adjusted WASM engine');
await publish('sherpa-onnx-wasm-main-asr.wasm', engine);
files.push({ file: 'sherpa-onnx-wasm-main-asr.js', bytes: Buffer.byteLength(loader), sha256: digest(Buffer.from(loader)) });
const api = await readFile(path.join(output, 'sherpa-onnx-asr.js'));
files.push({ file: 'sherpa-onnx-asr.js', bytes: api.length, sha256: digest(api) });

for (const [name, url] of [
  ['SHERPA-LICENSE', 'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/5092b4487125b6584b77aaa3c9dcf5f97063dce8/LICENSE'],
  ['ONNXRUNTIME-LICENSE', 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.17.1/LICENSE'],
  ['ONNXRUNTIME-NOTICES', 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.17.1/ThirdPartyNotices.txt'],
]) await download(url, path.join(output, name));
await writeFile(path.join(output, 'MODEL-NOTICE'), 'Model: ' + modelDirectory + '\nSource: ' + archives[1].url + '\nOriginal model card: https://huggingface.co/csukuangfj/k2fsa-zipformer-bilingual-zh-en-t\nModel card declares Apache-2.0. See SHERPA-LICENSE and the model card.\nAll encoder, decoder and joiner weights use int8 quantization.\n');
await writeFile(path.join(output, 'LOADER-NOTICE'), 'Runtime: sherpa-onnx v1.12.33 (Apache-2.0), with ONNX Runtime 1.17.1.\nModifications: data-package metadata selects the small bilingual int8 model; generated JS wrapped as ES modules; WASM initial memory reduced from 512 MiB to 128 MiB while preserving growth to 2 GiB.\nOriginal loader and runtime archive SHA-256: ' + archives[0].sha256 + '\n');
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ revision, model: modelDirectory, runtime: 'sherpa-onnx-v1.12.33', sampleRate: 16000, files }, null, 2));

// Both directories contain generated assets only. Keep the old model available
// in the ignored download cache, but exclude it from this application's build.
const legacyAssets = path.resolve(root, 'public', 'whisper');
if (legacyAssets !== path.join(root, 'public', 'whisper')) throw new Error('Unexpected legacy asset path');
await rm(legacyAssets, { recursive: true, force: true });
const publishedNames = new Set([...files.filter(file => !file.parts).map(file => file.file), ...files.flatMap(file => file.parts?.map(part => part.file) || []),
  'manifest.json', 'SHERPA-LICENSE', 'ONNXRUNTIME-LICENSE', 'ONNXRUNTIME-NOTICES', 'MODEL-NOTICE', 'LOADER-NOTICE']);
for (const file of await readdir(output)) if (!publishedNames.has(file)) await rm(path.join(output, file), { force: true });
console.log('Streaming ASR ready: ' + offset + ' model bytes; ' + files.reduce((sum, file) => sum + file.bytes, 0) + ' runtime + model bytes.');
