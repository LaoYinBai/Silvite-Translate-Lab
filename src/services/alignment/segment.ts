import { CORPUS_LIMITS, corpusId, type CorpusDocument, type SourceSpan } from '../corpus/types';

export interface CorpusSentence extends SourceSpan { id: string; text: string; matchText: string }
const ABBREVIATION = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Fig|Eq|No|Vol|Inc|Ltd)|\be\.g|\bi\.e|\bet al|\b(?:[A-Z]\.)+[A-Z])\.$/i;

export function textDocument(text: string, name: string, language: string): CorpusDocument {
  if (text.length > CORPUS_LIMITS.expandedCharacters) throw new Error('文档正文过长，请拆分后再对齐。');
  const blocks: CorpusDocument['blocks'] = [];
  let start = 0;
  for (const match of text.matchAll(/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)+/g)) {
    const end = match.index + match[0].length;
    blocks.push({ id: corpusId('block'), text: text.slice(start, end), kind: 'paragraph' });
    start = end;
  }
  if (start < text.length || !blocks.length) blocks.push({ id: corpusId('block'), text: text.slice(start), kind: 'paragraph' });
  if (blocks.length > CORPUS_LIMITS.blocks) throw new Error('文档段落过多，请拆分后重试。');
  return { id: corpusId('document'), name, language, blocks };
}

export function segmentDocument(document: CorpusDocument, anchorRefs: SourceSpan[] = []): CorpusSentence[] {
  const result: CorpusSentence[] = [];
  for (const block of document.blocks) {
    const boundaries = new Set<number>();
    // Keep every original whitespace and punctuation character in one range.
    for (const match of block.text.matchAll(/[。！？!?]+[”’"'）)\]]*|[.]+[”’"'）)\]]*/g)) {
      let end = match.index + match[0].length;
      if (match[0].startsWith('.')) {
        if (/\d/.test(block.text[match.index - 1] || '') && /\d/.test(block.text[end] || '')) continue;
        if (ABBREVIATION.test(block.text.slice(0, end))) continue;
        if (end < block.text.length && !/\s|[\u3400-\u9fff]/u.test(block.text[end])) continue;
      }
      while (end < block.text.length && /\s/.test(block.text[end])) end++;
      boundaries.add(end);
    }
    for (const ref of anchorRefs) {
      if (ref.documentId === document.id && ref.blockId === block.id) {
        if (ref.start < 0 || ref.end > block.text.length || ref.start > ref.end) throw new Error('锁定句段的原文位置无效。');
        boundaries.add(ref.start); boundaries.add(ref.end);
      }
    }
    boundaries.add(block.text.length);
    let start = 0;
    for (const end of [...boundaries].sort((a, b) => a - b)) {
      if (end <= start) continue;
      const text = block.text.slice(start, end);
      result.push({ id: block.id + ':' + start, documentId: document.id, blockId: block.id,
        start, end, text, matchText: text.normalize('NFC').replace(/\s+/g, ' ').trim() });
      start = end;
    }
  }
  if (result.length > CORPUS_LIMITS.sentencesPerSide) throw new Error('分句后超过每侧 5,000 句，请拆分文档后再对齐。');
  return result;
}
