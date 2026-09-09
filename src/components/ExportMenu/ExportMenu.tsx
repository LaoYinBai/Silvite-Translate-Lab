import { useEffect, useRef, useState } from 'react';
import { useTranslationStore } from '../../store/translationStore';
import { exportTranslation, type ExportFormat, type TranslationExportData } from '../../services/export';

export function ExportMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { result, inputText, mode, context, terminology } = useTranslationStore();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const disabled = !result;

  function buildExportData(): TranslationExportData {
    if (!result) throw new Error('没有可导出的翻译结果');
    return {
      sourceLanguage: result.sourceLanguage,
      targetLanguage: result.targetLanguage,
      mode,
      sourceText: inputText || result.detectedText || '',
      translation: result.translation,
      detectedText: result.detectedText,
      context: context || undefined,
      terminology: terminology || undefined,
      notes: result.notes,
      segments: result.segments,
      generatedAt: new Date(),
    };
  }

  async function handleExport(format: ExportFormat) {
    setIsOpen(false);
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = buildExportData();
      await exportTranslation(data, format);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败，请重试');
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`btn btn-secondary h-[38px] ${success ? 'btn-success' : ''}`}
        title={disabled ? '暂无可导出的翻译结果' : '导出结果'}
      >
        {busy ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            导出中…
          </>
        ) : success ? (
          <>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 8l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            已导出
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3M8 2v8m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            导出
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
              <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 bg-white border border-[#e0e0e0] rounded-lg shadow-md py-1 z-50"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleExport('pdf')}
            className="w-full px-3 py-2 text-left text-[13px] text-[#1a1a1a] hover:bg-[#f5f5f5] flex items-center gap-2"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 1.5h5.5L13 5v9.5H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M9.5 1.5V5H13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            </svg>
            导出 PDF
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleExport('docx')}
            className="w-full px-3 py-2 text-left text-[13px] text-[#1a1a1a] hover:bg-[#f5f5f5] flex items-center gap-2"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 1.5h5.5L13 5v9.5H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M9.5 1.5V5H13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            </svg>
            导出 Word
          </button>
        </div>
      )}

      {error && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-[#ff4d4f] rounded-lg shadow-md p-3 z-50">
          <p className="text-[12px] text-[#ff4d4f]">{error}</p>
        </div>
      )}
    </div>
  );
}
