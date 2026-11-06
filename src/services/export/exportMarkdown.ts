import { exportNotes, formatTimestamp, type ExportOptions, type TranslationExportData } from './types';
import { downloadBlob } from './download';

// Preserve translated text as text, including literal HTML and code fences.
function plainText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+.!|~-])/g, '\\$1')
    .replace(/\n/g, '  \n');
}

export async function exportToMarkdown(data: TranslationExportData, options: ExportOptions = {}): Promise<void> {
  const sections = [plainText(data.translation)];
  const notes = exportNotes(data, options);
  if (notes.length > 0) {
    sections.push('## 翻译说明');
    for (const note of notes) {
      sections.push(plainText(`${note.translation}${note.reason ? `：${note.reason}` : ''}`));
    }
  }

  const blob = new Blob([`${sections.join('\n\n')}\n`], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `Silvite-Translate-${formatTimestamp(data.generatedAt)}.md`);
}
