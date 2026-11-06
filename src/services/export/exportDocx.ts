import { Document, Packer, Paragraph, TextRun, convertInchesToTwip } from 'docx';
import { exportNotes, formatTimestamp, type ExportOptions, type TranslationExportData } from './types';
import { downloadBlob } from './download';

const FONT = 'Microsoft YaHei';

function paragraphs(text: string): Paragraph[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => new Paragraph({
    children: [new TextRun({ text: line, size: 24, font: FONT, color: '1A1A1A' })],
    spacing: { after: 0, line: 360 },
  }));
}

export async function exportToDocx(data: TranslationExportData, options: ExportOptions = {}): Promise<void> {
  const children = paragraphs(data.translation);
  const notes = exportNotes(data, options);
  if (notes.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: '翻译说明', bold: true, size: 28, font: FONT })],
      spacing: { before: 280, after: 120 },
    }));
    for (const note of notes) {
      children.push(...paragraphs(`${note.translation}${note.reason ? `：${note.reason}` : ''}`));
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1), bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1.1), right: convertInchesToTwip(1.1),
          },
        },
      },
      children,
    }],
  });
  downloadBlob(await Packer.toBlob(doc), `Silvite-Translate-${formatTimestamp(data.generatedAt)}.docx`);
}
