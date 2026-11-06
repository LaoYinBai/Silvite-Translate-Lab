import type { ParagraphAlignment, ParagraphAlignmentInput } from './paragraphs';

export function alignParagraphsInBrowser(input: ParagraphAlignmentInput, signal: AbortSignal): Promise<ParagraphAlignment | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const worker = new Worker(new URL('./paragraphs.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('段落对照处理时间较长，请继续查看完整译文。')); }, 20_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ alignment?: ParagraphAlignment | null; error?: string }>) => {
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data.alignment ?? null);
    };
    worker.onerror = () => { cleanup(); reject(new Error('段落对照暂时不可用，可以继续查看完整译文。')); };
    worker.onmessageerror = () => { cleanup(); reject(new Error('段落对照数据读取失败，可以继续查看完整译文。')); };
    try {
      worker.postMessage(input);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
