import { CORPUS_LIMITS, requireBilingualDirection, type CorpusProject, type SourceSpan } from './types';
import { assertCorpusCoverage } from '../alignment/corpusAlign';
import { validateInlineMarkup } from './tmx';

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const string = (value: unknown, limit: number = CORPUS_LIMITS.expandedCharacters): value is string => typeof value === 'string' && value.length <= limit;

export function validateCorpusProject(value: unknown): CorpusProject {
  if (!object(value) || value.formatVersion !== 1 || !string(value.id, 200) || !string(value.name, 500)
    || !string(value.sourceLanguage, 100) || !string(value.targetLanguage, 100)
    || !Array.isArray(value.languages) || !value.languages.every(language => string(language, 100))
    || !['tmx', 'rtf', 'alignment'].includes(String(value.origin))
    || !Array.isArray(value.documents) || value.documents.length > 100
    || !Array.isArray(value.units) || !Array.isArray(value.warnings)
    || value.units.length > CORPUS_LIMITS.units || value.warnings.length > 30_000
    || !string(value.createdAt, 100) || !string(value.updatedAt, 100)) throw new Error('不是有效的语料项目，或项目版本不受支持。');
  requireBilingualDirection(value.sourceLanguage, value.targetLanguage);
  if (value.tmxHeader !== undefined && !string(value.tmxHeader, CORPUS_LIMITS.inputBytes)) throw new Error('项目 TMX 头无效。');
  for (const warning of value.warnings) if (!object(warning) || !string(warning.message, 10_000) || warning.unitId !== undefined && !string(warning.unitId, 200)) throw new Error('项目诊断字段无效。');
  const blocks = new Map<string, string>();
  const documentIds = new Set<string>();
  let characters = 0;
  for (const document of value.documents) {
    if (!object(document) || !string(document.id, 200) || documentIds.has(document.id)
      || !string(document.name, 500) || !string(document.language, 100) || !Array.isArray(document.blocks)
      || document.blocks.length > CORPUS_LIMITS.blocks) throw new Error('项目原文档字段无效。');
    documentIds.add(document.id);
    for (const block of document.blocks) {
      if (!object(block) || !string(block.id, 200) || !string(block.text) || !['paragraph', 'heading', 'list', 'cell'].includes(String(block.kind))) throw new Error('项目原文块无效。');
      const key = document.id + '/' + block.id;
      if (blocks.has(key)) throw new Error('项目包含重复的原文块。');
      blocks.set(key, block.text); characters += block.text.length;
    }
  }
  if (characters > CORPUS_LIMITS.expandedCharacters * 4) throw new Error('项目展开后的原文过大。');
  const validRef = (ref: unknown): ref is SourceSpan => {
    if (!object(ref) || !string(ref.documentId, 200) || !string(ref.blockId, 200)
      || !Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end)) return false;
    const text = blocks.get(ref.documentId + '/' + ref.blockId);
    return text !== undefined && Number(ref.start) >= 0 && Number(ref.end) >= Number(ref.start) && Number(ref.end) <= text.length;
  };
  const excluded = value.excludedUnits || [];
  if (!Array.isArray(excluded) || excluded.length + value.units.length > CORPUS_LIMITS.units) throw new Error('项目中的排除记录无效或过多。');
  if (value.excludedPlacement !== undefined) {
    if (!object(value.excludedPlacement) || Object.keys(value.excludedPlacement).length > CORPUS_LIMITS.units) throw new Error('项目排除位置字段无效。');
    for (const placement of Object.values(value.excludedPlacement)) {
      if (!object(placement) || placement.before !== undefined && !string(placement.before, 200)
        || placement.after !== undefined && !string(placement.after, 200)) throw new Error('项目排除位置字段无效。');
    }
  }
  const ids = new Set<string>();
  for (const unit of [...value.units, ...excluded]) {
    if (!object(unit) || !string(unit.id, 200) || ids.has(unit.id) || !Array.isArray(unit.variants) || unit.variants.length > 100
      || !['unreviewed', 'edited', 'confirmed'].includes(String(unit.review)) || typeof unit.locked !== 'boolean'
      || !['imported', 'automatic', 'manual'].includes(String(unit.provenance)) || !object(unit.metadata)
      || unit.tmxTu !== undefined && !string(unit.tmxTu, CORPUS_LIMITS.inputBytes)
      || unit.score !== undefined && (typeof unit.score !== 'number' || !Number.isFinite(unit.score))) throw new Error('项目双语单元字段无效。');
    ids.add(unit.id);
    for (const values of Object.values(unit.metadata)) if (!Array.isArray(values) || values.length > 10_000 || !values.every(value => string(value, CORPUS_LIMITS.projectBytes))) throw new Error('项目自定义字段无效。');
    for (const variant of unit.variants) {
      if (!object(variant) || !string(variant.language, 100) || !string(variant.text) || !string(variant.originalText)
        || !Array.isArray(variant.refs) || variant.refs.length > CORPUS_LIMITS.blocks || !variant.refs.every(validRef)
        || variant.tmxTuv !== undefined && !string(variant.tmxTuv, CORPUS_LIMITS.inputBytes)) throw new Error('项目语言变体或来源范围无效。');
      if (variant.markup !== undefined && (!string(variant.markup, CORPUS_LIMITS.inputBytes)
        || validateInlineMarkup(variant.markup).text !== variant.text)) throw new Error('项目文本和内联 XML 不一致。');
      if (variant.tmxOrigins !== undefined && (!Array.isArray(variant.tmxOrigins) || variant.tmxOrigins.length > CORPUS_LIMITS.units
        || !variant.tmxOrigins.every(value => string(value, CORPUS_LIMITS.inputBytes)))) throw new Error('项目变体的来源元数据无效。');
      if (variant.pieces !== undefined) {
        if (!Array.isArray(variant.pieces) || variant.pieces.length > 30_000) throw new Error('项目拆合记录无效。');
        for (const piece of variant.pieces) {
          if (!object(piece) || !string(piece.text) || piece.ref !== undefined && (!validRef(piece.ref)
            || blocks.get(piece.ref.documentId + '/' + piece.ref.blockId)!.slice(piece.ref.start, piece.ref.end) !== piece.text)) throw new Error('项目拆合记录的原文位置不一致。');
        }
        if (variant.pieces.map(piece => piece.text).join('') !== variant.originalText) throw new Error('项目拆合记录不完整。');
      }
    }
  }
  const project = value as unknown as CorpusProject;
  if (project.origin === 'alignment') assertCorpusCoverage(project);
  return project;
}

export function serializeProject(project: CorpusProject): Uint8Array {
  validateCorpusProject(project);
  const bytes = new TextEncoder().encode(JSON.stringify(project));
  if (bytes.length > CORPUS_LIMITS.projectBytes) throw new Error('项目超过 30 MiB 保存上限，请分批处理。');
  return bytes;
}
export function parseProject(bytes: Uint8Array): CorpusProject {
  if (bytes.length > CORPUS_LIMITS.projectBytes) throw new Error('项目文件超过 30 MiB 上限。');
  return validateCorpusProject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('silvite-corpus-project', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('浏览器本地项目存储不可用。'));
    request.onblocked = () => reject(new Error('请关闭其他正在保存项目的窗口后重试。'));
  });
}
async function writeProjectLocally(project: CorpusProject): Promise<void> {
  serializeProject(project);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('projects', 'readwrite');
      transaction.objectStore('projects').put(project, 'latest');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('本地保存失败，可能是存储空间不足；请下载项目文件。'));
      transaction.onabort = transaction.onerror;
    });
  } finally { db.close(); }
}
let saveQueue: Promise<void> = Promise.resolve();
export function saveProjectLocally(project: CorpusProject): Promise<void> {
  const result = saveQueue.catch(() => {}).then(() => writeProjectLocally(project));
  saveQueue = result;
  return result;
}
export async function loadLocalProject(): Promise<CorpusProject | null> {
  const db = await openDatabase();
  try {
    const data = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('projects', 'readonly').objectStore('projects').get('latest');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('未能恢复本地项目。'));
    });
    return data ? validateCorpusProject(data) : null;
  } finally { db.close(); }
}
