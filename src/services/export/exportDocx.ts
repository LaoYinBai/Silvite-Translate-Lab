import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  BorderStyle,
  convertInchesToTwip,
} from 'docx';
import { formatTimestamp, languageLabel, type TranslationExportData } from './types';

const FONT = 'Microsoft YaHei';
const COLORS = {
  primary: '1A1A1A',
  secondary: '555555',
  muted: '888888',
  accent: '1677FF',
  border: 'E0E0E0',
};

function heading(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text, bold: true, size: 28, font: FONT, color: COLORS.primary }),
    ],
    spacing: { before: 280, after: 120 },
  });
}

function bodyText(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text, size: 24, font: FONT, color: COLORS.primary }),
    ],
    spacing: { after: 120, line: 360 },
  });
}

function infoItem(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}：`, bold: true, size: 21, font: FONT, color: COLORS.secondary }),
      new TextRun({ text: value, size: 21, font: FONT, color: COLORS.primary }),
    ],
    spacing: { after: 60 },
  });
}

function separator(): Paragraph {
  return new Paragraph({
    children: [],
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    },
    spacing: { after: 160 },
  });
}

export async function exportToDocx(data: TranslationExportData): Promise<void> {
  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Silvite Translate Lab', bold: true, size: 40, font: FONT, color: COLORS.primary }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'AI-assisted Translation Result', size: 22, font: FONT, color: COLORS.muted }),
      ],
      spacing: { after: 160 },
    }),
    separator()
  );

  // Meta info
  children.push(
    infoItem('源语言', languageLabel(data.sourceLanguage)),
    infoItem('目标语言', languageLabel(data.targetLanguage)),
    infoItem('翻译模式', data.mode),
    infoItem('生成时间', data.generatedAt.toLocaleString()),
    separator()
  );

  // Source & translation
  children.push(heading('原文 / Source'), bodyText(data.sourceText));
  children.push(heading('译文 / Translation'), bodyText(data.translation));

  // Optional context
  if (data.context) {
    children.push(heading('上下文 / Context'), bodyText(data.context));
  }

  // Optional terminology
  if (data.terminology) {
    children.push(heading('术语 / Terminology'), bodyText(data.terminology));
  }

  // Optional detected text (image mode)
  if (data.detectedText) {
    children.push(heading('识别原文 / Detected Text'), bodyText(data.detectedText));
  }

  // Segments
  if (data.segments && data.segments.length > 0) {
    children.push(heading('分段 / Segments'));
    for (const segment of data.segments) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${segment.type}] `, bold: true, size: 21, font: FONT, color: COLORS.accent }),
            new TextRun({ text: segment.source, size: 21, font: FONT, color: COLORS.secondary }),
          ],
          spacing: { before: 120, after: 40 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: segment.translation, size: 22, font: FONT, color: COLORS.primary }),
          ],
          indent: { left: convertInchesToTwip(0.25) },
          spacing: { after: 100 },
        })
      );
    }
  }

  // Notes
  if (data.notes && data.notes.length > 0) {
    children.push(heading('翻译说明 / Notes'));
    for (const note of data.notes) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${note.source} → ${note.translation}`, bold: true, size: 21, font: FONT, color: COLORS.primary }),
            new TextRun({ text: note.reason ? `：${note.reason}` : '', size: 21, font: FONT, color: COLORS.secondary }),
          ],
          spacing: { after: 100 },
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.1),
              right: convertInchesToTwip(1.1),
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Silvite-Translate-${formatTimestamp(data.generatedAt)}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
