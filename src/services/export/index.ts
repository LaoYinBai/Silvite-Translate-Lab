import { exportToDocx } from './exportDocx';
import { exportToPdf } from './exportPdf';
import { exportToMarkdown } from './exportMarkdown';
import type { TranslationExportData, ExportFormat, ExportOptions } from './types';

export type { TranslationExportData, ExportFormat, ExportOptions };

export async function exportTranslation(data: TranslationExportData, format: ExportFormat, options: ExportOptions = {}): Promise<void> {
  switch (format) {
    case 'pdf':
      return exportToPdf(data, options);
    case 'docx':
      return exportToDocx(data, options);
    case 'markdown':
      return exportToMarkdown(data, options);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}
