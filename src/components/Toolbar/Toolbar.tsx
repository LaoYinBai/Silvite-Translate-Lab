import { useState } from 'react';
import { useTranslationStore, type TranslationMode } from '../../store/translationStore';

const MODE_OPTIONS: { value: TranslationMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'natural', label: 'Natural' },
  { value: 'literary', label: 'Literary' },
  { value: 'academic', label: 'Academic' },
  { value: 'business', label: 'Business' },
  { value: 'comic', label: 'Comic' },
];

export function Toolbar() {
  const { 
    mode, 
    setMode, 
    result,
    context,
    setContext,
    terminology,
    setTerminology,
    preserveNames,
    setPreserveNames,
    explainTranslation,
    setExplainTranslation
  } = useTranslationStore();
  
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  return (
    <div className="bg-white border-b border-[#e1e4e8]">
      {/* Main toolbar row */}
      <div className="h-9 flex items-center justify-between px-4">
        {/* Left: Language & Mode */}
        <div className="flex items-center gap-4">
          {/* Language detection */}
          <div className="flex items-center gap-1.5">
            {result ? (
              <>
                <span className="text-[12px] font-medium text-[#1f2328]">
                  {result.sourceLanguage === 'zh' ? '中文' : 'English'}
                </span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[#8b949e]">
                  <path d="M2.5 6h7m0 0L6 3m3.5 3L6 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[12px] font-medium text-[#1f2328]">
                  {result.targetLanguage === 'zh' ? '中文' : 'English'}
                </span>
              </>
            ) : (
              <span className="text-[12px] text-[#afb8c1]">Auto detect</span>
            )}
          </div>
          
          {/* Divider */}
          <div className="w-px h-4 bg-[#e1e4e8]" />
          
          {/* Mode selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#8b949e]">Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as TranslationMode)}
              className="text-[12px] font-medium text-[#1f2328] bg-transparent border-none outline-none cursor-pointer hover:text-[#0969da] transition-colors appearance-none pr-4"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%238b949e\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right center' }}
            >
              {MODE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Right: Advanced toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`flex items-center gap-1 text-[12px] transition-colors ${
            showAdvanced 
              ? 'text-[#0969da]' 
              : 'text-[#8b949e] hover:text-[#656d76]'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M13.5 8c0-.5-.3-1-.8-1.2l-1-.4-.2-1c-.1-.3-.4-.6-.7-.7l-1-.2-.4-1C9.2 2.3 8.7 2 8.2 2h-.4c-.5 0-1 .3-1.2.8L6.2 3.8l-1 .2c-.3.1-.6.4-.7.7l-.2 1-1 .4c-.5.2-.8.7-.8 1.2v.4c0 .5.3 1 .8 1.2l1 .4.2 1c.1.3.4.6.7.7l1 .2.4 1c.2.5.7.8 1.2.8h.4c.5 0 1-.3 1.2-.8l.4-1 1-.2c.3-.1.6-.4.7-.7l.2-1 1-.4c.5-.2.8-.7.8-1.2v-.4z" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          Advanced
        </button>
      </div>
      
      {/* Advanced panel */}
      {showAdvanced && (
        <div className="px-4 py-3 bg-[#f6f8fa] border-t border-[#e1e4e8]">
          <div className="flex flex-wrap gap-4">
            {/* Context */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] font-medium text-[#656d76] mb-1">
                Context
              </label>
              <input
                type="text"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="e.g., 科技产品官网文案"
                className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d9e0] rounded-sm outline-none focus:border-[#0969da] focus:ring-1 focus:ring-[#0969da] transition-shadow placeholder:text-[#afb8c1]"
              />
            </div>
            
            {/* Terminology */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] font-medium text-[#656d76] mb-1">
                Terminology
              </label>
              <input
                type="text"
                value={terminology}
                onChange={(e) => setTerminology(e.target.value)}
                placeholder="e.g., MoDi Connect 不翻译"
                className="w-full h-7 px-2 text-[12px] bg-white border border-[#d1d9e0] rounded-sm outline-none focus:border-[#0969da] focus:ring-1 focus:ring-[#0969da] transition-shadow placeholder:text-[#afb8c1]"
              />
            </div>
            
            {/* Checkboxes */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preserveNames}
                  onChange={(e) => setPreserveNames(e.target.checked)}
                  className="w-3.5 h-3.5 rounded-sm border-[#d1d9e0] text-[#0969da] focus:ring-[#0969da] cursor-pointer"
                />
                <span className="text-[12px] text-[#656d76]">Preserve names</span>
              </label>
              
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={explainTranslation}
                  onChange={(e) => setExplainTranslation(e.target.checked)}
                  className="w-3.5 h-3.5 rounded-sm border-[#d1d9e0] text-[#0969da] focus:ring-[#0969da] cursor-pointer"
                />
                <span className="text-[12px] text-[#656d76]">Explain translation</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
