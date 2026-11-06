// Offsets always refer to the unchanged UTF-16 input. Only display boundaries
// are generated here; this never inserts punctuation or rewrites either side.
export interface ReadableRange { start: number; end: number }
const ABBREVIATION = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Fig|Eq|No|Vol|Inc|Ltd)|\be\.g|\bi\.e|\bet al|\b(?:[A-Z]\.)+[A-Z])\.$/i;
const limitFor = (language: string) => language.toLowerCase().startsWith('zh')
  ? { limit: 70, target: 44, minimum: 16 } : { limit: 240, target: 150, minimum: 50 };
export const readableLengthLimit = (language: string) => limitFor(language).limit;

function characterCounts(text: string): Uint32Array {
  const counts = new Uint32Array(text.length + 1);
  let offset = 0, visible = 0;
  for (const character of text) {
    if (!/\s/u.test(character)) visible++;
    for (let unit = 0; unit < character.length; unit++) counts[++offset] = visible;
  }
  return counts;
}

function sentenceEnds(text: string): number[] {
  const ends = new Set<number>();
  for (const match of text.matchAll(/[。！？!?]+[”’"'）)\]]*|[.]+[”’"'）)\]]*/g)) {
    let end = match.index + match[0].length;
    if (match[0].startsWith('.')) {
      if (/\d/.test(text[match.index - 1] || '') && /\d/.test(text[end] || '')) continue;
      if (ABBREVIATION.test(text.slice(Math.max(0, end - 96), end))) continue;
      if (end < text.length && !/\s|[\u3400-\u9fff]/u.test(text[end])) continue;
    }
    while (end < text.length && /\s/.test(text[end])) end++;
    ends.add(end);
  }
  ends.add(text.length);
  return [...ends].sort((a, b) => a - b);
}

function clauseEnds(text: string): number[] {
  const ends: number[] = [], stack: string[] = [];
  const open: Record<string, string> = { '(': ')', '[': ']', '{': '}', '（': '）', '【': '】', '《': '》', '“': '”', '‘': '’', '「': '」', '『': '』' };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"' || character === "'") {
      if (text[index - 1] === '\\' || character === "'" && /[\p{L}\p{N}]/u.test(text[index - 1] || '') && /[\p{L}\p{N}]/u.test(text[index + 1] || '')) continue;
      if (stack.at(-1) === character) stack.pop(); else stack.push(character);
      continue;
    }
    if (stack.at(-1) === character) { stack.pop(); continue; }
    if (open[character]) { stack.push(open[character]); continue; }
    if (stack.length || !/[，,；;：:—–]/.test(character)) continue;
    if (/[,:，：]/.test(character) && /\d/.test(text[index - 1] || '') && /\d/.test(text[index + 1] || '')) continue;
    if (character === ':' && text[index + 1] === '/') continue;
    if (character === ';' && /&[#\w]{1,12}$/.test(text.slice(Math.max(0, index - 15), index))) continue;
    let end = index + 1;
    while (end < text.length && (text[end] === character && /[—–]/.test(character) || /\s/.test(text[end]))) end++;
    ends.push(end); index = end - 1;
  }
  return ends;
}

export function hasLongReadableSentence(text: string, language: string): boolean {
  const limit = limitFor(language).limit, counts = characterCounts(text);
  let start = 0;
  for (const end of sentenceEnds(text)) {
    if (counts[end] - counts[start] > limit) return true;
    start = end;
  }
  return false;
}

export function readableRanges(text: string, language: string): ReadableRange[] {
  if (!text.length) return [];
  // A fenced code block has its own line syntax; preserve its complete block.
  if (/^[\t ]*(?:`{3,}|~{3,})/m.test(text)) return [{ start: 0, end: text.length }];
  const config = limitFor(language), clauses = clauseEnds(text), counts = characterCounts(text);
  const ranges: ReadableRange[] = [];
  let start = 0, clauseCursor = 0;
  for (const end of sentenceEnds(text)) {
    while (counts[end] - counts[start] > config.limit) {
      while (clauseCursor < clauses.length && clauses[clauseCursor] <= start) clauseCursor++;
      let best = -1, distance = Infinity;
      // Candidates are ordered. Once the ideal length is passed, no later
      // boundary can improve the distance; no repeated substring recounting.
      for (let index = clauseCursor; index < clauses.length && clauses[index] < end; index++) {
        const boundary = clauses[index], length = counts[boundary] - counts[start];
        if (counts[end] - counts[boundary] < config.minimum) break;
        if (length < config.minimum) continue;
        const nextDistance = Math.abs(length - config.target);
        if (nextDistance < distance) { best = index; distance = nextDistance; }
        if (length >= config.target) break;
      }
      if (best < 0) break;
      const boundary = clauses[best]; clauseCursor = best + 1;
      ranges.push({ start, end: boundary }); start = boundary;
    }
    if (end > start) { ranges.push({ start, end }); start = end; }
  }
  return ranges;
}
