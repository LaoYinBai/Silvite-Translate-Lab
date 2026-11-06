// Build-time asset preparation only. The shipped application needs no Node service.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { access, mkdir, readFile, writeFile, readdir, copyFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(projectRoot, 'public', 'whisper');
const modelRoot = path.join(output, 'models', 'whisper-tiny');
const revision = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';
const downloadCache = path.join(projectRoot, '.cache', 'whisper', revision);
const partSize = 20_000_000; // EdgeOne Pages limits each static file to 25 MB.
const source = process.env.WHISPER_MODEL_BASE_URL || 'https://huggingface.co/onnx-community/whisper-tiny/resolve/';
const files = [
  'config.json', 'generation_config.json', 'preprocessor_config.json',
  'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json',
  'added_tokens.json', 'normalizer.json', 'vocab.json',
  'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx',
  'onnx/encoder_model.onnx', 'onnx/decoder_model_merged_q4.onnx',
];
const hashes = {
  'onnx/encoder_model_quantized.onnx': '2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19',
  'onnx/decoder_model_merged_quantized.onnx': '25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3',
  'onnx/encoder_model.onnx': '6642befb640f950d4a8cbbd17834d59e7e75f575b81ccf213e06b050623ab1dd',
  'onnx/decoder_model_merged_q4.onnx': 'a7573efde84f7d018d59e50e7f860c03e26623d68e23eb6037b76135367e72eb',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download(url, destination, expectedHash) {
  const valid = (bytes) => expectedHash ? hash(bytes) === expectedHash : (() => {
    try { return path.extname(destination) === '.json' ? !!JSON.parse(bytes.toString('utf8')) : bytes.length > 0; }
    catch { return false; }
  })();
  try { const existing = await readFile(destination); if (valid(existing)) return existing; } catch { /* not prepared yet */ }
  await mkdir(path.dirname(destination), { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!valid(bytes)) throw new Error('Content validation failed');
      await writeFile(`${destination}.partial`, bytes);
      await rename(`${destination}.partial`, destination);
      console.log(`Prepared Whisper: ${path.relative(output, destination)} (${bytes.length} bytes)`);
      return bytes;
    } catch (error) {
      await rm(`${destination}.partial`, { force: true });
      if (attempt === 3) throw new Error(`Cannot prepare ${path.basename(destination)}: ${error.message}`, { cause: error });
    }
  }
}

await mkdir(modelRoot, { recursive: true });
const entries = [];
// Bound parallel downloads to avoid holding every response body in memory.
for (let offset = 0; offset < files.length; offset += 3) {
  await Promise.all(files.slice(offset, offset + 3).map(async (file) => {
    const publishedPath = path.join(modelRoot, file);
    const isModel = file.endsWith('.onnx');
    const destination = isModel ? path.join(downloadCache, file) : publishedPath;
    if (isModel) {
      await mkdir(path.dirname(destination), { recursive: true });
      // Reuse assets prepared before part-based delivery was introduced.
      try { await access(destination); }
      catch { try { await copyFile(publishedPath, destination); } catch { /* no previous download */ } }
    }
    const bytes = await download(new URL(`${revision}/${file}`, source.endsWith('/') ? source : `${source}/`), destination, hashes[file]);
    const parts = [];
    if (isModel) {
      await mkdir(path.dirname(publishedPath), { recursive: true });
      for (let position = 0; position < bytes.length; position += partSize) {
        const part = bytes.subarray(position, Math.min(position + partSize, bytes.length));
        const partFile = `${file}.part${parts.length}`;
        await writeFile(path.join(modelRoot, partFile), part);
        parts.push({ file: partFile, bytes: part.length, sha256: hash(part) });
      }
      await rm(publishedPath, { force: true });
    }
    entries.push({ file, bytes: bytes.length, sha256: hash(bytes), ...(isModel ? { parts } : {}) });
  }));
}

const require = createRequire(import.meta.url);
const transformersEntry = require.resolve('@huggingface/transformers');
const transformersRoot = path.resolve(path.dirname(transformersEntry), '..');
const ortDist = path.dirname(createRequire(transformersEntry).resolve('onnxruntime-web'));
await mkdir(path.join(output, 'runtime'), { recursive: true });
for (const file of await readdir(ortDist)) {
  if (/^ort-wasm.*\.(?:mjs|wasm)$/.test(file)) await copyFile(path.join(ortDist, file), path.join(output, 'runtime', file));
}
await copyFile(path.join(transformersRoot, 'LICENSE'), path.join(output, 'TRANSFORMERS-LICENSE'));
const ortRevision = (await readFile(path.join(ortDist, '..', '__commit.txt'), 'utf8')).trim();
await download(`https://raw.githubusercontent.com/microsoft/onnxruntime/${ortRevision}/LICENSE`, path.join(output, 'ONNXRUNTIME-LICENSE'));
await download(`https://raw.githubusercontent.com/microsoft/onnxruntime/${ortRevision}/ThirdPartyNotices.txt`, path.join(output, 'ONNXRUNTIME-NOTICES'));
await download('https://raw.githubusercontent.com/openai/whisper/v20240930/LICENSE', path.join(output, 'WHISPER-LICENSE'));
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  model: 'onnx-community/whisper-tiny', revision,
  dtype: { wasm: 'q8', webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
  upstreamModel: 'openai/whisper-tiny', upstreamLicense: 'MIT',
  source: 'https://huggingface.co/onnx-community/whisper-tiny', files: entries.sort((a, b) => a.file.localeCompare(b.file)),
}, null, 2));
console.log(`Whisper static assets ready: ${output}`);
