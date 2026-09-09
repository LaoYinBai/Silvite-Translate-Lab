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

// UI 层语言显示统一使用中文语言名。键全部小写，兼容 ISO 代码、英文名、
// 原生名与后端可能返回的各种写法；未收录时原样显示，不再转大写缩写。
const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  'chinese': '中文',
  '中文': '中文',
  en: '英语',
  english: '英语',
  english_us: '英语',
  '英文': '英语',
  ja: '日语',
  jp: '日语',
  japanese: '日语',
  '日本語': '日语',
  '日文': '日语',
  '日语': '日语',
  ko: '韩语',
  korean: '韩语',
  '한국어': '韩语',
  '韩文': '韩语',
  '韩语': '韩语',
  fr: '法语',
  french: '法语',
  français: '法语',
  '法文': '法语',
  '法语': '法语',
  de: '德语',
  german: '德语',
  deutsch: '德语',
  '德文': '德语',
  '德语': '德语',
  es: '西班牙语',
  spanish: '西班牙语',
  español: '西班牙语',
  '西班牙文': '西班牙语',
  '西班牙语': '西班牙语',
  ar: '阿拉伯语',
  arabic: '阿拉伯语',
  'العربية': '阿拉伯语',
  '阿拉伯语': '阿拉伯语',
  ru: '俄语',
  russian: '俄语',
  русский: '俄语',
  '俄文': '俄语',
  '俄语': '俄语',
  it: '意大利语',
  italian: '意大利语',
  italiano: '意大利语',
  '意大利语': '意大利语',
  pt: '葡萄牙语',
  portuguese: '葡萄牙语',
  português: '葡萄牙语',
  '葡萄牙语': '葡萄牙语',
  th: '泰语',
  thai: '泰语',
  'ไทย': '泰语',
  vi: '越南语',
  vietnamese: '越南语',
  'tiếng việt': '越南语',
  '越南语': '越南语',
};

export function languageLabel(code: string): string {
  if (!code) return '—';
  const normalized = code.trim().toLowerCase();
  const base = normalized.split(/[-_]/)[0];
  return LANGUAGE_LABELS[normalized] || LANGUAGE_LABELS[base] || code.trim();
}
