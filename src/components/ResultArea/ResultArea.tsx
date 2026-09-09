import { useState } from 'react';
import { useTranslationStore } from '../../store/translationStore';
import { ExportMenu } from '../ExportMenu/ExportMenu';
import { languageLabel } from '../../services/export/types';

export function ResultArea() {
  const { result, isLoading, error } = useTranslationStore();
  
  if (!result && !isLoading && !error) {
    return null;
  }
  
  return (
    <div className="w-full mt-6 md:mt-10">
      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {result && !isLoading && <ResultCard result={result} />}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="bg-white rounded-xl border border-[#e0e0e0] p-8 md:p-12">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-7 w-7 text-[#1677ff]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span className="text-[16px] text-[#555555]">翻译中…</span>
        </div>
        <p className="text-[14px] text-[#888888]">通常只需几秒钟</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  const handleRetry = () => {
    useTranslationStore.getState().translate();
  };

  return (
    <div className="bg-white rounded-xl border border-[#ff4d4f] p-6 md:p-10">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-[#fff2f0] flex items-center justify-center flex-shrink-0">
          <svg width="24" height="24" viewBox="0 0 16 16" fill="none" className="text-[#ff4d4f]" aria-hidden="true">
            <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm-.75 3.75a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5zm.75 6.25a.75.75 0 100-1.5.75.75 0 000 1.5z" fill="currentColor"/>
          </svg>
        </div>
        <div>
          <h3 className="text-[17px] font-medium text-[#1a1a1a] mb-2">翻译失败</h3>
          <p className="text-[15px] text-[#555555]">{message}</p>
          <button type="button" onClick={handleRetry} className="btn btn-primary mt-5">
            重试
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: any }) {
  const { showTranslationNotes, toggleShowTranslationNotes, isDemoMode } = useTranslationStore();
  const [copySuccess, setCopySuccess] = useState(false);
  const isDemo = isDemoMode || result.source === 'demo';
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.translation);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1500);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = result.translation;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1500);
    }
  };
  
  const handleRegenerate = () => {
    // Re-runs with the current mode/context/terminology/language direction
    // already held in the store; isLoading drives the UI.
    void useTranslationStore.getState().translate();
  };
  
  return (
    <div className="bg-white rounded-xl border border-[#e0e0e0]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-4 md:px-7 md:py-5 bg-[#fafafa] border-b border-[#f0f0f0] rounded-t-xl min-w-0">
        <div className="flex items-center gap-2.5 md:gap-3 flex-shrink-0">
          <span className="text-[15px] font-medium text-[#1a1a1a]">
            {languageLabel(result.sourceLanguage)}
          </span>
          <svg width="18" height="18" viewBox="0 0 12 12" fill="none" className="text-[#888888]" aria-hidden="true">
            <path d="M2.5 6h7m0 0L6 3m3.5 3L6 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-[15px] font-medium text-[#1a1a1a]">
            {languageLabel(result.targetLanguage)}
          </span>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <button
            onClick={handleCopy}
            className={`btn ${copySuccess ? 'btn-success' : 'btn-secondary'} h-[38px]`}
          >
            {copySuccess ? (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 8l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                已复制
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M5.75 4.75h-2a1 1 0 00-1 1v6.5a1 1 0 001 1h6.5a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8.75 2.75h3.5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M6.5 9.5l6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                复制
              </>
            )}
          </button>
          
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={isDemo}
            aria-label="使用当前设置重新翻译"
            title={isDemo ? '演示数据不支持重新翻译，请输入内容后翻译' : '使用当前设置重新翻译'}
            className="btn btn-secondary h-[38px]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2.5 2.5v4h4M13.5 13.5v-4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M13.25 6.25A5.5 5.5 0 003 3.5L2.5 4m11 8l.5.5a5.5 5.5 0 01-10-2.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            重新翻译
          </button>
          
          <button
            type="button"
            onClick={toggleShowTranslationNotes}
            aria-pressed={showTranslationNotes}
            className={`btn btn-secondary h-[38px] ${showTranslationNotes ? 'bg-[#e6f4ff] border-[#1677ff] text-[#1677ff]' : ''}`}
            title="显示或隐藏翻译说明（不触发重新翻译）"
          >
            翻译说明
            <span
              className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                showTranslationNotes
                  ? 'bg-[#1677ff] text-white'
                  : 'bg-[#f0f0f0] text-[#888888]'
              }`}
            >
              {showTranslationNotes ? 'ON' : 'OFF'}
            </span>
          </button>
          
          <ExportMenu />
        </div>
      </div>
      
      {/* Translation result */}
      <div className="p-7">
        <p className="text-[17px] leading-[1.8] text-[#1a1a1a] whitespace-pre-wrap">
          {result.translation}
        </p>
      </div>
      
      {/* Detected text (for image mode) */}
      {result.detectedText && (
        <div className="mx-4 mb-6 md:mx-7 md:mb-7 p-4 md:p-6 bg-[#f7f8fa] rounded-xl">
          <h4 className="text-[13px] font-semibold text-[#888888] uppercase tracking-wider mb-3">
            识别文本
          </h4>
          <p className="text-[15px] leading-[1.7] text-[#555555]">
            {result.detectedText}
          </p>
        </div>
      )}
      
      {/* Segments */}
      {result.segments && result.segments.length > 0 && (
        <div className="mx-4 mb-6 md:mx-7 md:mb-7">
          <h4 className="text-[13px] font-semibold text-[#888888] uppercase tracking-wider mb-4">
            分段结果
          </h4>
          <div className="space-y-3">
            {result.segments.map((segment: any, index: number) => (
              <div key={index} className="p-4 md:p-5 bg-[#f7f8fa] rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2.5 py-1 text-[12px] font-medium bg-[#e6f4ff] text-[#1677ff] rounded-md">
                    {{ dialogue: '对白', narration: '旁白', sound_effect: '拟声词', title: '标题', ui_text: '界面文字', sign: '标牌', caption: '图注', background_text: '背景文字', text: '文本' }[segment.type as string] || segment.type}
                  </span>
                  {segment.speaker && (
                    <span className="px-2.5 py-1 text-[12px] font-medium bg-[#f0f0f0] text-[#555555] rounded-md">
                      {segment.speaker}
                    </span>
                  )}
                  {typeof segment.panel === 'number' && (
                    <span className="px-2.5 py-1 text-[12px] font-medium bg-[#f0f0f0] text-[#555555] rounded-md">
                      画格 {segment.panel}
                    </span>
                  )}
                </div>
                <p className="text-[14px] text-[#888888] mb-2">{segment.source}</p>
                <p className="text-[15px] text-[#1a1a1a]">{segment.translation}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Notes - display controlled by the toggle; data always kept in state */}
      {showTranslationNotes && (
        <div className="mx-4 mb-6 md:mx-7 md:mb-7">
          <h4 className="text-[13px] font-semibold text-[#888888] uppercase tracking-wider mb-4">
            翻译说明
          </h4>
          {result.notes && result.notes.length > 0 ? (
            <div className="space-y-3">
              {result.notes.map((note: any, index: number) => (
                <div key={index} className="flex items-start gap-3 text-[14px]">
                  <span className="text-[#888888] mt-1">•</span>
                  <span className="text-[#555555]">
                    <span className="font-medium text-[#1a1a1a]">{note.source}</span>
                    {' → '}
                    <span className="font-medium text-[#1a1a1a]">{note.translation}</span>
                    {note.reason && ` — ${note.reason}`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[14px] text-[#888888]">
              本次翻译没有需要特别说明的内容
            </p>
          )}
        </div>
      )}
    </div>
  );
}
