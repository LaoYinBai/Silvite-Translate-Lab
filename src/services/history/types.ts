import type { TranslationModelId } from '../../api/client';
import type { ParagraphAlignment } from '../alignment/paragraphs';
import type { InputMode, TranslationMode, TranslationNote, TranslationSegment } from '../../store/translationStore';

export const HISTORY_LIMITS = Object.freeze({
  records: 1_000,
  backupBytes: 30 * 1024 * 1024,
  // Leave room for the backup envelope; every stored collection is exportable.
  collectionBytes: 28 * 1024 * 1024,
  recordBytes: 6 * 1024 * 1024,
  textCharacters: 2_000_000,
  items: 20_000,
});

export type HistoryAlignment = ParagraphAlignment & {
  method?: 'script' | 'ai';
  granularity?: 'segment' | 'paragraph';
};

export interface HistoryRequest {
  model: TranslationModelId;
  mode: TranslationMode;
  context: string;
  terminology: string;
  preserveNames: boolean;
  explainTranslation: boolean;
  showTranslationNotes: boolean;
  inputMode: InputMode;
}

export interface HistoryResult {
  id?: string;
  completedAt?: string;
  sourceLanguage: string;
  targetLanguage: string;
  translation: string;
  segments: TranslationSegment[];
  notes: TranslationNote[];
  detectedText?: string;
  paragraphAlignment?: HistoryAlignment;
  alignmentStatus?: 'pending' | 'ready' | 'unavailable';
}

export interface HistoryRecord {
  id: string;
  requestedAt: string;
  completedAt: string;
  updatedAt: string;
  sourceText: string;
  request: HistoryRequest;
  result: HistoryResult;
}

export interface HistoryBackup {
  format: 'silvite-translation-history';
  version: 1;
  exportedAt: string;
  records: HistoryRecord[];
}

export interface HistoryImportSummary { added: number; skipped: number }

export function historyErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return '浏览器存储空间不足，历史未保存。请导出已有记录，删除部分历史或释放浏览器空间后重试。';
    if (error.name === 'SecurityError' || error.name === 'NotAllowedError') return '浏览器禁止本地数据库访问。请允许此网站存储数据，或退出受限的隐私浏览模式后重试。';
    if (error.name === 'AbortError') return '本地数据库事务已中止，原有历史未改变，请重试。';
  }
  return error instanceof Error ? error.message : '本地历史操作失败，请检查浏览器存储权限后重试。';
}
