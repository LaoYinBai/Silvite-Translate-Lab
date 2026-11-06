import { API_BASE_URL, type TranslationModelId } from './client';
import {
  bilingualLanguage,
  type ParagraphAlignment,
  type ParagraphAlignmentInput,
  type ParagraphPair,
  type ParagraphRange,
} from '../services/alignment/paragraphs';

const MAX_CHARACTERS = 12_000;
const MAX_ROWS = 256;
const MAX_RESPONSE_BYTES = 96 * 1024;
const REQUEST_TIMEOUT_MS = 85_000;

export class AiAlignmentError extends Error {
  readonly code: string;

  constructor(code: string, message = 'AI 对照分段暂不可用，已保留脚本分段。') {
    super(message);
    this.name = 'AiAlignmentError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWellFormedText(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function isTextBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}

function hasInternalClauseBreak(text: string): boolean {
  for (const match of text.matchAll(/[,，;；。！？!?]|\.(?=\s|$)/g)) {
    const at = match.index;
    if (/[,，]/.test(match[0]) && /\d/.test(text[at - 1] || '') && /\d/.test(text[at + 1] || '')) continue;
    if (text.slice(0, at).trim() && text.slice(at + 1).trim()) return true;
  }
  return false;
}

function validateRows(value: unknown, sourceText: string, targetText: string): ParagraphPair[] {
  const invalid = () => new AiAlignmentError('ALIGNMENT_INVALID_RESPONSE');
  if (!isRecord(value) || value.version !== 1 || value.method !== 'ai' || value.granularity !== 'segment'
    || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > MAX_ROWS) throw invalid();
  const texts = { source: sourceText, target: targetText };
  const cursors = { source: 0, target: 0 };
  const ordinals = { source: 0, target: 0 };
  const rows: ParagraphPair[] = [];
  for (const raw of value.rows) {
    if (!isRecord(raw) || raw.id !== `ai-paragraph-${rows.length + 1}` || typeof raw.needsCheck !== 'boolean') throw invalid();
    const row: ParagraphPair = { id: `ai-paragraph-${rows.length + 1}`, source: null, target: null, needsCheck: raw.needsCheck };
    for (const side of ['source', 'target'] as const) {
      const range = raw[side];
      if (range === null) continue;
      if (!isRecord(range)) throw invalid();
      const { start, end, firstParagraph, lastParagraph } = range;
      if (typeof start !== 'number' || typeof end !== 'number' || typeof firstParagraph !== 'number' || typeof lastParagraph !== 'number'
        || ![start, end, firstParagraph, lastParagraph].every(Number.isSafeInteger)
        || start !== cursors[side] || end <= start || end > texts[side].length
        || firstParagraph !== ordinals[side] + 1 || lastParagraph !== firstParagraph
        || !isTextBoundary(texts[side], start) || !isTextBoundary(texts[side], end)) throw invalid();
      const validated: ParagraphRange = { start, end, firstParagraph, lastParagraph };
      row[side] = validated;
      cursors[side] = end;
      ordinals[side]++;
    }
    if (!row.source && !row.target) throw invalid();
    const sourceContent = row.source && sourceText.slice(row.source.start, row.source.end).trim();
    const targetContent = row.target && targetText.slice(row.target.start, row.target.end).trim();
    if (!sourceContent && !targetContent) throw invalid();
    row.needsCheck ||= !sourceContent || !targetContent;
    rows.push(row);
  }
  if (cursors.source !== sourceText.length || cursors.target !== targetText.length) throw invalid();
  const hasMultipleGroups = (['source', 'target'] as const).some(side => rows.filter(row => {
    const range = row[side];
    return range && texts[side].slice(range.start, range.end).trim();
  }).length >= 2);
  if (!hasMultipleGroups && sourceText.length + targetText.length >= 240
    && (hasInternalClauseBreak(sourceText) || hasInternalClauseBreak(targetText))) {
    throw new AiAlignmentError('ALIGNMENT_NOT_SEGMENTED', 'AI 尚未拆分长段，已保留脚本分段。');
  }
  return rows;
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new AiAlignmentError('ALIGNMENT_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new AiAlignmentError('ALIGNMENT_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    signal.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new AiAlignmentError('ALIGNMENT_RESPONSE_TOO_LARGE');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

export async function requestAiAlignment(
  input: ParagraphAlignmentInput,
  model: TranslationModelId,
  signal: AbortSignal,
): Promise<ParagraphAlignment> {
  signal.throwIfAborted();
  const sourceLanguage = bilingualLanguage(input.sourceLanguage);
  const targetLanguage = bilingualLanguage(input.targetLanguage);
  if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage
    || !input.sourceText.trim() || !input.targetText.trim()
    || input.sourceText.length + input.targetText.length > MAX_CHARACTERS
    || !isWellFormedText(input.sourceText) || !isWellFormedText(input.targetText)
    || (model !== 'deepseek' && model !== 'glm')) throw new AiAlignmentError('ALIGNMENT_INVALID_INPUT');

  // Snapshot the original strings across the async request. Neither server
  // fields nor a later mutation of the caller's input can replace their text.
  const { sourceText, targetText } = input;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abortFromCaller, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/alignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceText, targetText, sourceLanguage, targetLanguage, model }),
      signal: controller.signal,
      cache: 'no-store',
    });
    const payload = await readBoundedJson(response, controller.signal);
    controller.signal.throwIfAborted();
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.error === 'string' ? payload.error : '';
      // Only application-owned error codes become observable, never arbitrary
      // response prose or an upstream error containing document data.
      if (code === 'ALIGNMENT_NOT_SEGMENTED') {
        throw new AiAlignmentError(code, 'AI 尚未拆分长段，已保留脚本分段。');
      }
      const known = ['RATE_LIMITED', 'SERVICE_OFFLINE', 'SERVICE_NOT_CONFIGURED', 'ALIGNMENT_TIMEOUT',
        'ALIGNMENT_INVALID_OUTPUT', 'ALIGNMENT_UPSTREAM_ERROR', 'ALIGNMENT_NETWORK_ERROR',
        'ALIGNMENT_CANCELLED', 'INVALID_REQUEST', 'REQUEST_TOO_LARGE', 'ORIGIN_NOT_ALLOWED'];
      throw new AiAlignmentError(known.includes(code) ? code : 'ALIGNMENT_REQUEST_FAILED');
    }
    const alignment: ParagraphAlignment & { method: 'ai'; granularity: 'segment' } = {
      sourceText, targetText, sourceLanguage, targetLanguage,
      method: 'ai', granularity: 'segment',
      rows: validateRows(payload, sourceText, targetText),
    };
    return alignment;
  } catch (error) {
    if (signal.aborted) throw signal.reason || new DOMException('Alignment cancelled', 'AbortError');
    if (timedOut) throw new AiAlignmentError('ALIGNMENT_TIMEOUT');
    if (error instanceof AiAlignmentError) throw error;
    throw new AiAlignmentError('ALIGNMENT_REQUEST_FAILED');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abortFromCaller);
  }
}
