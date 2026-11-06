import { exportToDocx } from './exportDocx';
import { exportToPdf } from './exportPdf';
import { exportToMarkdown } from './exportMarkdown';
import type { TranslationExportData, ExportFormat } from './types';

export type { TranslationExportData, ExportFormat };

export async function exportTranslation(data: TranslationExportData, format: ExportFormat): Promise<void> {
  switch (format) {
    case 'pdf':
      return exportToPdf(data);
    case 'docx':
      return exportToDocx(data);
    case 'markdown':
      return exportToMarkdown(data);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}
