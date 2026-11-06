import { CORPUS_LIMITS, corpusId, requireBilingualDirection, variantOf, type BilingualUnit, type CorpusProject, type UnitVariant } from './types';
import { validateInlineMarkup } from './tmx';

type Piece = NonNullable<UnitVariant['pieces']>[number];
const xmlAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const xmlText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
const ARCHIVE = 'x-silvite-merged-original-units';
const MERGE_VERSION = 'x-silvite-merge-version';
function originalUnits(unit: BilingualUnit): unknown[] {
  const version = unit.metadata[MERGE_VERSION]?.[0] || unit.metadata['prop:' + MERGE_VERSION]?.[0];
  if (version === '1') {
    try {
      const value = JSON.parse((unit.metadata[ARCHIVE] || unit.metadata['prop:' + ARCHIVE] || [])[0] || '');
      if (Array.isArray(value) && value.length <= CORPUS_LIMITS.units && value.every(item => item && typeof item === 'object'
        && typeof item.id === 'string' && item.metadata && typeof item.metadata === 'object')) return value;
    } catch { /* preserve unrecognized original fields in the leaf record */ }
  }
  return [{ id: unit.id, metadata: unit.metadata, tmxTu: unit.tmxTu,
    variants: unit.variants.map(side => ({ language: side.language, tmxTuv: side.tmxTuv, tmxOrigins: side.tmxOrigins })) }];
}
export const emptyVariant = (language: string): UnitVariant => ({ language, text: '', originalText: '', refs: [],
  tmxTuv: '<tuv xml:lang="' + xmlAttribute(language) + '"><seg/></tuv>' });
const stamp = (project: CorpusProject): CorpusProject => ({ ...project, updatedAt: new Date().toISOString() });
function mutableSide(unit: BilingualUnit, language: string): UnitVariant {
  const matches = unit.variants.filter(variant => variant.language === language);
  if (matches.length > 1) throw new Error('该行具有重复的 ' + language + ' 变体，无法确定编辑对象；原始变体已完整保留。');
  return matches[0] || emptyVariant(language);
}
function replaceSide(unit: BilingualUnit, side: UnitVariant): BilingualUnit {
  mutableSide(unit, side.language);
  const exists = unit.variants.some(variant => variant.language === side.language);
  return { ...unit, variants: exists ? unit.variants.map(variant => variant.language === side.language ? side : variant) : [...unit.variants, side],
    review: 'edited', locked: false, provenance: 'manual', score: undefined };
}
function editUnit(project: CorpusProject, id: string, change: (unit: BilingualUnit) => BilingualUnit): CorpusProject {
  if (!project.units.some(unit => unit.id === id)) throw new Error('当前对齐行已改变，请重新选择。');
  return stamp({ ...project, units: project.units.map(unit => unit.id === id ? change(unit) : unit) });
}
export function editVariant(project: CorpusProject, id: string, language: string, value: string, isMarkup = false): CorpusProject {
  if (value.length > CORPUS_LIMITS.expandedCharacters) throw new Error('单侧内容过长。');
  return editUnit(project, id, unit => {
    const side = mutableSide(unit, language);
    if (isMarkup) {
      const checked = validateInlineMarkup(value);
      return replaceSide(unit, { ...side, ...checked });
    }
    if (side.markup !== undefined && side.text !== value) throw new Error('该单元含行内标签，请使用“编辑标签 XML”保留标签关系。');
    return side.text === value ? unit : replaceSide(unit, { ...side, text: value });
  });
}
export function setReview(project: CorpusProject, ids: string[], confirmed: boolean): CorpusProject {
  return stamp({ ...project, units: project.units.map(unit => ids.includes(unit.id) ? { ...unit, review: confirmed ? 'confirmed' : 'unreviewed' } : unit) });
}
export function toggleAnchor(project: CorpusProject, id: string): CorpusProject {
  if (project.origin !== 'alignment') throw new Error('锚点用于双文档自动对齐；已配对的 TMX / RTF 可直接编辑和复核。');
  return editUnit(project, id, unit => {
    if (!unit.locked && (!variantOf(unit, project.sourceLanguage).refs.some(ref => ref.end > ref.start)
      || !variantOf(unit, project.targetLanguage).refs.some(ref => ref.end > ref.start))) throw new Error('锁定锚点需要两侧都有实际的原文范围。单侧内容可以标记为已复核。');
    return { ...unit, locked: !unit.locked };
  });
}
export function swapDirection(project: CorpusProject): CorpusProject {
  requireBilingualDirection(project.targetLanguage, project.sourceLanguage);
  return stamp({ ...project, sourceLanguage: project.targetLanguage, targetLanguage: project.sourceLanguage });
}
function piecesFor(project: CorpusProject, variant: UnitVariant): Piece[] {
  if (variant.pieces) return variant.pieces;
  const pieces: Piece[] = [];
  let previousBlock = '';
  for (const ref of variant.refs) {
    const document = project.documents.find(document => document.id === ref.documentId);
    const block = document?.blocks.find(block => block.id === ref.blockId);
    if (!block || ref.start < 0 || ref.end > block.text.length) throw new Error('该行的原文位置已失效。');
    const text = block.text.slice(ref.start, ref.end);
    if (!text.length) continue;
    const last = pieces.at(-1);
    if (last && previousBlock !== ref.blockId && !/\n$/.test(last.text)) pieces.push({ text: '\n\n' });
    pieces.push({ text, ref }); previousBlock = ref.blockId;
  }
  if (!variant.refs.length && variant.originalText) pieces.push({ text: variant.originalText });
  if (pieces.map(piece => piece.text).join('') !== variant.originalText) throw new Error('该行经过复杂结构编辑，暂不能直接拆分；可撤销修改后先拆分原始内容。');
  return pieces;
}
function slicePieces(pieces: Piece[], start: number, end: number): Piece[] {
  const result: Piece[] = [];
  let cursor = 0;
  for (const piece of pieces) {
    const from = Math.max(0, start - cursor), to = Math.min(piece.text.length, end - cursor);
    if (to > from) result.push({ text: piece.text.slice(from, to), ...(piece.ref ? { ref: { ...piece.ref,
      start: piece.ref.start + from, end: piece.ref.start + to } } : {}) });
    cursor += piece.text.length;
  }
  return result;
}
function sliceVariant(project: CorpusProject, side: UnitVariant, start: number, end: number): UnitVariant {
  if (side.markup !== undefined) throw new Error('含行内标签的单元不能自动拆分；请先在标签编辑器调整结构。');
  if (side.text !== side.originalText) throw new Error('请先撤销文字修改再拆分，避免把编辑后的字符误当成原始位置。');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > side.text.length) throw new Error('拆分位置无效。');
  for (const position of [start, end]) {
    if (position > 0 && position < side.text.length && /[\uD800-\uDBFF]/.test(side.text[position - 1])
      && /[\uDC00-\uDFFF]/.test(side.text[position])) throw new Error('不能在一个 Unicode 字符的中间拆分。');
  }
  const pieces = slicePieces(piecesFor(project, side), start, end);
  return { ...side, text: side.text.slice(start, end), originalText: side.originalText.slice(start, end),
    refs: pieces.flatMap(piece => piece.ref ? [piece.ref] : []), pieces };
}
export function splitUnit(project: CorpusProject, id: string, sourcePosition: number, targetPosition: number): CorpusProject {
  const index = project.units.findIndex(unit => unit.id === id);
  if (index < 0) throw new Error('找不到需要拆分的行。');
  const unit = project.units[index];
  if (unit.variants.some(side => ![project.sourceLanguage, project.targetLanguage].includes(side.language) && side.text)) {
    throw new Error('该行还有其他语言变体，无法推断其拆分位置；请保留原行或先单独处理该语言。');
  }
  const source = mutableSide(unit, project.sourceLanguage), target = mutableSide(unit, project.targetLanguage);
  if (!sourcePosition && !targetPosition || sourcePosition === source.text.length && targetPosition === target.text.length) {
    throw new Error('拆分后每一行至少需要一侧有内容。');
  }
  const positions = new Map([[project.sourceLanguage, sourcePosition], [project.targetLanguage, targetPosition]]);
  const make = (second: boolean): BilingualUnit => {
    const id = corpusId('unit');
    return { ...unit, id, variants: [source, target, ...unit.variants.filter(side => !positions.has(side.language))].map(side => {
      const cut = positions.get(side.language) ?? 0;
      return sliceVariant(project, side, second ? cut : 0, second ? side.text.length : cut);
    }), review: 'edited', locked: false, provenance: 'manual', score: undefined,
    metadata: { ...unit.metadata, '@tuid': [id], 'x-silvite-parent-unit': [unit.id] } };
  };
  if (project.units.length + 1 > CORPUS_LIMITS.units) throw new Error('单元数量超出限制。');
  return stamp({ ...project, units: [...project.units.slice(0, index), make(false), make(true), ...project.units.slice(index + 1)] });
}
export function mergeUnits(project: CorpusProject, ids: string[]): CorpusProject {
  const indices = project.units.flatMap((unit, index) => ids.includes(unit.id) ? [index] : []);
  if (indices.length < 2 || indices.some((index, position) => index !== indices[0] + position)) throw new Error('请选中至少两行相邻的对应记录。');
  const selected = indices.map(index => project.units[index]);
  if (selected.some(unit => unit.variants.some(side => side.markup !== undefined))) throw new Error('所选行含内联标签，暂不自动合并；请保留标签结构并在 XML 编辑器处理。');
  const languages = [...new Set(selected.flatMap(unit => unit.variants.map(side => side.language)))];
  const variants = languages.map(language => {
    const pieces: Piece[] = [], texts: string[] = [];
    const tmxOrigins: string[] = [];
    for (const unit of selected) {
      const side = mutableSide(unit, language);
      tmxOrigins.push(...(side.tmxOrigins || (side.tmxTuv ? [side.tmxTuv] : [])));
      const next = piecesFor(project, side);
      const previousRef = pieces.findLast(piece => piece.ref)?.ref, nextRef = next.find(piece => piece.ref)?.ref;
      const contiguous = previousRef && nextRef && previousRef.documentId === nextRef.documentId
        && previousRef.blockId === nextRef.blockId && previousRef.end === nextRef.start;
      if (pieces.length && next.length && !contiguous && !/[\r\n]$/.test(pieces.at(-1)!.text)
        && !/^[\r\n]/.test(next[0].text)) pieces.push({ text: '\n\n' });
      pieces.push(...next);
      if (texts.some(text => text.length) && side.text && !contiguous && !/[\r\n]$/.test(texts.at(-1)!)
        && !/^[\r\n]/.test(side.text)) texts.push('\n\n');
      texts.push(side.text);
    }
    const text = texts.join('');
    const uniqueTuvOrigins = [...new Set(tmxOrigins)];
    const originProperty = uniqueTuvOrigins.length ? '<prop type="x-silvite-merged-tuv-origins">' + xmlText(JSON.stringify(uniqueTuvOrigins)) + '</prop>' : '';
    return { language, text, originalText: pieces.map(piece => piece.text).join(''),
      refs: pieces.flatMap(piece => piece.ref ? [piece.ref] : []), pieces, tmxOrigins: uniqueTuvOrigins,
      tmxTuv: '<tuv xml:lang="' + xmlAttribute(language) + '">' + originProperty + '<seg>' + xmlText(text) + '</seg></tuv>' };
  });
  const metadata: Record<string, string[]> = {};
  for (const unit of selected) for (const [key, values] of Object.entries(unit.metadata)) {
    if (!key.startsWith('@') && ![ARCHIVE, 'prop:' + ARCHIVE, MERGE_VERSION, 'prop:' + MERGE_VERSION].includes(key)) metadata[key] = [...new Set([...(metadata[key] || []), ...values])];
  }
  const origins = [...new Map(selected.flatMap(originalUnits).map(origin => [JSON.stringify(origin), origin])).values()];
  if (origins.length > CORPUS_LIMITS.units) throw new Error('合并后的来源记录过多，请分批处理。');
  metadata[ARCHIVE] = [JSON.stringify(origins)];
  metadata[MERGE_VERSION] = ['1'];
  const unit: BilingualUnit = { id: corpusId('unit'), variants, metadata, review: 'edited', locked: false, provenance: 'manual' };
  return stamp({ ...project, units: [...project.units.slice(0, indices[0]), unit, ...project.units.slice(indices.at(-1)! + 1)],
    warnings: [...project.warnings, { unitId: unit.id, message: '合并行的原始单元字段已保留到项目和 x-silvite-merged-original-units 属性中；原有字段作用范围不再等同于单个原始 TU。' }] });
}
export function moveVariant(project: CorpusProject, id: string, language: string, delta: -1 | 1): CorpusProject {
  const index = project.units.findIndex(unit => unit.id === id), next = index + delta;
  if (index < 0 || next < 0 || next >= project.units.length) throw new Error('已经到达第一行或最后一行。');
  const units = [...project.units];
  const first = mutableSide(units[index], language), second = mutableSide(units[next], language);
  units[index] = replaceSide(units[index], second);
  units[next] = replaceSide(units[next], first);
  return stamp({ ...project, units });
}
export function detachVariant(project: CorpusProject, id: string, language: string): CorpusProject {
  const index = project.units.findIndex(unit => unit.id === id);
  if (index < 0) throw new Error('找不到对应行。');
  const original = project.units[index], side = mutableSide(original, language);
  if (!side.text && !side.refs.length) return project;
  const unit: BilingualUnit = { id: corpusId('unit'), variants: [side], review: 'edited', locked: false, provenance: 'manual', metadata: {} };
  return stamp({ ...project, units: [...project.units.slice(0, index), replaceSide(original, emptyVariant(language)), unit, ...project.units.slice(index + 1)] });
}
export function excludeUnits(project: CorpusProject, ids: string[]): CorpusProject {
  const excludedPlacement = { ...project.excludedPlacement };
  project.units.forEach((unit, index) => {
    if (ids.includes(unit.id)) excludedPlacement[unit.id] = { before: project.units[index - 1]?.id, after: project.units[index + 1]?.id };
  });
  return stamp({ ...project, excludedUnits: [...(project.excludedUnits || []), ...project.units.filter(unit => ids.includes(unit.id))],
    units: project.units.filter(unit => !ids.includes(unit.id)), excludedPlacement });
}
export function restoreExcluded(project: CorpusProject): CorpusProject {
  const all = [...project.units, ...(project.excludedUnits || [])];
  const byId = new Map(all.map(unit => [unit.id, unit]));
  const edges = new Map(all.map(unit => [unit.id, new Set<string>()]));
  const degree = new Map(all.map(unit => [unit.id, 0]));
  let unresolved = 0;
  const edge = (from: string | undefined, to: string | undefined) => {
    if (!from || !to || !byId.has(from) || !byId.has(to) || from === to || edges.get(from)!.has(to)) return;
    edges.get(from)!.add(to); degree.set(to, degree.get(to)! + 1);
  };
  for (let index = 1; index < project.units.length; index++) edge(project.units[index - 1].id, project.units[index].id);
  for (const unit of project.excludedUnits || []) {
    const placement = project.excludedPlacement?.[unit.id];
    edge(placement?.before, unit.id); edge(unit.id, placement?.after);
    if ((placement?.before || placement?.after) && !byId.has(placement?.before || '') && !byId.has(placement?.after || '')) unresolved++;
  }
  const queue = all.filter(unit => degree.get(unit.id) === 0).map(unit => unit.id);
  const restored: BilingualUnit[] = [];
  for (let position = 0; position < queue.length; position++) {
    const id = queue[position]; restored.push(byId.get(id)!);
    for (const next of edges.get(id)!) {
      const remaining = degree.get(next)! - 1;
      degree.set(next, remaining);
      if (!remaining) queue.push(next);
    }
  }
  const cycle = restored.length !== all.length;
  return stamp({ ...project, units: cycle ? all : restored, excludedUnits: [], excludedPlacement: {},
    warnings: unresolved || cycle ? [...project.warnings, { message: '部分排除记录的原相邻关系已被拆合或发生冲突；记录已全部恢复，请核对恢复顺序。' }] : project.warnings });
}
export function addEmptyUnit(project: CorpusProject): CorpusProject {
  return stamp({ ...project, units: [...project.units, { id: corpusId('unit'), variants: [emptyVariant(project.sourceLanguage), emptyVariant(project.targetLanguage)],
    review: 'edited', locked: false, provenance: 'manual', metadata: {} }] });
}
