import { newStemmer } from 'snowball-stemmers';
import { sdltmHash } from './sdltm';

export interface SdltmToken { text: string; start: number }
export interface SdltmSideIndex {
  hash: bigint;
  tokenData: Uint8Array<ArrayBuffer>;
  wordFeatures: string;
  charFeatures: string;
}

const segmenters = new Map<string, Intl.Segmenter>();
const englishStemmer = newStemmer('english');

export function sdltmTokens(text: string, language: string): SdltmToken[] {
  if (typeof Intl.Segmenter !== 'function') throw new Error('此浏览器不支持 SDLTM 分词，请使用新版 Chrome、Edge、Firefox 或 Safari。');
  const english = language.toLowerCase().startsWith('en');
  const locale = english ? 'en-US' : 'zh-CN';
  let segmenter = segmenters.get(locale);
  if (!segmenter) { segmenter = new Intl.Segmenter(locale, { granularity: 'word' }); segmenters.set(locale, segmenter); }
  const tokens: SdltmToken[] = [];
  for (const part of segmenter.segment(text)) {
    if (!part.isWordLike) continue;
    if (english) {
      // Split apostrophes and all documented dash forms in one pass, retaining UTF-16 offsets.
      for (const match of part.segment.matchAll(/[^'\u2019\u2010-\u2014\uFF0D-]+/g)) {
        tokens.push({ text: match[0], start: part.index + match.index });
      }
    } else tokens.push({ text: part.segment, start: part.index });
  }
  return tokens;
}

/** GetHashCodeInt iterates UTF-16 units, including both halves of surrogate pairs. */
function wordHash(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  return hash;
}

export function sdltmWordFeatures(tokens: SdltmToken[], language: string): string {
  const english = language.toLowerCase().startsWith('en');
  return [...new Set(tokens.map(token => {
    const word = token.text.toLowerCase();
    return wordHash(english ? englishStemmer.stem(word) : word);
  }))].sort((a, b) => a - b).join('|');
}

export function sdltmCharFeatures(tokens: SdltmToken[]): string {
  if (!tokens.length) return '';
  const stream = '|' + tokens.map(token => token.text.toLowerCase()).join('|') + '|';
  const features = new Set<number>();
  for (let index = 0; index + 1 < stream.length; index++) {
    // GetHashCodeLong for a two-unit window fits exactly in a JavaScript number.
    features.add(stream.charCodeAt(index) * 31 + stream.charCodeAt(index + 1));
  }
  return [...features].sort((a, b) => a - b).join('|');
}

/**
 * Simple Word tokens against the Segment's single Text element (element index 0).
 * Native TokenSerializer/Deserializer: v2 count/position are signed int16, length is uint8;
 * v1 stores all three integer fields as int32. 0x20 = single unit, 0x80 = adjacent span.
 * Stopword/recognizer annotations are deliberately left for Trados reindexing.
 */
export function sdltmTokenData(tokens: SdltmToken[]): Uint8Array<ArrayBuffer> {
  const compact = tokens.length <= 0x7fff && tokens.every(token => token.start <= 0x7fff && token.text.length <= 0xff);
  const headerSize = compact ? 3 : 5;
  let size = headerSize, previousEnd = -1;
  for (const [index, token] of tokens.entries()) {
    if (!Number.isSafeInteger(token.start) || token.start < 0 || token.start + token.text.length > 0x7fffffff
      || !token.text.length || (index > 0 && token.start < previousEnd)) {
      throw new Error('SDLTM Token 跨度无效，已停止导出。');
    }
    const adjacent = index > 0 && token.start === previousEnd;
    size += 1 + (adjacent ? 0 : compact ? 3 : 8) + (token.text.length === 1 ? 0 : compact ? 1 : 4);
    previousEnd = token.start + token.text.length;
  }
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  bytes[0] = compact ? 2 : 1;
  if (compact) view.setInt16(1, tokens.length, true);
  else view.setInt32(1, tokens.length, true);
  let offset = headerSize;
  previousEnd = -1;
  for (const [index, token] of tokens.entries()) {
    const adjacent = index > 0 && token.start === previousEnd;
    const single = token.text.length === 1;
    bytes[offset++] = 1 | (single ? 0x20 : 0) | (adjacent ? 0x80 : 0);
    if (!adjacent) {
      if (compact) {
        bytes[offset++] = 0; // From.Index: one Text element, never the token's ordinal.
        view.setInt16(offset, token.start, true); offset += 2;
      } else {
        view.setInt32(offset, 0, true); offset += 4;
        view.setInt32(offset, token.start, true); offset += 4;
      }
    }
    if (!single) {
      if (compact) bytes[offset++] = token.text.length;
      else { view.setInt32(offset, token.text.length, true); offset += 4; }
    }
    previousEnd = token.start + token.text.length;
  }
  return bytes;
}

export function sdltmSideIndex(text: string, language: string): SdltmSideIndex {
  const tokens = sdltmTokens(text, language);
  return { hash: sdltmHash(text), tokenData: sdltmTokenData(tokens),
    wordFeatures: sdltmWordFeatures(tokens, language), charFeatures: sdltmCharFeatures(tokens) };
}
