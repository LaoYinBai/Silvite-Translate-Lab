import type { CorpusAlignmentInput } from '../alignment/corpusAlign';
import type { CorpusProject } from './types';
import type { ProgressReporter } from './assets';
import { sdltmInput, type SdltmResult } from './sdltm';

function runWorker<T>(worker: Worker, payload: Record<string, unknown>, signal: AbortSignal, onProgress: ProgressReporter, limit: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal.reason || new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('处理时间较长，请拆分文件后重试。')); }, limit);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ id: string; type: string; result?: T; message?: string; fraction?: number }>) => {
      if (data.id !== id) return;
      if (data.type === 'progress') { onProgress(data.message || '正在处理', data.fraction); return; }
      cleanup();
      if (data.type === 'result' && data.result !== undefined) resolve(data.result);
      else reject(new Error(data.message || '语料处理失败。'));
    };
    worker.onerror = () => { cleanup(); reject(new Error('浏览器处理资源不足或工作线程中断，请拆分文件后重试。')); };
    worker.onmessageerror = () => { cleanup(); reject(new Error('语料处理结果传输失败。')); };
    try {
      worker.postMessage({ ...payload, id, base: new URL(import.meta.env.BASE_URL + 'corpus/', location.origin).href });
    } catch (error) { cleanup(); reject(error); }
  });
}

export function parseStructuredFile(bytes: Uint8Array, kind: 'rtf' | 'docx', signal: AbortSignal, progress: ProgressReporter) {
  return runWorker<{ ast: unknown; warnings: string[] }>(
    new Worker(new URL('./document.worker.ts', import.meta.url), { type: 'module' }), { bytes, kind }, signal, progress, 180_000);
}
export function alignCorpusInBrowser(input: CorpusAlignmentInput, signal: AbortSignal, progress: ProgressReporter) {
  return runWorker<CorpusProject>(new Worker(new URL('../alignment/semantic.worker.ts', import.meta.url), { type: 'module' }),
    { input }, signal, progress, input.mode === 'semantic' ? 600_000 : 45_000);
}

export function exportSdltmInBrowser(project: CorpusProject, signal: AbortSignal, progress: ProgressReporter) {
  const input = sdltmInput(project);
  return runWorker<SdltmResult>(new Worker(new URL('./sdltm.worker.ts', import.meta.url), { type: 'module' }),
    { input }, signal, progress, 180_000);
}
