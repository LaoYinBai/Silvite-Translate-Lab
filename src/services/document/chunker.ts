export type DocumentLanguage = 'zh' | 'en' | 'other';

export interface DocumentChunk {
  text: string;
  translatable: boolean;
}

export interface ChunkOptions {
  targetChars?: number;
}

const DEFAULT_TARGETS: Record<DocumentLanguage, number> = {
  zh: 3200,
  en: 5200,
  other: 4000,
};

export function detectDocumentLanguage(text: string): DocumentLanguage {
  const sample = text.replace(/```[\s\S]*?```/g, '').slice(0, 5000);
  const chinese = (sample.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  if (chinese > Math.max(8, latin * 0.25)) return 'zh';
  if (latin > 8) return 'en';
  return 'other';
}

export function recommendedChunkChars(text: string): number {
  return DEFAULT_TARGETS[detectDocumentLanguage(text)];
}

export function extractDocumentTitle(text: string): string | null {
  const markdownHeading = text.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  if (markdownHeading?.[1]) return markdownHeading[1].trim();
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim();
  return firstLine && firstLine.length <= 120 ? firstLine : null;
}

function lastBoundary(text: string, limit: number, expression: RegExp): number {
  let best = -1;
  expression.lastIndex = 0;
  for (let match = expression.exec(text); match; match = expression.exec(text)) {
    const end = match.index + match[0].length;
    if (end > limit) break;
    best = end;
    if (!match[0].length) expression.lastIndex++;
  }
  return best;
}

function chooseCut(text: string, target: number): number {
  if (text.length <= target) return text.length;
  const minimumUseful = Math.max(1, Math.floor(target * 0.35));
  const candidates = [
    lastBoundary(text, target, /(?:\r?\n){2,}/g),
    lastBoundary(text, target, /(?:^|\r?\n)(?=#{1,6}\s|(?:[-*+] |\d+[.)]\s))/gm),
    lastBoundary(text, target, /[。！？]|[.!?](?:[”’"']?)(?:\s+|$)/g),
    lastBoundary(text, target, /[,，;；:：](?:\s+|$)/g),
    lastBoundary(text, target, /\s+/g),
  ];
  return candidates.find((candidate) => candidate >= minimumUseful) ?? target;
}

function splitNormalText(text: string, target: number): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let remaining = text;
  while (remaining.length > target) {
    const cut = chooseCut(remaining, target);
    chunks.push({ text: remaining.slice(0, cut), translatable: true });
    remaining = remaining.slice(cut);
  }
  if (remaining) chunks.push({ text: remaining, translatable: true });
  return chunks;
}

export function chunkDocument(text: string, options: ChunkOptions = {}): DocumentChunk[] {
  if (!text) return [];
  const target = Math.max(1, Math.floor(options.targetChars ?? recommendedChunkChars(text)));
  const chunks: DocumentChunk[] = [];
  const fence = /^```[^\r\n]*\r?\n[\s\S]*?^```[^\r\n]*(?:\r?\n|$)/gm;
  let cursor = 0;

  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    if (match.index > cursor) chunks.push(...splitNormalText(text.slice(cursor, match.index), target));
    chunks.push({ text: match[0], translatable: false });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) chunks.push(...splitNormalText(text.slice(cursor), target));

  return chunks;
}
