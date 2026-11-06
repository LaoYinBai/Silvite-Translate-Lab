import { effectiveInputMode, useTranslationStore, type TranslationResult } from '../../store/translationStore';
import { hydrateHistory, reportHistoryError, saveHistoryRecord } from '../../store/historyStore';
import type { HistoryAlignment, HistoryRecord, HistoryRequest, HistoryResult } from './types';
import { validateHistoryRecord } from './validation';

type TranslationState = ReturnType<typeof useTranslationStore.getState>;
type IdentifiedResult = TranslationResult & { id?: string; completedAt?: string };
interface RequestSnapshot {
  fallbackId: string;
  requestedAt: string;
  sourceText: string;
  settings: HistoryRequest;
  record: HistoryRecord | null;
}

let started = false;
let restoring = false;
let active: RequestSnapshot | null = null;
let invocation: RequestSnapshot | null = null;

function capture(state: TranslationState, scannedPdf = false): RequestSnapshot {
  const inputMode = scannedPdf ? 'file' : effectiveInputMode(state);
  return {
    fallbackId: `translation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`,
    requestedAt: new Date().toISOString(),
    sourceText: inputMode === 'file' ? state.documentFile?.text || '' : inputMode === 'text' ? state.inputText : '',
    settings: {
      model: state.model, mode: state.mode, context: state.context, terminology: state.terminology,
      preserveNames: state.preserveNames, explainTranslation: state.explainTranslation,
      showTranslationNotes: state.showTranslationNotes, inputMode,
    },
    record: null,
  };
}

function copyAlignment(alignment: HistoryAlignment): HistoryAlignment {
  // Explicit whitelist: do not persist extra provider payloads or diagnostics.
  return {
    sourceText: alignment.sourceText, targetText: alignment.targetText,
    sourceLanguage: alignment.sourceLanguage, targetLanguage: alignment.targetLanguage,
    rows: alignment.rows.map(row => ({
      id: row.id, needsCheck: row.needsCheck,
      source: row.source ? { start: row.source.start, end: row.source.end, firstParagraph: row.source.firstParagraph, lastParagraph: row.source.lastParagraph } : null,
      target: row.target ? { start: row.target.start, end: row.target.end, firstParagraph: row.target.firstParagraph, lastParagraph: row.target.lastParagraph } : null,
    })),
    ...(alignment.method === undefined ? {} : { method: alignment.method }),
    ...(alignment.granularity === undefined ? {} : { granularity: alignment.granularity }),
  };
}

function copyResult(result: IdentifiedResult): HistoryResult {
  return {
    ...(result.id === undefined ? {} : { id: result.id }),
    ...(result.completedAt === undefined ? {} : { completedAt: result.completedAt }),
    sourceLanguage: result.sourceLanguage, targetLanguage: result.targetLanguage, translation: result.translation,
    segments: result.segments.map(segment => ({
      type: segment.type, source: segment.source, translation: segment.translation,
      ...(segment.panel === undefined ? {} : { panel: segment.panel }),
      ...(segment.order === undefined ? {} : { order: segment.order }),
      ...(segment.speaker === undefined ? {} : { speaker: segment.speaker }),
      ...(segment.id === undefined ? {} : { id: segment.id }),
      ...(segment.reply_to === undefined ? {} : { reply_to: segment.reply_to }),
    })),
    notes: result.notes.map(note => ({ source: note.source, translation: note.translation, reason: note.reason })),
    ...(result.detectedText === undefined ? {} : { detectedText: result.detectedText }),
    ...(result.paragraphAlignment === undefined ? {} : { paragraphAlignment: copyAlignment(result.paragraphAlignment) }),
    ...(result.alignmentStatus === undefined ? {} : { alignmentStatus: result.alignmentStatus }),
  };
}

function observe(state: TranslationState, previous: TranslationState): void {
  if (restoring) return;
  if (state.isDemoMode || state.error || (!state.result && !state.isLoading)) {
    active = null;
    return;
  }
  if (state.isLoading && state.isStreaming && !state.result) {
    // The synchronous action scope disambiguates a second request while the
    // first is still loading, even when the reset notification has equal values.
    if (invocation && active !== invocation) active = invocation;
    else if (!invocation && (!previous.isLoading || !previous.isStreaming || previous.result !== null)) active = capture(state);
    return;
  }
  if (!active || state.isLoading || state.isStreaming || !state.result || state.result.source !== 'real') return;
  if (state.result === previous.result && !previous.isLoading && !previous.isStreaming) return;
  const result = state.result as IdentifiedResult;
  const request = active;
  const sourceText = result.sourceText ?? result.detectedText ?? request.sourceText;
  const prior = request.record;
  const id = result.id ?? prior?.id ?? request.fallbackId;
  // An unrelated/restored result cannot acquire the active request's metadata.
  if (prior && (prior.id !== id || prior.sourceText !== sourceText || prior.result.translation !== result.translation
    || prior.result.sourceLanguage !== result.sourceLanguage || prior.result.targetLanguage !== result.targetLanguage)) return;
  if (!result.translation.trim()) return;
  try {
    const completedAt = result.completedAt ?? prior?.completedAt ?? new Date().toISOString();
    const record = validateHistoryRecord({
      id, requestedAt: request.requestedAt, completedAt, updatedAt: new Date().toISOString(),
      sourceText, request: request.settings, result: copyResult(result),
    });
    request.record = record;
    void saveHistoryRecord(record, !prior).catch(() => { /* Store exposes the failure and retains the latest snapshot for retry. */ });
  } catch (error) { reportHistoryError(error); }
}

export function startHistoryTracking(): void {
  if (started) return;
  started = true;
  useTranslationStore.subscribe(observe);
  const original = useTranslationStore.getState();
  // Keep the request implementation untouched. These transparent action
  // decorators only scope its synchronous start notification; the subscriber
  // alone observes completion. A loading boolean cannot identify rapid starts.
  const withRequest = (run: () => Promise<void>, scannedPdf = false) => () => {
    const previous = invocation;
    invocation = capture(useTranslationStore.getState(), scannedPdf);
    try { return run(); }
    finally { invocation = previous; }
  };
  useTranslationStore.setState({
    translate: withRequest(original.translate),
    translateScannedPdf: withRequest(original.translateScannedPdf, true),
  });
  // Deliberately app-lifetime: StrictMode effect replay must not install a
  // second subscription or leave a gap while IndexedDB is hydrating.
  if (original.isLoading && original.isStreaming && !original.result) active = capture(original);
  void hydrateHistory().catch(() => { /* Visible in HistoryStatus. */ });
}

export function restoreHistoryRecord(value: HistoryRecord): void {
  const record = validateHistoryRecord(value);
  restoring = true;
  active = null;
  try {
    // reset aborts the old request/alignment generation before any restored
    // state is installed. No translation action or input setter is invoked.
    useTranslationStore.getState().reset();
    const result: TranslationResult = {
      ...record.result, source: 'real', sourceText: record.sourceText,
      id: record.result.id ?? record.id,
      completedAt: record.result.completedAt ?? record.completedAt,
      alignmentStatus: record.result.alignmentStatus === 'pending'
        ? record.result.paragraphAlignment ? 'ready' : 'unavailable'
        : record.result.alignmentStatus,
    };
    useTranslationStore.setState({
      inputText: record.sourceText, result,
      model: record.request.model, mode: record.request.mode, context: record.request.context, terminology: record.request.terminology,
      preserveNames: record.request.preserveNames, explainTranslation: record.request.explainTranslation,
      showTranslationNotes: record.request.showTranslationNotes,
    });
    // A later explicit alignment regeneration can update this existing row,
    // while restoration itself remains excluded from automatic persistence.
    active = {
      fallbackId: record.id, requestedAt: record.requestedAt, sourceText: record.sourceText,
      settings: record.request, record,
    };
  } finally { restoring = false; }
}
