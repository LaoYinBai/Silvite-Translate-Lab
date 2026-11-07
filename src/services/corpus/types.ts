export type CorpusLanguage = 'zh' | 'en';
export type ReviewStatus = 'unreviewed' | 'edited' | 'confirmed';
export interface SourceSpan { documentId: string; blockId: string; start: number; end: number }
export interface CorpusBlock {
  id: string;
  text: string;
  kind: 'paragraph' | 'heading' | 'list' | 'cell';
  path?: string;
}
export interface CorpusDocument {
  id: string;
  name: string;
  language: string;
  blocks: CorpusBlock[];
}
export interface UnitVariant {
  language: string;
  text: string;
  originalText: string;
  refs: SourceSpan[];
  /** XML mixed content inside TMX seg. Text edits require updating this XML,
   * or an explicit conversion to plain text; never reuse stale inline codes. */
  markup?: string;
  /** TUV metadata travels with this side during manual reassignment. */
  tmxTuv?: string;
  tmxOrigins?: string[];
  /** Original display pieces allow lossless repeated split/merge operations. */
  pieces?: Array<{ text: string; ref?: SourceSpan }>;
}
export interface BilingualUnit {
  id: string;
  variants: UnitVariant[];
  review: ReviewStatus;
  locked: boolean;
  provenance: 'imported' | 'automatic' | 'manual';
  score?: number;
  metadata: Record<string, string[]>;
  /** Original TU preserves typed props, notes, attributes and extra languages. */
  tmxTu?: string;
}
export interface CorpusWarning { message: string; unitId?: string }
export interface CorpusProject {
  formatVersion: 1;
  id: string;
  name: string;
  /** Stable download name derived from input files or the translation timestamp. */
  exportName?: string;
  sourceLanguage: string;
  targetLanguage: string;
  languages: string[];
  documents: CorpusDocument[];
  units: BilingualUnit[];
  warnings: CorpusWarning[];
  origin: 'tmx' | 'rtf' | 'alignment';
  tmxHeader?: string;
  createdAt: string;
  updatedAt: string;
  excludedUnits?: BilingualUnit[];
  excludedPlacement?: Record<string, { before?: string; after?: string }>;
}
export interface CorpusImportOptions { sourceLanguage?: string; targetLanguage?: string; name?: string }
export const CORPUS_LIMITS = Object.freeze({
  inputBytes: 10 * 1024 * 1024, expandedCharacters: 500_000, blocks: 10_000,
  units: 10_000, sentencesPerSide: 5_000, projectBytes: 30 * 1024 * 1024,
});
export function corpusId(prefix: string): string { return prefix + '-' + crypto.randomUUID(); }
export function languageBase(language: string): string { return language.trim().toLowerCase().split(/[-_]/)[0]; }
export function requireBilingualDirection(source: string, target: string): void {
  const s = languageBase(source), t = languageBase(target);
  if (!['zh', 'en'].includes(s) || !['zh', 'en'].includes(t) || s === t) throw new Error('对齐仅支持中文与英文，请选择不同的源语言和目标语言。');
}
export function variantOf(unit: BilingualUnit, language: string): UnitVariant {
  return unit.variants.find(variant => variant.language === language)
    || { language, text: '', originalText: '', refs: [] };
}
export function createCorpusProject(name: string, origin: CorpusProject['origin'], options: CorpusImportOptions = {}): CorpusProject {
  const sourceLanguage = options.sourceLanguage || 'zh-CN', targetLanguage = options.targetLanguage || 'en-US';
  requireBilingualDirection(sourceLanguage, targetLanguage);
  const now = new Date().toISOString();
  return { formatVersion: 1, id: corpusId('corpus'), name: options.name || name, origin,
    sourceLanguage, targetLanguage, languages: [sourceLanguage, targetLanguage],
    documents: [], units: [], warnings: [], createdAt: now, updatedAt: now };
}
export function variantForBlock(document: CorpusDocument, block: CorpusBlock): UnitVariant {
  return { language: document.language, text: block.text, originalText: block.text,
    refs: [{ documentId: document.id, blockId: block.id, start: 0, end: block.text.length }] };
}
