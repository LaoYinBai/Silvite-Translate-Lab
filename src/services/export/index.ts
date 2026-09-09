import { exportToDocx } from './exportDocx';
import { exportToPdf } from './exportPdf';
import type { TranslationExportData, ExportFormat } from './types';

export type { TranslationExportData, ExportFormat };

export async function exportTranslation(data: TranslationExportData, format: ExportFormat): Promise<void> {
  switch (format) {
    case 'pdf':
      return exportToPdf(data);
    case 'docx':
      return exportToDocx(data);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}
