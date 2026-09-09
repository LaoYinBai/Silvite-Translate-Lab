import { jsPDF } from 'jspdf';
import { formatTimestamp, languageLabel, type TranslationExportData } from './types';

/**
 * True one-click text PDF: Noto Sans SC is fetched at export time from a
 * public CDN and subset-embedded by jsPDF, so the output is searchable,
 * copyable, paginated, and renders Chinese correctly. The font is cached in
 * module scope so repeated exports in one session do not re-download it.
 */
const FONT_CDN_URLS = [
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
  'https://fastly.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
];

let cachedFontBase64: string | null = null;

async function loadChineseFontBase64(): Promise<string> {
  if (cachedFontBase64) return cachedFontBase64;

  let lastError: unknown = null;
  for (const url of FONT_CDN_URLS) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      cachedFontBase64 = arrayBufferToBase64(buffer);
      return cachedFontBase64;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `中文字体加载失败，请检查网络后重试（${lastError instanceof Error ? lastError.message : 'unknown'}）`
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const PAGE = {
  margin: { top: 22, bottom: 22, left: 18, right: 18 },
  width: 210,
  height: 297,
  sizes: { title: 20, subtitle: 12, heading: 14, body: 11, caption: 9, meta: 10.5 },
  lineHeightFactor: 1.6,
};

function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export async function exportToPdf(data: TranslationExportData): Promise<void> {
  const fontBase64 = await loadChineseFontBase64();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.addFileToVFS('NotoSansSC.ttf', fontBase64);
  doc.addFont('NotoSansSC.ttf', 'NotoSansSC', 'normal');
  doc.setFont('NotoSansSC', 'normal');

  const contentWidth = PAGE.width - PAGE.margin.left - PAGE.margin.right;
  let y = PAGE.margin.top;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE.height - PAGE.margin.bottom) {
      doc.addPage();
      y = PAGE.margin.top;
    }
  };

  const writeBlock = (text: string, size: number, bold: boolean, gapAfter: number) => {
    doc.setFont('NotoSansSC', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lineHeight = size * PAGE.lineHeightFactor * 0.352778;
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(esc(line), PAGE.margin.left, y);
      y += lineHeight;
    }
    y += gapAfter;
  };

  const heading = (title: string) => writeBlock(title, PAGE.sizes.heading, true, 2);
  const body = (text: string) => {
    writeBlock(text, PAGE.sizes.body, false, 5);
  };

  // Title block
  doc.setFont('NotoSansSC', 'bold');
  doc.setFontSize(PAGE.sizes.title);
  doc.text('Silvite Translate Lab', PAGE.margin.left, y);
  y += PAGE.sizes.title * 0.5;
  doc.setFont('NotoSansSC', 'normal');
  doc.setFontSize(PAGE.sizes.subtitle);
  doc.setTextColor(130, 130, 130);
  doc.text('AI-assisted Translation Result', PAGE.margin.left, y);
  doc.setTextColor(0, 0, 0);
  y += 10;
  doc.setDrawColor(210, 210, 210);
  doc.line(PAGE.margin.left, y, PAGE.width - PAGE.margin.right, y);
  y += 8;

  // Meta
  const metaLines = [
    `源语言：${languageLabel(data.sourceLanguage)}`,
    `目标语言：${languageLabel(data.targetLanguage)}`,
    `翻译模式：${data.mode}`,
    `生成时间：${data.generatedAt.toLocaleString()}`,
  ];
  for (const line of metaLines) {
    ensureSpace(5);
    doc.setFontSize(PAGE.sizes.meta);
    doc.text(esc(line), PAGE.margin.left, y);
    y += 5.5;
  }
  y += 2;
  ensureSpace(2);
  doc.line(PAGE.margin.left, y, PAGE.width - PAGE.margin.right, y);
  y += 8;

  // Core content
  heading('原文 / Source');
  body(data.sourceText);
  heading('译文 / Translation');
  body(data.translation);

  // Optional sections
  if (data.context) {
    heading('上下文 / Context');
    body(data.context);
  }
  if (data.terminology) {
    heading('术语 / Terminology');
    body(data.terminology);
  }
  if (data.detectedText) {
    heading('识别原文 / Detected Text');
    body(data.detectedText);
  }
  if (data.segments && data.segments.length > 0) {
    heading('分段 / Segments');
    for (const segment of data.segments) {
      ensureSpace(12);
      doc.setFont('NotoSansSC', 'bold');
      doc.setFontSize(PAGE.sizes.caption + 1);
      doc.setTextColor(22, 119, 255);
      doc.text(`[${segment.type}]`, PAGE.margin.left, y);
      doc.setTextColor(0, 0, 0);
      y += 5;
      doc.setFont('NotoSansSC', 'normal');
      body(`${segment.source}\n${segment.translation}`);
    }
  }
  if (data.notes && data.notes.length > 0) {
    heading('翻译说明 / Notes');
    for (const note of data.notes) {
      body(`${note.source} → ${note.translation}${note.reason ? `：${note.reason}` : ''}`);
    }
  }

  // Footer: page numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('NotoSansSC', 'normal');
    doc.setFontSize(PAGE.sizes.caption);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Silvite Translate Lab - ${i} / ${pageCount}`,
      PAGE.width / 2,
      PAGE.height - 10,
      { align: 'center' }
    );
  }
  doc.setTextColor(0, 0, 0);

  doc.save(`Silvite-Translate-${formatTimestamp(data.generatedAt)}.pdf`);
}
