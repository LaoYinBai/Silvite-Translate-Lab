import { formatTimestamp, languageLabel, type TranslationExportData } from './types';

/**
 * Real text-based PDF export via the browser print pipeline (choose
 * "Save as PDF" in the print dialog). Produces searchable, copyable text
 * with automatic pagination; Chinese is rendered by system fonts, so no
 * font embedding (and no 10MB font payload) is required.
 */
export function exportPrintPdf(data: TranslationExportData): void {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const section = (title: string, body: string) =>
    `<h2>${esc(title)}</h2><p>${esc(body).replace(/\n/g, '<br/>')}</p>`;

  let optional = '';
  if (data.context) optional += section('上下文 / Context', data.context);
  if (data.terminology) optional += section('术语 / Terminology', data.terminology);
  if (data.detectedText) optional += section('识别原文 / Detected Text', data.detectedText);

  let segments = '';
  if (data.segments && data.segments.length > 0) {
    segments =
      '<h2>分段 / Segments</h2>' +
      data.segments
        .map(
          (s) =>
            `<p class="segment"><span class="tag">${esc(s.type)}</span>` +
            `${esc(s.source)}<br/><strong>${esc(s.translation)}</strong></p>`
        )
        .join('');
  }

  let notes = '';
  if (data.notes && data.notes.length > 0) {
    notes =
      '<h2>翻译说明 / Notes</h2>' +
      data.notes
        .map(
          (n) =>
            `<p class="note"><strong>${esc(n.source)} → ${esc(n.translation)}</strong>` +
            (n.reason ? `：${esc(n.reason)}` : '') +
            '</p>'
        )
        .join('');
  }

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>Silvite-Translate-${formatTimestamp(data.generatedAt)}</title>
<style>
  @page { margin: 18mm 20mm; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI",
      "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
    font-size: 12pt; line-height: 1.7; color: #1a1a1a; margin: 0;
  }
  h1 { font-size: 20pt; margin: 0 0 4px; }
  .subtitle { color: #888888; font-size: 10.5pt; margin: 0 0 16px; }
  hr { border: none; border-top: 1px solid #e0e0e0; margin: 16px 0; }
  h2 { font-size: 13pt; margin: 20px 0 8px; }
  p { margin: 6px 0; }
  .meta { color: #555555; font-size: 10.5pt; margin: 2px 0; }
  .tag {
    display: inline-block; background: #e6f4ff; color: #1677ff;
    font-size: 9pt; padding: 1px 8px; border-radius: 4px; margin-right: 8px;
  }
  .segment { margin: 10px 0 4px; }
  .note { margin: 6px 0; }
</style>
</head>
<body>
<h1>Silvite Translate Lab</h1>
<p class="subtitle">AI-assisted Translation Result</p>
<hr/>
<p class="meta">源语言：${esc(languageLabel(data.sourceLanguage))}</p>
<p class="meta">目标语言：${esc(languageLabel(data.targetLanguage))}</p>
<p class="meta">翻译模式：${esc(data.mode)}</p>
<p class="meta">生成时间：${esc(data.generatedAt.toLocaleString())}</p>
<hr/>
${section('原文 / Source', data.sourceText)}
${section('译文 / Translation', data.translation)}
${optional}
${segments}
${notes}
</body>
</html>`;

  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) {
    throw new Error('弹窗被浏览器拦截，请允许弹窗后重试');
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give the new document a moment to lay out before opening the print dialog.
  win.setTimeout(() => win.print(), 250);
}
