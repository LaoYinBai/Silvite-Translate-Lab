import { corpusId, createCorpusProject, requireBilingualDirection, variantOf, type BilingualUnit, type CorpusDocument, type CorpusProject, type SourceSpan, type UnitVariant } from '../corpus/types';
import { segmentDocument, type CorpusSentence } from './segment';

export interface CorpusAlignmentInput {
  source: CorpusDocument;
  target: CorpusDocument;
  mode: 'semantic' | 'structure';
  anchors?: BilingualUnit[];
  name?: string;
}
export interface AlignmentFeatures { source?: Float32Array[]; target?: Float32Array[] }
const MOVES = [[1, 1], [1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [2, 3], [3, 2], [3, 3], [1, 0], [0, 1]] as const;

export function alignmentSentences(input: CorpusAlignmentInput) {
  requireBilingualDirection(input.source.language, input.target.language);
  const refs = (input.anchors || []).flatMap(unit => unit.variants.flatMap(variant => variant.refs));
  return { source: segmentDocument(input.source, refs), target: segmentDocument(input.target, refs) };
}

function textFor(sentences: CorpusSentence[]): string {
  return sentences.map((sentence, index) => (index && sentences[index - 1].blockId !== sentence.blockId && !/\n$/.test(sentences[index - 1].text) ? '\n\n' : '') + sentence.text).join('');
}
function sideFor(sentences: CorpusSentence[], language: string): UnitVariant {
  const text = textFor(sentences);
  return { language, text, originalText: text, refs: sentences.map(({ documentId, blockId, start, end }) => ({ documentId, blockId, start, end })) };
}
function normalize(vector: Float32Array) {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (length) for (let i = 0; i < vector.length; i++) vector[i] /= length;
  return vector;
}
interface Group { length: number; numbers: Set<string>; vector?: Float32Array }
function groups(sentences: CorpusSentence[], vectors?: Float32Array[]): Array<Array<Group | null>> {
  return sentences.map((_sentence, start) => [1, 2, 3].map(count => {
    if (start + count > sentences.length) return null;
    const selected = sentences.slice(start, start + count);
    const vector = vectors ? new Float32Array(vectors[start].length) : undefined;
    if (vector && vectors) for (let index = start; index < start + count; index++) {
      for (let dim = 0; dim < vector.length; dim++) vector[dim] += vectors[index][dim];
    }
    return { length: Math.max(1, selected.reduce((sum, sentence) => sum + sentence.matchText.replace(/\s/g, '').length, 0)),
      numbers: new Set(selected.flatMap(sentence => sentence.text.match(/\d+(?:[.,]\d+)*/g) || [])), vector: vector ? normalize(vector) : undefined };
  }));
}
function matchCost(source: Group, target: Group, ratio: number, mode: CorpusAlignmentInput['mode']) {
  const length = Math.min(4, Math.abs(Math.log((target.length + 5) / (source.length * ratio + 5))));
  const allNumbers = Math.max(source.numbers.size, target.numbers.size);
  const overlap = [...source.numbers].filter(number => target.numbers.has(number)).length;
  const number = allNumbers && source.numbers.size && target.numbers.size ? 1 - overlap / allNumbers : 0;
  if (mode === 'semantic' && source.vector && target.vector) {
    let similarity = 0;
    for (let dim = 0; dim < source.vector.length; dim++) similarity += source.vector[dim] * target.vector[dim];
    similarity = Math.max(-1, Math.min(1, similarity));
    return { cost: (1 - similarity) * 2.8 + length * 0.2 + number * 0.8, score: similarity };
  }
  return { cost: length * 2.2 + number * 1.4, score: -length - number };
}

function region(
  source: CorpusSentence[], target: CorpusSentence[], sourceLanguage: string, targetLanguage: string,
  mode: CorpusAlignmentInput['mode'], sourceVectors?: Float32Array[], targetVectors?: Float32Array[],
): BilingualUnit[] {
  const n = source.length, m = target.length;
  const units: BilingualUnit[] = [];
  const append = (i: number, j: number, a: number, b: number, score?: number) => units.push({
    id: corpusId('unit'), variants: [sideFor(source.slice(i, i + a), sourceLanguage), sideFor(target.slice(j, j + b), targetLanguage)],
    review: 'unreviewed', locked: false, provenance: 'automatic', metadata: {}, score,
  });
  if (!n || !m) {
    for (let i = 0; i < n; i++) append(i, 0, 1, 0);
    for (let j = 0; j < m; j++) append(0, j, 0, 1);
    return units;
  }
  const sourceGroups = groups(source, sourceVectors), targetGroups = groups(target, targetVectors);
  const ratio = targetGroups.reduce((sum, value) => sum + value[0]!.length, 0) / sourceGroups.reduce((sum, value) => sum + value[0]!.length, 0);
  const band = Math.max(24, Math.min(100, Math.ceil(Math.abs(n - m) / 2) + 32));
  const rows = Array.from({ length: n + 1 }, (_, i) => {
    const center = Math.round(i * m / n), low = Math.max(0, center - band), high = Math.min(m, center + band);
    return { low, scores: new Float64Array(high - low + 1).fill(Infinity), back: new Uint8Array(high - low + 1) };
  });
  rows[0].scores[0] = 0;
  const value = (i: number, j: number) => rows[i]?.scores[j - rows[i].low] ?? Infinity;
  for (let i = 0; i <= n; i++) {
    const row = rows[i];
    for (let index = 0; index < row.scores.length; index++) {
      const current = row.scores[index];
      if (!Number.isFinite(current)) continue;
      const j = row.low + index;
      for (let move = 0; move < MOVES.length; move++) {
        const [a, b] = MOVES[move];
        if (i + a > n || j + b > m) continue;
        const nextRow = rows[i + a], position = j + b - nextRow.low;
        if (position < 0 || position >= nextRow.scores.length) continue;
        const matched = a && b ? matchCost(sourceGroups[i][a - 1]!, targetGroups[j][b - 1]!, ratio, mode).cost : 0.9;
        // Prefer separate, well-matched sentences over merging unrelated
        // neighbours merely to absorb an inserted or omitted sentence.
        const total = current + matched * (a && b ? Math.max(a, b) : 1) + (a && b ? (a + b - 2) * 0.30 : 0);
        if (total < nextRow.scores[position]) { nextRow.scores[position] = total; nextRow.back[position] = move + 1; }
      }
    }
  }
  let i = n, j = m;
  if (!Number.isFinite(value(i, j))) {
    for (let a = 0; a < n; a++) append(a, 0, 1, 0);
    for (let b = 0; b < m; b++) append(0, b, 0, 1);
    return units;
  }
  while (i || j) {
    const code = rows[i].back[j - rows[i].low];
    if (!code) throw new Error('对齐路径不完整，未替换原有结果。');
    const [a, b] = MOVES[code - 1];
    i -= a; j -= b;
    const score = a && b ? matchCost(sourceGroups[i][a - 1]!, targetGroups[j][b - 1]!, ratio, mode).score : undefined;
    append(i, j, a, b, score);
  }
  return units.reverse();
}

function anchorRange(refs: SourceSpan[], sentences: CorpusSentence[], cursor: number): [number, number] {
  if (!refs.length) return [cursor, cursor];
  const indices = sentences.map((sentence, index) => refs.some(ref => ref.documentId === sentence.documentId
    && ref.blockId === sentence.blockId && ref.start <= sentence.start && ref.end >= sentence.end) ? index : -1).filter(index => index >= 0);
  if (!indices.length || indices.some((value, index) => value !== indices[0] + index)) throw new Error('锁定句段必须覆盖连续的原文范围。');
  const covered = indices.reduce((sum, index) => sum + sentences[index].end - sentences[index].start, 0);
  if (covered !== refs.reduce((sum, ref) => sum + ref.end - ref.start, 0)) throw new Error('锁定句段的字符范围不完整或重复。');
  return [indices[0], indices[indices.length - 1] + 1];
}

export function assertCorpusCoverage(project: CorpusProject): void {
  const ranges = new Map<string, Array<[number, number]>>();
  for (const unit of [...project.units, ...(project.excludedUnits || [])]) for (const language of [project.sourceLanguage, project.targetLanguage]) {
    for (const ref of variantOf(unit, language).refs) {
      const key = ref.documentId + '/' + ref.blockId;
      const values = ranges.get(key) || [];
      values.push([ref.start, ref.end]); ranges.set(key, values);
    }
  }
  for (const document of project.documents.filter(item => [project.sourceLanguage, project.targetLanguage].includes(item.language))) {
    for (const block of document.blocks) {
      const values = (ranges.get(document.id + '/' + block.id) || []).sort((a, b) => a[0] - b[0]);
      let cursor = 0;
      for (const [start, end] of values) {
        if (start !== cursor || end < start || end > block.text.length) throw new Error('原文覆盖检查失败：发现重复、丢失或无效的字符范围。');
        cursor = end;
      }
      if (cursor !== block.text.length) throw new Error('原文覆盖检查失败：存在未保留的内容。');
    }
  }
}

export function alignCorpus(input: CorpusAlignmentInput, features: AlignmentFeatures = {}): CorpusProject {
  const sentences = alignmentSentences(input);
  if (input.mode === 'semantic' && (features.source?.length !== sentences.source.length || features.target?.length !== sentences.target.length)) {
    throw new Error('语义特征未完整生成，请重试或选择快速结构对齐。');
  }
  const project = createCorpusProject(input.name || '中英对齐语料', 'alignment', {
    sourceLanguage: input.source.language, targetLanguage: input.target.language,
  });
  project.documents = [input.source, input.target];
  let sourceCursor = 0, targetCursor = 0;
  const anchors = (input.anchors || []).map(unit => ({ unit,
    source: anchorRange(variantOf(unit, project.sourceLanguage).refs, sentences.source, 0),
    target: anchorRange(variantOf(unit, project.targetLanguage).refs, sentences.target, 0),
  })).sort((a, b) => a.source[0] - b.source[0] || a.target[0] - b.target[0]);
  if (anchors.some(anchor => anchor.source[0] === anchor.source[1] || anchor.target[0] === anchor.target[1])) throw new Error('锚点需要两侧都有实际内容；请先解锁单侧留空行。');
  for (const anchor of [...anchors, { unit: null, source: [sentences.source.length, sentences.source.length], target: [sentences.target.length, sentences.target.length] }]) {
    const [sourceStart, sourceEnd] = anchor.source, [targetStart, targetEnd] = anchor.target;
    if (sourceStart < sourceCursor || targetStart < targetCursor) throw new Error('锚点发生交叉或重叠，请先调整或解锁对应行。');
    project.units.push(...region(sentences.source.slice(sourceCursor, sourceStart), sentences.target.slice(targetCursor, targetStart),
      project.sourceLanguage, project.targetLanguage, input.mode, features.source?.slice(sourceCursor, sourceStart), features.target?.slice(targetCursor, targetStart)));
    if (anchor.unit) project.units.push(anchor.unit);
    sourceCursor = sourceEnd; targetCursor = targetEnd;
  }
  project.warnings.push({ message: input.mode === 'semantic' ? '语义对齐结果尚未人工复核；相似度是算法原始分数，不是正确概率。' : '快速结构对齐只使用长度、数字和顺序，请逐行核对语义。' });
  assertCorpusCoverage(project);
  return project;
}
