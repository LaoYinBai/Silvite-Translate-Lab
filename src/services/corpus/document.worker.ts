import { corpusManifest, loadCorpusResource } from './assets';
import { createPandoc } from './pandoc';
import { CORPUS_LIMITS } from './types';

self.onmessage = async ({ data }: MessageEvent<{ id: string; base: string; kind: 'rtf' | 'docx'; bytes: Uint8Array }>) => {
  const { id } = data;
  const progress = (message: string, fraction?: number) => self.postMessage({ id, type: 'progress', message, fraction });
  try {
    if (!['rtf', 'docx'].includes(data.kind) || data.bytes.length > CORPUS_LIMITS.inputBytes) throw new Error('文档格式或大小超出支持范围。');
    const base = new URL(data.base);
    if (base.origin !== self.location.origin) throw new Error('文档解析资源必须来自本站。');
    progress('准备文档结构解析器', 0);
    const manifest = await corpusManifest(base);
    const size = manifest.files.find(file => file.file === 'pandoc.wasm')?.bytes || 1;
    let loaded = 0;
    const bytes = await loadCorpusResource(base, manifest, 'pandoc.wasm', count => { loaded += count; progress('加载文档解析资源', loaded / size * 0.7); });
    progress('正在解析文档段落与表格', 0.75);
    const convert = await createPandoc(bytes);
    const result = convert(data.bytes, data.kind);
    self.postMessage({ id, type: 'result', result });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : '文档结构解析失败。' });
  }
};
