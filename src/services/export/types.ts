import type { TranslationNote, TranslationSegment } from '../../store/translationStore';

export interface TranslationExportData {
  sourceLanguage: string;
  targetLanguage: string;
  mode: string;
  sourceText: string;
  translation: string;
  detectedText?: string | null;
  context?: string;
  terminology?: string;
  notes?: TranslationNote[];
  segments?: TranslationSegment[];
  generatedAt: Date;
}

export type ExportFormat = 'pdf' | 'docx';

export function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}${m}${d}-${h}${min}`;
}

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  ru: 'Русский',
  pt: 'Português',
  it: 'Italiano',
  th: 'ไทย',
  vi: 'Tiếng Việt',
};

export function languageLabel(code: string): string {
  if (!code) return '—';
  const base = code.toLowerCase().split('-')[0];
  return LANGUAGE_LABELS[base] || code.toUpperCase();
}
