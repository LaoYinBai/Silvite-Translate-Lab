import type { TranslationRequest, TranslationResponse, TranslationStreamHandlers } from '../../api/client';
import { translateStream } from '../../api/client';
import { openPdfPageSource } from './pdfPageRenderer';

// Pages sent as images in one run. Vision requests are far more expensive than
// text, so the route is explicit and bounded rather than automatic.
export const MAX_VISION_PAGES = 20;

export type PdfVisionStatus = 'rendering' | 'translating' | 'assembling';

export interface PdfVisionProgress {
  percent: number;
  status: PdfVisionStatus;
  provisionalText: string;
}

export interface PdfVisionSource {
  pageCount: number;
  renderPage: (pageNumber: number) => Promise<string>;
}

export interface PdfVisionInput {
  file: File;
  mode?: string;
  context?: string;
  terminology?: string;
  preserveNames?: boolean;
  explainTranslation?: boolean;
  model?: TranslationRequest['model'];
}

export interface PdfVisionDependencies {
  openSource?: (file: File) => Promise<PdfVisionSource>;
  translatePage?: (
    request: TranslationRequest,
    handlers: TranslationStreamHandlers,
    signal?: AbortSignal,
  ) => Promise<TranslationResponse>;
  signal?: AbortSignal;
  onProgress?: (progress: PdfVisionProgress) => void;
  maxPages?: number;
}

const PAGE_SEPARATOR = '\n\n';

function pageContext(input: PdfVisionInput, pageNumber: number, pageCount: number): string {
  const sections = [input.context?.trim()].filter(Boolean) as string[];
  sections.push(
    '【扫描 PDF 逐页翻译】',
    `这是同一份文档的第 ${pageNumber} 页（共 ${pageCount} 页），只翻译本页内容，不要重复其他页。`,
    '页面中的正文、标题、表格和标注都需要翻译；页码、页眉页脚等版面元素可以忽略。',
  );
  if (input.terminology?.trim()) sections.push('已确认术语和专有名词以 Terminology 为准。');
  return sections.join('\n');
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('Aborted', 'AbortError');
}

/**
 * Translates a PDF that has no usable text layer by rendering each page to an
 * image and sending it through the existing image translation path. Pages are
 * requested one at a time so a failure cannot lose already confirmed pages.
 */
export async function translatePdfAsImages(
  input: PdfVisionInput,
  dependencies: PdfVisionDependencies = {},
): Promise<TranslationResponse> {
  const openSource = dependencies.openSource ?? openPdfPageSource;
  const translatePage = dependencies.translatePage ?? translateStream;
  const maxPages = dependencies.maxPages ?? MAX_VISION_PAGES;

  const source = await openSource(input.file);
  if (source.pageCount > maxPages) {
    throw new Error(`这份 PDF 共 ${source.pageCount} 页，逐页视觉翻译一次最多处理 ${maxPages} 页，请拆分文件后重试`);
  }
  if (!source.pageCount) throw new Error('这份 PDF 没有可翻译的页面');

  const parts: string[] = [];
  const notes: TranslationResponse['notes'] = [];
  let sourceLanguage = 'unknown';
  let targetLanguage = '';
  let detectedStyle: TranslationResponse['detected_style'];
  let completed = 0;

  const report = (status: PdfVisionStatus, current = '') => {
    const percent = status === 'assembling' ? 100 : Math.min(99, Math.round((completed / source.pageCount) * 100));
    dependencies.onProgress?.({ percent, status, provisionalText: parts.join(PAGE_SEPARATOR) + current });
  };

  report('rendering');
  for (let pageNumber = 1; pageNumber <= source.pageCount; pageNumber++) {
    if (dependencies.signal?.aborted) throw abortReason(dependencies.signal);
    const imageDataUrl = await source.renderPage(pageNumber);
    if (dependencies.signal?.aborted) throw abortReason(dependencies.signal);

    let provisional = '';
    const request: TranslationRequest = {
      imageDataUrl,
      mode: input.mode,
      context: pageContext(input, pageNumber, source.pageCount),
      terminology: input.terminology,
      preserveNames: input.preserveNames,
      explainTranslation: input.explainTranslation,
      model: input.model,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await translatePage(request, {
          onDelta: (delta) => {
            if (dependencies.signal?.aborted) return;
            provisional += delta;
            report('translating', provisional);
          },
          onReset: () => {
            if (dependencies.signal?.aborted) return;
            provisional = '';
            report('translating');
          },
        }, dependencies.signal);
        sourceLanguage = response.source_language || sourceLanguage;
        targetLanguage = response.target_language || targetLanguage;
        detectedStyle ||= response.detected_style;
        parts.push(response.translation);
        notes.push(...(response.notes || []));
        completed += 1;
        report('translating');
        break;
      } catch (error) {
        if (dependencies.signal?.aborted) throw abortReason(dependencies.signal);
        if (attempt === 1) throw error;
        provisional = '';
        report('translating');
      }
    }
  }

  report('assembling');
  return {
    source_language: sourceLanguage,
    target_language: targetLanguage,
    detected_style: input.mode && input.mode !== 'auto' ? input.mode as TranslationResponse['detected_style'] : detectedStyle,
    translation: parts.join(PAGE_SEPARATOR),
    detected_text: null,
    segments: [],
    notes,
  };
}
