import { hasLongReadableSentence, readableLengthLimit, readableRanges } from './readable';

export interface TranslatedRange {
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
}

export interface ParagraphRange {
  start: number;
  end: number;
  firstParagraph: number;
  lastParagraph: number;
}

export interface ParagraphPair {
  id: string;
  source: ParagraphRange | null;
  target: ParagraphRange | null;
  needsCheck: boolean;
}

export interface ParagraphAlignmentInput {
  sourceText: string;
  targetText: string;
  sourceLanguage: string;
  targetLanguage: string;
  translatedRanges?: TranslatedRange[];
}

export interface ParagraphAlignment {
  sourceText: string;
  targetText: string;
  sourceLanguage: 'zh' | 'en';
  targetLanguage: 'zh' | 'en';
  rows: ParagraphPair[];
  method?: 'script' | 'ai';
  granularity?: 'segment' | 'paragraph';
}

interface Paragraph extends ParagraphRange {
  text: string;
  length: number;
  numbers: Set<string>;
}

export function bilingualLanguage(value: string): 'zh' | 'en' | null {
  if (typeof value !== 'string') return null;
  const language = value.trim().toLowerCase().split(/[-_]/)[0];
  return language === 'zh' || language === 'en' ? language : null;
}

export function supportsParagraphAlignment(sourceLanguage: string, targetLanguage: string): boolean {
  const source = bilingualLanguage(sourceLanguage);
  const target = bilingualLanguage(targetLanguage);
  return source !== null && target !== null && source !== target;
}

// The ranges partition the original string, including separators. Normalized
// features are used only for matching; neither source nor translation changes.
function splitParagraphs(text: string, language: string, extraBoundaries: Set<number> = new Set()): Paragraph[] {
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)]
    .filter(match => match[0].length > 0)
    .map(match => ({ start: match.index, end: match.index + match[0].length, body: match[0].trim() }));
  let fence: string | null = null;
  let hasContent = false;
  let blankAfterContent = false;
  let blankMode = false;
  for (const line of lines) {
    const marker = line.body.match(/^([`~])\1{2,}/)?.[0];
    if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) {
      fence = fence ? null : marker;
    } else if (!fence) {
      if (!line.body && hasContent) blankAfterContent = true;
      if (line.body) {
        if (blankAfterContent) blankMode = true;
        hasContent = true;
      }
    }
  }
  const boundaries = new Set(extraBoundaries);
  fence = null;
  for (const line of lines) {
    const marker = line.body.match(/^([`~])\1{2,}/)?.[0];
    if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) {
      fence = fence ? null : marker;
    }
    if (!fence && (!blankMode || !line.body)) boundaries.add(line.end);
  }
  boundaries.add(text.length);
  const paragraphs: Paragraph[] = [];
  let start = 0;
  for (const end of [...boundaries].filter(end => end > 0 && end <= text.length).sort((a, b) => a - b)) {
    const raw = text.slice(start, end);
    if (!raw.trim()) continue;
    paragraphs.push({
      start, end, firstParagraph: paragraphs.length + 1, lastParagraph: paragraphs.length + 1,
      text: raw, length: Math.max(1, raw.replace(/\s/g, '').length),
      numbers: new Set(raw.match(/\d+(?:[.,]\d+)*/g) || []),
    });
    start = end;
  }
  if (start < text.length && paragraphs.length) {
    const last = paragraphs[paragraphs.length - 1];
    last.end = text.length;
    last.text = text.slice(last.start);
  }
  const readable = paragraphs.flatMap(paragraph => readableRanges(paragraph.text, language).map(range => {
    const start = paragraph.start + range.start, end = paragraph.start + range.end;
    const raw = text.slice(start, end);
    return { start, end, firstParagraph: 0, lastParagraph: 0, text: raw,
      length: Math.max(1, raw.replace(/\s/g, '').length), numbers: new Set(raw.match(/\d+(?:[.,]\d+)*/g) || []) };
  }));
  readable.forEach((part, index) => { part.firstParagraph = index + 1; part.lastParagraph = index + 1; });
  return readable;
}

function group(paragraphs: Paragraph[], start: number, count: number): ParagraphRange | null {
  if (!count) return null;
  const first = paragraphs[start];
  const last = paragraphs[start + count - 1];
  return { start: first.start, end: last.end, firstParagraph: first.firstParagraph, lastParagraph: last.lastParagraph };
}

function combined(paragraphs: Paragraph[], start: number, count: number) {
  let length = 0;
  const numbers = new Set<string>();
  for (let index = start; index < start + count; index++) {
    length += paragraphs[index].length;
    for (const number of paragraphs[index].numbers) numbers.add(number);
  }
  return { length, numbers };
}

function correspondenceCost(source: ReturnType<typeof combined>, target: ReturnType<typeof combined>, ratio: number): number {
  const lengthCost = Math.abs(Math.log((target.length + 4) / (source.length * ratio + 4))) * 3;
  let numberCost = 0;
  if (source.numbers.size && target.numbers.size) {
    const overlap = [...source.numbers].filter(number => target.numbers.has(number)).length;
    numberCost = 2 * (1 - overlap / Math.max(source.numbers.size, target.numbers.size));
  } else if (source.numbers.size || target.numbers.size) {
    // A written number can legitimately become Chinese words.
    numberCost = 0.4;
  }
  return lengthCost + numberCost;
}

const TRANSITIONS = [[1, 1], [1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [2, 3], [3, 2], [3, 3], [1, 0], [0, 1]] as const;

// A bounded monotone path with length/number cues. This is a structural
// suggestion, never a semantic guarantee or a calibrated confidence score.
function alignRegion(source: Paragraph[], target: Paragraph[], sourceLanguage: string, targetLanguage: string): ParagraphPair[] {
  const n = source.length;
  const m = target.length;
  const rows: ParagraphPair[] = [];
  const append = (s: number, t: number, a: number, b: number, needsCheck: boolean) => {
    rows.push({ id: '', source: group(source, s, a), target: group(target, t, b), needsCheck });
  };
  if (!n || !m || n + m > 6000) {
    // Excessive line counts do not allocate an unbounded matrix. Every
    // paragraph is still displayed, on its own side, for manual comparison.
    for (let index = 0; index < n; index++) append(index, 0, 1, 0, true);
    for (let index = 0; index < m; index++) append(0, index, 0, 1, true);
    return rows;
  }
  const ratio = target.reduce((sum, paragraph) => sum + paragraph.length, 0)
    / source.reduce((sum, paragraph) => sum + paragraph.length, 0);
  const sourceLimit = readableLengthLimit(sourceLanguage), targetLimit = readableLengthLimit(targetLanguage);
  const sourceGroups = source.map((_paragraph, start) => [1, 2, 3].map(count => start + count <= n ? combined(source, start, count) : null));
  const targetGroups = target.map((_paragraph, start) => [1, 2, 3].map(count => start + count <= m ? combined(target, start, count) : null));
  const width = m + 1;
  const band = Math.max(4, Math.min(64, Math.floor(180_000 / ((n + 1) * 2)) - 2));
  const states = new Map<number, { cost: number; previous: number; a: number; b: number; check: boolean }>();
  states.set(0, { cost: 0, previous: -1, a: 0, b: 0, check: false });
  for (let s = 0; s <= n; s++) {
    const center = Math.round(s * m / n);
    for (let t = Math.max(0, center - band); t <= Math.min(m, center + band); t++) {
      const key = s * width + t;
      const state = states.get(key);
      if (!state) continue;
      for (const [a, b] of TRANSITIONS) {
        if (s + a > n || t + b > m) continue;
        // Do not undo readable splitting merely to make fragment counts equal.
        // An uncertain leftover remains visible for AI/manual correspondence.
        if (a > 1 && sourceGroups[s][a - 1]!.length > sourceLimit) continue;
        if (b > 1 && targetGroups[t][b - 1]!.length > targetLimit) continue;
        if (Math.abs(t + b - (s + a) * m / n) > band) continue;
        const matchCost = a && b ? correspondenceCost(sourceGroups[s][a - 1]!, targetGroups[t][b - 1]!, ratio) : 3;
        const cost = state.cost + matchCost + (a && b ? (a + b - 2) * 0.75 : 0);
        const nextKey = (s + a) * width + t + b;
        if (cost < (states.get(nextKey)?.cost ?? Infinity)) {
          states.set(nextKey, { cost, previous: key, a, b, check: !a || !b || matchCost > 1.5 || a + b > 2 });
        }
      }
    }
  }
  let key = n * width + m;
  if (!states.has(key)) {
    for (let index = 0; index < n; index++) append(index, 0, 1, 0, true);
    for (let index = 0; index < m; index++) append(0, index, 0, 1, true);
    return rows;
  }
  while (key) {
    const state = states.get(key)!;
    const s = Math.floor(state.previous / width);
    const t = state.previous % width;
    append(s, t, state.a, state.b, state.check);
    key = state.previous;
  }
  return rows.reverse();
}

function validTranslatedRanges(input: ParagraphAlignmentInput): TranslatedRange[] {
  const ranges = input.translatedRanges || [];
  let sourceEnd = 0;
  let targetEnd = 0;
  for (const range of ranges) {
    if (![range.sourceStart, range.sourceEnd, range.targetStart, range.targetEnd].every(Number.isSafeInteger)
      || range.sourceStart !== sourceEnd || range.targetStart !== targetEnd
      || range.sourceEnd <= sourceEnd || range.targetEnd < targetEnd
      || range.sourceEnd > input.sourceText.length || range.targetEnd > input.targetText.length) return [];
    sourceEnd = range.sourceEnd;
    targetEnd = range.targetEnd;
  }
  return sourceEnd === input.sourceText.length && targetEnd === input.targetText.length ? ranges : [];
}

export function alignParagraphs(input: ParagraphAlignmentInput): ParagraphAlignment | null {
  if (!supportsParagraphAlignment(input.sourceLanguage, input.targetLanguage)
    || !input.sourceText.trim() || !input.targetText.trim()) return null;
  const source = splitParagraphs(input.sourceText, input.sourceLanguage);
  const sourceEnds = new Set(source.map(paragraph => paragraph.end));
  const anchors = validTranslatedRanges(input).filter(range => sourceEnds.has(range.sourceEnd));
  // Confirmed request boundaries can separate paragraphs even if a model
  // trimmed their trailing blank lines during document assembly.
  const target = splitParagraphs(input.targetText, input.targetLanguage, new Set(anchors.map(range => range.targetEnd)));
  const rows: ParagraphPair[] = [];
  let s = 0;
  let t = 0;
  for (const anchor of [...anchors, { sourceEnd: input.sourceText.length, targetEnd: input.targetText.length }]) {
    const sourceStart = s;
    const targetStart = t;
    while (s < source.length && source[s].end <= anchor.sourceEnd) s++;
    while (t < target.length && target[t].end <= anchor.targetEnd) t++;
    if (s > sourceStart || t > targetStart) rows.push(...alignRegion(source.slice(sourceStart, s), target.slice(targetStart, t), input.sourceLanguage, input.targetLanguage));
  }
  for (const side of ['source', 'target'] as const) {
    let cursor = 0;
    for (const row of rows) {
      const range = row[side];
      if (!range) continue;
      if (range.start !== cursor || range.end <= cursor) throw new Error('Paragraph coverage is invalid');
      cursor = range.end;
    }
    if (cursor !== (side === 'source' ? input.sourceText.length : input.targetText.length)) {
      throw new Error('Paragraph coverage is incomplete');
    }
  }
  return {
    sourceText: input.sourceText, targetText: input.targetText,
    sourceLanguage: bilingualLanguage(input.sourceLanguage)!,
    targetLanguage: bilingualLanguage(input.targetLanguage)!,
    rows: rows.map((row, index) => ({ ...row, id: 'paragraph-' + (index + 1) })),
    method: 'script', granularity: 'segment',
  };
}

export function needsAiSegmentation(input: ParagraphAlignmentInput, alignment: ParagraphAlignment): boolean {
  if (input.sourceText.length + input.targetText.length > 12_000 || alignment.rows.length > 160) return false;
  return alignment.rows.some(row => row.needsCheck)
    || hasLongReadableSentence(input.sourceText, input.sourceLanguage)
    || hasLongReadableSentence(input.targetText, input.targetLanguage);
}
