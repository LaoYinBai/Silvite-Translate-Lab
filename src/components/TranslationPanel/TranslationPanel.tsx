import { useTranslationStore, type TranslationSegment, type TranslationNote } from '../../store/translationStore';

export function TranslationPanel() {
  const { result, isLoading, error } = useTranslationStore();
  
  const handleCopy = async () => {
    if (result?.translation) {
      try {
        await navigator.clipboard.writeText(result.translation);
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = result.translation;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
    }
  };
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[--color-border-muted]">
        <span className="text-xs font-medium text-[--color-text-secondary] uppercase tracking-wider">
          Translation
        </span>
        <div className="flex items-center gap-1">
          {result && (
            <>
              <button
                onClick={handleCopy}
                className="px-2 py-1 text-xs text-[--color-text-tertiary] hover:text-[--color-text-secondary] transition-colors"
                title="Copy translation"
              >
                Copy
              </button>
              <button
                className="px-2 py-1 text-xs text-[--color-text-tertiary] hover:text-[--color-text-secondary] transition-colors"
                title="Regenerate"
              >
                Regenerate
              </button>
            </>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <svg className="animate-spin h-6 w-6 text-[--color-accent]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <span className="text-sm text-[--color-text-secondary]">Translating...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-sm text-[--color-danger] mb-2">{error}</p>
              <button className="text-xs text-[--color-accent] hover:underline">
                Try again
              </button>
            </div>
          </div>
        ) : result ? (
          <div className="space-y-4">
            {/* Language detection */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[--color-text-tertiary]">Detected:</span>
              <span className="px-2 py-0.5 bg-[--color-canvas-subtle] rounded text-[--color-text-secondary]">
                {result.sourceLanguage === 'zh' ? '中文' : 'English'}
              </span>
              <span className="text-[--color-text-tertiary]">→</span>
              <span className="px-2 py-0.5 bg-[--color-canvas-subtle] rounded text-[--color-text-secondary]">
                {result.targetLanguage === 'zh' ? '中文' : 'English'}
              </span>
            </div>
            
            {/* Main translation */}
            <div className="text-sm leading-relaxed text-[--color-text-primary] whitespace-pre-wrap">
              {result.translation}
            </div>
            
            {/* Segments (for image mode) */}
            {result.segments && result.segments.length > 0 && (
              <div className="mt-6 pt-4 border-t border-[--color-border-muted]">
                <h3 className="text-xs font-medium text-[--color-text-secondary] uppercase tracking-wider mb-3">
                  Segments
                </h3>
                <div className="space-y-3">
                  {result.segments.map((segment: TranslationSegment, index: number) => (
                    <div key={index} className="text-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[--color-accent-muted] text-[--color-accent] rounded">
                          {segment.type}
                        </span>
                      </div>
                      <div className="text-[--color-text-tertiary] text-xs mb-0.5">
                        {segment.source}
                      </div>
                      <div className="text-[--color-text-primary]">
                        {segment.translation}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Notes */}
            {result.notes && result.notes.length > 0 && (
              <div className="mt-6 pt-4 border-t border-[--color-border-muted]">
                <h3 className="text-xs font-medium text-[--color-text-secondary] uppercase tracking-wider mb-3">
                  Translation Notes
                </h3>
                <div className="space-y-2">
                  {result.notes.map((note: TranslationNote, index: number) => (
                    <div key={index} className="text-xs p-2 bg-[--color-canvas-subtle] rounded">
                      <div className="text-[--color-text-secondary]">
                        <span className="font-medium">{note.source}</span> → <span className="font-medium">{note.translation}</span>
                      </div>
                      <div className="text-[--color-text-tertiary] mt-0.5">
                        {note.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[--color-text-placeholder]">
              翻译结果将显示在这里
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
