import type { ParagraphAlignment } from '../alignment/paragraphs';
import { assertCorpusCoverage } from '../alignment/corpusAlign';
import { corpusId, createCorpusProject, type CorpusBlock, type CorpusDocument } from './types';

export function corpusFromTranslation(alignment: ParagraphAlignment) {
  const project = createCorpusProject('中英翻译语料', 'alignment', {
    sourceLanguage: alignment.sourceLanguage, targetLanguage: alignment.targetLanguage,
  });
  const sourceBlock: CorpusBlock = { id: corpusId('block'), text: alignment.sourceText, kind: 'paragraph' };
  const targetBlock: CorpusBlock = { id: corpusId('block'), text: alignment.targetText, kind: 'paragraph' };
  const source: CorpusDocument = { id: corpusId('document'), name: '本次翻译原文', language: project.sourceLanguage, blocks: [sourceBlock] };
  const target: CorpusDocument = { id: corpusId('document'), name: '本次翻译译文', language: project.targetLanguage, blocks: [targetBlock] };
  project.documents = [source, target];
  project.units = alignment.rows.map(row => ({
    id: corpusId('unit'), review: 'unreviewed', locked: false, provenance: 'automatic', metadata: {},
    variants: [
      { language: project.sourceLanguage, text: row.source ? alignment.sourceText.slice(row.source.start, row.source.end) : '',
        originalText: row.source ? alignment.sourceText.slice(row.source.start, row.source.end) : '',
        refs: row.source ? [{ documentId: source.id, blockId: sourceBlock.id, start: row.source.start, end: row.source.end }] : [] },
      { language: project.targetLanguage, text: row.target ? alignment.targetText.slice(row.target.start, row.target.end) : '',
        originalText: row.target ? alignment.targetText.slice(row.target.start, row.target.end) : '',
        refs: row.target ? [{ documentId: target.id, blockId: targetBlock.id, start: row.target.start, end: row.target.end }] : [] },
    ],
  }));
  project.warnings.push({ message: '沿用翻译结果的自动分段中英对照（' + (alignment.method === 'ai' ? 'AI 辅助' : '本地规则') + '），尚未人工复核。可以继续校正，也可锁定已确认的行后重新语义对齐。' });
  assertCorpusCoverage(project);
  return project;
}
