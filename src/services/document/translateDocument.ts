import type { TranslationRequest, TranslationResponse, TranslationStreamHandlers } from '../../api/client';
import { translateStream } from '../../api/client';
import { chunkDocument, detectDocumentLanguage, extractDocumentTitle } from './chunker';

export type DocumentProgressStatus = 'analyzing' | 'translating' | 'retrying-part' | 'assembling';

export interface DocumentProgress {
  percent: number;
  status: DocumentProgressStatus;
  provisionalText: string;
}

export interface DocumentTranslationInput {
  text: string;
  mode?: string;
  context?: string;
  terminology?: string;
  preserveNames?: boolean;
  explainTranslation?: boolean;
}

export interface DocumentTranslationDependencies {
  translateChunk?: (
    request: TranslationRequest,
    handlers: TranslationStreamHandlers,
    signal?: AbortSignal,
  ) => Promise<TranslationResponse>;
  targetChars?: number;
  minChunkChars?: number;
  softTimeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DocumentProgress) => void;
}

class SoftTimeoutError extends Error {
  constructor() {
    super('DOCUMENT_CHUNK_SOFT_TIMEOUT');
    this.name = 'SoftTimeoutError';
  }
}

function targetLanguage(source: string): string {
  return source === 'zh' ? 'en' : 'zh';
}

function documentContext(input: DocumentTranslationInput, title: string | null, previousSource: string): string {
  const source = detectDocumentLanguage(input.text);
  const sections = [input.context?.trim()].filter(Boolean) as string[];
  sections.push(
    '【文档翻译上下文】',
    `源语言：${source}；目标语言：${targetLanguage(source)}；模式：${input.mode || 'auto'}。`,
  );
  if (title) sections.push(`文档标题：${title}`);
  if (input.terminology?.trim()) sections.push('已确认术语和专有名词以 Terminology 为准。');
  if (previousSource) {
    sections.push(`前文结尾（只用于保持术语和语气，不要重复翻译）：${previousSource.slice(-240)}`);
  }
  return sections.join('\n');
}

async function withSoftTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  userSignal?: AbortSignal,
): Promise<T> {
  if (userSignal?.aborted) throw userSignal.reason ?? new DOMException('Aborted', 'AbortError');
  const controller = new AbortController();
  const onUserAbort = () => controller.abort(userSignal?.reason ?? new DOMException('Aborted', 'AbortError'));
  userSignal?.addEventListener('abort', onUserAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new SoftTimeoutError();
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    userSignal?.removeEventListener('abort', onUserAbort);
  }
}

function isSoftTimeout(error: unknown): boolean {
  return error instanceof SoftTimeoutError || (error instanceof Error && error.message === 'DOCUMENT_CHUNK_SOFT_TIMEOUT');
}

export async function translateDocument(
  input: DocumentTranslationInput,
  dependencies: DocumentTranslationDependencies = {},
): Promise<TranslationResponse> {
  const translateChunk = dependencies.translateChunk ?? translateStream;
  const softTimeoutMs = dependencies.softTimeoutMs ?? 95_000;
  const minChunkChars = dependencies.minChunkChars ?? 500;
  const title = extractDocumentTitle(input.text);
  const initialChunks = chunkDocument(input.text, { targetChars: dependencies.targetChars });
  const totalChars = Math.max(1, input.text.length);
  const translatedParts: string[] = [];
  const notes: TranslationResponse['notes'] = [];
  let completedChars = 0;
  let previousSource = '';
  let sourceLanguage: string = detectDocumentLanguage(input.text);
  let resolvedTargetLanguage = targetLanguage(sourceLanguage);
  let detectedStyle: TranslationResponse['detected_style'];

  const report = (status: DocumentProgressStatus, current = '') => {
    const percent = status === 'assembling' ? 100 : Math.min(99, Math.round((completedChars / totalChars) * 100));
    dependencies.onProgress?.({ percent, status, provisionalText: translatedParts.join('') + current });
  };

  report('analyzing');

  const processTranslatable = async (text: string, splitTarget: number): Promise<void> => {
    let provisional = '';
    const request: TranslationRequest = {
      text,
      mode: input.mode,
      context: documentContext(input, title, previousSource),
      terminology: input.terminology,
      preserveNames: input.preserveNames,
      explainTranslation: input.explainTranslation,
    };

    for (let localAttempt = 0; localAttempt < 2; localAttempt++) {
      try {
        const response = await withSoftTimeout(
          (signal) => translateChunk(request, {
            onDelta: (delta) => {
              if (signal.aborted) return;
              provisional += delta;
              report('translating', provisional);
            },
            onReset: () => {
              if (signal.aborted) return;
              provisional = '';
              report('retrying-part');
            },
          }, signal),
          softTimeoutMs,
          dependencies.signal,
        );
        sourceLanguage = response.source_language || sourceLanguage;
        resolvedTargetLanguage = response.target_language || resolvedTargetLanguage;
        detectedStyle ||= response.detected_style;
        translatedParts.push(response.translation);
        notes.push(...(response.notes || []));
        completedChars += text.length;
        previousSource = text;
        report('translating');
        return;
      } catch (error) {
        if (dependencies.signal?.aborted) throw dependencies.signal.reason ?? error;
        if (isSoftTimeout(error)) {
          const nextTarget = Math.max(minChunkChars, Math.floor(splitTarget / 2));
          const smaller = chunkDocument(text, { targetChars: nextTarget });
          if (smaller.length <= 1 || nextTarget >= text.length) throw error;
          report('retrying-part');
          for (const part of smaller) {
            if (part.translatable) await processTranslatable(part.text, nextTarget);
            else {
              translatedParts.push(part.text);
              completedChars += part.text.length;
              previousSource = part.text;
            }
          }
          return;
        }
        if (localAttempt === 0) {
          provisional = '';
          report('retrying-part');
          continue;
        }
        throw error;
      }
    }
  };

  const initialTarget = dependencies.targetChars ?? Math.max(...initialChunks.map((chunk) => chunk.text.length), minChunkChars);
  for (const chunk of initialChunks) {
    if (dependencies.signal?.aborted) throw dependencies.signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (chunk.translatable) {
      await processTranslatable(chunk.text, initialTarget);
    } else {
      translatedParts.push(chunk.text);
      completedChars += chunk.text.length;
      previousSource = chunk.text;
      report('translating');
    }
  }

  report('assembling');
  return {
    source_language: sourceLanguage,
    target_language: resolvedTargetLanguage,
    detected_style: input.mode && input.mode !== 'auto'
      ? input.mode as TranslationResponse['detected_style']
      : detectedStyle,
    translation: translatedParts.join(''),
    detected_text: null,
    segments: [],
    notes,
  };
}
