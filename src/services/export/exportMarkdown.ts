import { formatTimestamp, languageLabel, type TranslationExportData } from './types';

// Keep arbitrary source text inside its section, including HTML, headings,
// links and code fences that should be displayed as text in the report.
function plainText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+.!|~-])/g, '\\$1')
    .replace(/\n/g, '  \n');
}

export async function exportToMarkdown(data: TranslationExportData): Promise<void> {
  const sections = [
    '# Silvite Translate Lab',
    'AI-assisted Translation Result',
    [
      `- 源语言：${plainText(languageLabel(data.sourceLanguage))}`,
      `- 目标语言：${plainText(languageLabel(data.targetLanguage))}`,
      `- 翻译模式：${plainText(data.mode)}`,
      `- 生成时间：${data.generatedAt.toLocaleString()}`,
    ].join('\n'),
  ];
  const append = (title: string, text: string, level = 2) => {
    sections.push(`${'#'.repeat(level)} ${title}`, plainText(text));
  };

  append('原文 / Source', data.sourceText);
  append('译文 / Translation', data.translation);
  if (data.context) append('上下文 / Context', data.context);
  if (data.terminology) append('术语 / Terminology', data.terminology);
  if (data.detectedText) append('识别原文 / Detected Text', data.detectedText);
  if (data.segments?.length) {
    sections.push('## 分段 / Segments');
    for (const [index, segment] of data.segments.entries()) {
      sections.push(`### ${index + 1} · ${plainText(segment.type)}`);
      append('原文 / Source', segment.source, 4);
      append('译文 / Translation', segment.translation, 4);
    }
  }
  if (data.notes?.length) {
    sections.push('## 翻译说明 / Notes');
    for (const note of data.notes) {
      sections.push(plainText(`${note.source} → ${note.translation}${note.reason ? `：${note.reason}` : ''}`));
    }
  }

  const blob = new Blob([`${sections.join('\n\n')}\n`], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Silvite-Translate-${formatTimestamp(data.generatedAt)}.md`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give mobile browsers time to begin the download before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
