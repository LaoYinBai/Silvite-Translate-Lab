import { exportToDocx } from './exportDocx';
import { exportPrintPdf } from './exportPrintPdf';
import type { TranslationExportData, ExportFormat } from './types';

export type { TranslationExportData, ExportFormat };

export function exportTranslation(data: TranslationExportData, format: ExportFormat): void {
  switch (format) {
    case 'pdf':
      exportPrintPdf(data);
      return;
    case 'docx':
      void exportToDocx(data);
      return;
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}
