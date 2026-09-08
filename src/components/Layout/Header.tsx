import { useTranslationStore } from '../../store/translationStore';

export function Header() {
  const { isServiceOnline } = useTranslationStore();
  
  return (
    <header className="h-11 flex items-center justify-between px-4 bg-[#f6f8fa] border-b border-[#d1d9e0] select-none">
      {/* Left: Brand */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-[#0969da]">
            <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/>
          </svg>
          <span className="text-[13px] font-semibold text-[#1f2328] tracking-[-0.01em]">
            Silvite Translate
          </span>
        </div>
        <span className="text-[11px] text-[#8b949e] font-normal">
          Lab
        </span>
      </div>
      
      {/* Right: Status & Links */}
      <div className="flex items-center gap-3">
        {!isServiceOnline && (
          <span className="text-[11px] text-[#bf8700] bg-[#fff8c5] px-2 py-0.5 rounded-sm">
            Service Offline
          </span>
        )}
        <span className="text-[11px] text-[#8b949e]">
          Experimental
        </span>
      </div>
    </header>
  );
}
