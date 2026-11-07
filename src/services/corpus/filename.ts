import { formatTimestamp } from '../export/types';
import { languageBase, type CorpusProject } from './types';

function cleanName(name: string): string {
  const safe = Array.from(name.replace(/[<>:"/\\|?*]/g, '_')).map(character => character.codePointAt(0)! < 32 ? '_' : character);
  const base = safe.slice(0, 120).join('').replace(/[.\s]+$/, '');
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? '_' + base : base;
}

export function corpusDefaultName(date = new Date()): string {
  return 'Lab-' + formatTimestamp(Number.isNaN(date.getTime()) ? new Date() : date);
}

export function corpusDocumentName(names: string[], date = new Date()): string {
  const stems = [...new Set(names.map(name => name.replace(/\.(?:txt|md|docx|rtf|tmx)$/i, '')).filter(Boolean))];
  return cleanName(stems.join(' — ')) || corpusDefaultName(date);
}

export function corpusExportName(project: CorpusProject): string {
  if (project.exportName) return cleanName(project.exportName) || corpusDefaultName(new Date(project.createdAt));
  if (project.origin !== 'alignment') return cleanName(project.name) || corpusDefaultName(new Date(project.createdAt));
  // Preserve names for saved projects created before exportName was introduced.
  const names = [...project.documents].sort((a, b) => languageBase(a.language) === languageBase(b.language) ? 0 : languageBase(a.language) === 'zh' ? -1 : 1)
    .map(document => document.name).filter(name => !['本次翻译原文', '本次翻译译文', '中文正文', '英文正文'].includes(name));
  return corpusDocumentName(names, new Date(project.createdAt));
}

export function corpusFilename(project: CorpusProject, extension: string): string {
  return corpusExportName(project) + '.' + extension;
}
