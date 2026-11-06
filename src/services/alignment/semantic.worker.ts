import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { corpusManifest, corpusResourceCache, loadCorpusResource } from '../corpus/assets';
import { alignmentSentences, alignCorpus, type CorpusAlignmentInput } from './corpusAlign';

interface Request { id: string; base: string; input: CorpusAlignmentInput }
const normalise = (vector: Float32Array) => {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (length) for (let i = 0; i < vector.length; i++) vector[i] /= length;
  return vector;
};

export async function embeddings(extractor: FeatureExtractionPipeline, texts: string[], progress: (value: number) => void): Promise<Float32Array[]> {
  const vectors = texts.map(() => new Float32Array(384));
  const windows: Array<{ text: string; owner: number; weight: number }> = [];
  const appendWindow = (ids: number[], owner: number) => {
    if (!ids.length) return;
    const text = extractor.tokenizer.decode(ids, { skip_special_tokens: true, clean_up_tokenization_spaces: false });
    // Decoding a window can change its word boundaries. Recheck its encoded
    // size; every request, including special tokens, remains at most 128.
    const encoded = extractor.tokenizer.encode(text, { add_special_tokens: true });
    if (encoded.length > 128 && ids.length > 1) {
      const middle = Math.floor(ids.length / 2);
      appendWindow(ids.slice(0, middle), owner); appendWindow(ids.slice(middle), owner);
    } else windows.push({ text: text || '[UNK]', owner, weight: ids.length });
  };
  for (const [owner, text] of texts.entries()) {
    if (!text.trim()) continue;
    const ids = extractor.tokenizer.encode(text, { add_special_tokens: false });
    if (ids.length <= 126) windows.push({ text, owner, weight: Math.max(1, ids.length) });
    else for (let start = 0; start < ids.length; start += 120) appendWindow(ids.slice(start, start + 120), owner);
  }
  for (let start = 0; start < windows.length; start += 8) {
    const batch = windows.slice(start, start + 8);
    const output = await extractor(batch.map(window => window.text), { pooling: 'mean', normalize: true });
    if (output.dims.length !== 2 || output.dims[0] !== batch.length || output.dims[1] !== 384) throw new Error('语义模型返回的向量维度无效。');
    for (const [index, window] of batch.entries()) {
      for (let dim = 0; dim < 384; dim++) {
        const value = Number(output.data[index * 384 + dim]);
        if (!Number.isFinite(value)) throw new Error('语义模型返回的向量包含无效数值。');
        vectors[window.owner][dim] += value * window.weight;
      }
    }
    progress(Math.min(1, (start + batch.length) / Math.max(1, windows.length)));
  }
  return vectors.map(normalise);
}

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  const progress = (message: string, fraction?: number) => self.postMessage({ id: data.id, type: 'progress', message, fraction });
  let extractor: FeatureExtractionPipeline | null = null;
  const runtimeUrls: string[] = [];
  try {
    const input = data.input;
    if (input.mode === 'structure') {
      progress('正在按结构、数字和顺序对齐', 0.5);
      self.postMessage({ id: data.id, type: 'result', result: alignCorpus(input) });
      return;
    }
    const base = new URL(data.base);
    if (base.origin !== self.location.origin) throw new Error('语义模型必须从本站加载。');
    progress('准备本地语义模型', 0);
    const manifest = await corpusManifest(base);
    let loaded = 0;
    const expected = manifest.files.filter(file => file.file.startsWith('models/') || file.file.includes('.jsep.')).reduce((sum, file) => sum + file.bytes, 0);
    const reportBytes = (count: number) => { loaded += count; progress('下载并校验语义模型与运行组件', Math.min(0.35, loaded / expected * 0.35)); };
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = new URL('models/', base).href;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = corpusResourceCache(base, manifest, reportBytes);
    env.backends.onnx.wasm!.numThreads = 1;
    env.backends.onnx.wasm!.proxy = false;
    const runtimeMjs = await loadCorpusResource(base, manifest, 'runtime/ort-wasm-simd-threaded.jsep.mjs', reportBytes);
    const runtimeWasm = await loadCorpusResource(base, manifest, 'runtime/ort-wasm-simd-threaded.jsep.wasm', reportBytes);
    const mjs = URL.createObjectURL(new Blob([runtimeMjs], { type: 'text/javascript' }));
    const wasm = URL.createObjectURL(new Blob([runtimeWasm], { type: 'application/wasm' }));
    runtimeUrls.push(mjs, wasm);
    env.backends.onnx.wasm!.wasmPaths = { mjs, wasm };
    extractor = await pipeline<'feature-extraction'>('feature-extraction', 'minilm', { dtype: 'q8', device: 'wasm', local_files_only: true });
    const sentences = alignmentSentences(input);
    const all = [...sentences.source, ...sentences.target];
    const features = await embeddings(extractor, all.map(sentence => sentence.matchText), value => progress('正在比较中英文句段含义', 0.35 + value * 0.55));
    progress('正在构建对齐路径与覆盖检查', 0.93);
    const result = alignCorpus(input, { source: features.slice(0, sentences.source.length), target: features.slice(sentences.source.length) });
    self.postMessage({ id: data.id, type: 'result', result });
  } catch (error) {
    self.postMessage({ id: data.id, type: 'error', message: error instanceof Error ? error.message : '自动对齐失败。' });
  } finally {
    await extractor?.dispose();
    for (const url of runtimeUrls) URL.revokeObjectURL(url);
  }
};
