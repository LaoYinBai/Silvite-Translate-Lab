import { HISTORY_LIMITS, type HistoryAlignment, type HistoryBackup, type HistoryRecord, type HistoryRequest, type HistoryResult } from './types';
import type { TranslationNote, TranslationSegment, TranslationSegmentType } from '../../store/translationStore';
import { bilingualLanguage } from '../alignment/paragraphs';

type ObjectValue = Record<string, unknown>;
const MODES = ['auto', 'natural', 'literary', 'academic', 'business', 'comic'] as const;
const SEGMENTS: TranslationSegmentType[] = ['dialogue', 'narration', 'sound_effect', 'title', 'ui_text', 'sign', 'caption', 'background_text', 'text'];

function invalid(field: string): never { throw new Error(`历史数据格式无效：${field}。未修改已有记录。`); }
function object(value: unknown, field: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(field);
  return value as ObjectValue;
}
function keys(value: ObjectValue, allowed: string[], field: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${field} 包含不支持的字段`);
}
function string(value: unknown, field: string, max: number = HISTORY_LIMITS.textCharacters): string {
  if (typeof value !== 'string' || value.length > max) invalid(field);
  return value;
}
function identifier(value: unknown, field: string): string {
  const id = string(value, field, 200);
  if (!id.trim() || Array.from(id).some(character => character.charCodeAt(0) < 32)) invalid(field);
  return id;
}
function date(value: unknown, field: string): string {
  const text = string(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) invalid(field);
  return text;
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid(field);
  return value;
}
function choice<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) invalid(field);
  return value as T[number];
}
function integer(value: unknown, field: string, min = 0, max: number = HISTORY_LIMITS.textCharacters): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(field);
  return value;
}
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > HISTORY_LIMITS.items) invalid(field);
  return value;
}
function request(value: unknown): HistoryRequest {
  const v = object(value, '请求设置');
  keys(v, ['model', 'mode', 'context', 'terminology', 'preserveNames', 'explainTranslation', 'showTranslationNotes', 'inputMode'], '请求设置');
  return {
    model: choice(v.model, ['deepseek', 'glm'], '模型'), mode: choice(v.mode, MODES, '翻译模式'),
    context: string(v.context, '上下文'), terminology: string(v.terminology, '术语'),
    preserveNames: bool(v.preserveNames, '保留专名'), explainTranslation: bool(v.explainTranslation, '翻译说明偏好'),
    showTranslationNotes: bool(v.showTranslationNotes, '说明显示偏好'), inputMode: choice(v.inputMode, ['text', 'image', 'file'], '输入类型'),
  };
}
function segment(value: unknown): TranslationSegment {
  const v = object(value, '译文片段');
  keys(v, ['type', 'source', 'translation', 'panel', 'order', 'speaker', 'id', 'reply_to'], '译文片段');
  const out: TranslationSegment = { type: choice(v.type, SEGMENTS, '片段类型'), source: string(v.source, '片段原文'), translation: string(v.translation, '片段译文') };
  if (v.panel !== undefined) out.panel = integer(v.panel, '分镜编号');
  if (v.order !== undefined) out.order = integer(v.order, '阅读顺序');
  if (v.speaker !== undefined) out.speaker = v.speaker === null ? null : string(v.speaker, '说话人', 10_000);
  if (v.id !== undefined) out.id = identifier(v.id, '片段 ID');
  if (v.reply_to !== undefined) out.reply_to = v.reply_to === null ? null : identifier(v.reply_to, '回复 ID');
  return out;
}
function note(value: unknown): TranslationNote {
  const v = object(value, '翻译说明');
  keys(v, ['source', 'translation', 'reason'], '翻译说明');
  return { source: string(v.source, '说明原文'), translation: string(v.translation, '说明译文'), reason: string(v.reason, '说明原因') };
}

function alignment(value: unknown, sourceText: string, targetText: string, source: string, target: string): HistoryAlignment {
  const v = object(value, '分段对齐');
  keys(v, ['sourceText', 'targetText', 'sourceLanguage', 'targetLanguage', 'rows', 'method', 'granularity'], '分段对齐');
  if (v.sourceText !== sourceText || v.targetText !== targetText) invalid('对齐文本与原文、完整译文不一致');
  const sourceLanguage = choice(v.sourceLanguage, ['zh', 'en'], '对齐源语言');
  const targetLanguage = choice(v.targetLanguage, ['zh', 'en'], '对齐目标语言');
  if (sourceLanguage === targetLanguage) invalid('对齐语言方向');
  if (sourceLanguage !== bilingualLanguage(source) || targetLanguage !== bilingualLanguage(target)) invalid('对齐方向与翻译结果不一致');
  let sourceEnd = 0, targetEnd = 0;
  const ids = new Set<string>();
  const rows = array(v.rows, '对齐行').map(row => {
    const r = object(row, '对齐行');
    keys(r, ['id', 'source', 'target', 'needsCheck'], '对齐行');
    const id = identifier(r.id, '对齐行 ID');
    if (ids.has(id)) invalid('对齐行 ID 重复');
    ids.add(id);
    const range = (raw: unknown, text: string, previousEnd: number) => {
      if (raw === null) return null;
      const span = object(raw, '对齐范围');
      keys(span, ['start', 'end', 'firstParagraph', 'lastParagraph'], '对齐范围');
      const start = integer(span.start, '对齐起点', 0, text.length);
      const end = integer(span.end, '对齐终点', start + 1, text.length);
      if (start !== previousEnd) invalid('对齐范围重叠或遗漏字符');
      // A range must not bisect a UTF-16 surrogate pair.
      for (const offset of [start, end]) {
        const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
        if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) invalid('对齐范围截断 Unicode 字符');
      }
      const firstParagraph = integer(span.firstParagraph, '首段编号', 1);
      return { start, end, firstParagraph, lastParagraph: integer(span.lastParagraph, '末段编号', firstParagraph) };
    };
    const source = range(r.source, sourceText, sourceEnd), target = range(r.target, targetText, targetEnd);
    if (!source && !target) invalid('空对齐行');
    if (source) sourceEnd = source.end;
    if (target) targetEnd = target.end;
    return { id, source, target, needsCheck: bool(r.needsCheck, '待核对标记') };
  });
  if (sourceEnd !== sourceText.length || targetEnd !== targetText.length) invalid('对齐范围未覆盖全部字符');
  const out: HistoryAlignment = { sourceText, targetText, sourceLanguage, targetLanguage, rows };
  if (v.method !== undefined) out.method = choice(v.method, ['script', 'ai'], '对齐方法');
  if (v.granularity !== undefined) out.granularity = choice(v.granularity, ['segment', 'paragraph'], '对齐粒度');
  return out;
}

export function validateHistoryRecord(value: unknown): HistoryRecord {
  const v = object(value, '记录');
  keys(v, ['id', 'requestedAt', 'completedAt', 'updatedAt', 'sourceText', 'request', 'result'], '记录');
  const sourceText = string(v.sourceText, '原文'), r = object(v.result, '翻译结果');
  keys(r, ['id', 'completedAt', 'sourceLanguage', 'targetLanguage', 'translation', 'segments', 'notes', 'detectedText', 'paragraphAlignment', 'alignmentStatus'], '翻译结果');
  const result: HistoryResult = {
    sourceLanguage: string(r.sourceLanguage, '源语言', 100), targetLanguage: string(r.targetLanguage, '目标语言', 100),
    translation: string(r.translation, '完整译文'), segments: array(r.segments, '译文片段').map(segment), notes: array(r.notes, '翻译说明').map(note),
  };
  if (!result.translation.trim() || !result.sourceLanguage.trim() || !result.targetLanguage.trim()) invalid('完整译文或语言为空');
  if (r.id !== undefined) result.id = identifier(r.id, '结果 ID');
  if (r.completedAt !== undefined) result.completedAt = date(r.completedAt, '结果完成时间');
  if (r.detectedText !== undefined) result.detectedText = string(r.detectedText, '识别原文');
  if (r.paragraphAlignment !== undefined) result.paragraphAlignment = alignment(r.paragraphAlignment, sourceText, result.translation, result.sourceLanguage, result.targetLanguage);
  if (r.alignmentStatus !== undefined) result.alignmentStatus = choice(r.alignmentStatus, ['pending', 'ready', 'unavailable'], '对齐状态');
  if (result.alignmentStatus === 'ready' && !result.paragraphAlignment) invalid('就绪的对齐缺少数据');
  const record: HistoryRecord = {
    id: identifier(v.id, '记录 ID'), requestedAt: date(v.requestedAt, '请求时间'), completedAt: date(v.completedAt, '完成时间'),
    updatedAt: date(v.updatedAt, '更新时间'), sourceText, request: request(v.request), result,
  };
  if (result.id !== undefined && result.id !== record.id) invalid('结果 ID 与记录 ID 不一致');
  if (result.completedAt !== undefined && result.completedAt !== record.completedAt) invalid('结果完成时间不一致');
  if (record.completedAt < record.requestedAt || record.updatedAt < record.completedAt) invalid('记录时间顺序');
  if (jsonBytes(record) > HISTORY_LIMITS.recordBytes) throw new Error('单条历史超过 6 MiB，未保存。完整译文仍可在翻译页查看、复制或导出。');
  return record;
}

export function jsonBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
export function assertCollectionLimits(records: HistoryRecord[]): void {
  if (records.length > HISTORY_LIMITS.records) throw new Error('本地历史最多保存 1,000 条。请先导出并删除部分历史，再重试；已有记录不会自动删除。');
  if (jsonBytes(records) > HISTORY_LIMITS.collectionBytes) throw new Error('本地历史已超过 28 MiB 上限。请先导出并删除部分历史，再重试；已有记录不会自动删除。');
}

export function parseHistoryBackup(text: string): HistoryRecord[] {
  if (new TextEncoder().encode(text).byteLength > HISTORY_LIMITS.backupBytes) throw new Error('历史备份文件不能超过 30 MiB。');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('无法解析 JSON 备份，已有历史未改变。'); }
  const backup = object(raw, '备份');
  keys(backup, ['format', 'version', 'exportedAt', 'records'], '备份');
  if (backup.format !== 'silvite-translation-history' || backup.version !== 1) throw new Error('不支持的历史备份格式或版本，已有历史未改变。');
  date(backup.exportedAt, '导出时间');
  if (!Array.isArray(backup.records) || backup.records.length > HISTORY_LIMITS.records) throw new Error('一份备份最多包含 1,000 条历史。');
  const ids = new Set<string>();
  const records = backup.records.map(value => {
    const record = validateHistoryRecord(value);
    if (ids.has(record.id)) invalid('备份内记录 ID 重复');
    ids.add(record.id);
    return record;
  });
  assertCollectionLimits(records);
  return records;
}

export function serializeHistoryBackup(records: HistoryRecord[]): string {
  const safe = records.map(validateHistoryRecord);
  assertCollectionLimits(safe);
  const backup: HistoryBackup = { format: 'silvite-translation-history', version: 1, exportedAt: new Date().toISOString(), records: safe };
  const text = JSON.stringify(backup);
  if (new TextEncoder().encode(text).byteLength > HISTORY_LIMITS.backupBytes) throw new Error('导出的备份超过 30 MiB 上限。');
  return text;
}
