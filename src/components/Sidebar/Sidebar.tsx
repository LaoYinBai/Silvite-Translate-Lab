import { useTranslationStore } from '../../store/translationStore';
import { DEMO_SAMPLES } from '../../demo/samples';

interface SidebarProps {
  onNewChat: () => void;
}

export function Sidebar({ onNewChat }: SidebarProps) {
  const { isServiceOnline } = useTranslationStore();

  return (
    <aside className="w-[280px] h-full flex flex-col bg-[#fafafa] border-r border-[#e8e8e8] select-none flex-shrink-0">
      {/* Logo & Brand */}
      <div className="h-[68px] flex items-center px-5 border-b border-[#e8e8e8]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#1677ff] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white" aria-hidden="true">
              <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/>
            </svg>
          </div>
          <div>
            <h1 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1a1a1a] leading-5">Silvite</h1>
            <p className="text-[12px] text-[#777777] leading-4">多语言翻译站</p>
          </div>
        </div>
      </div>
      
      {/* New Translation Button */}
      <div className="p-4">
        <button
          onClick={onNewChat}
          className="btn btn-primary w-full"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          新建翻译
        </button>
      </div>
      
      {/* Demo samples - explicitly labeled, not fake history */}
      <div className="flex-1 overflow-y-auto px-3">
        <div className="mb-2 px-2">
          <span className="text-[12px] font-medium text-[#888888] uppercase tracking-wider">
            演示样本
          </span>
        </div>
        
        <div className="space-y-1">
          {DEMO_SAMPLES.map((demo, index) => (
            <button
              key={demo.title}
              onClick={() => useTranslationStore.getState().loadDemoSample(index)}
              className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left text-[#1a1a1a] hover:bg-[#f0f0f0] transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="mt-0.5 flex-shrink-0 opacity-60" aria-hidden="true">
                <path d="M2 3h12M2 6.5h12M2 10h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium truncate">{demo.title}</p>
                <p className="text-[12px] text-[#888888] mt-0.5">{demo.subtitle}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
      
      {/* Bottom: real service status (from OPTIONS health check) */}
      <div className="p-4 border-t border-[#e8e8e8]">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className={`w-2.5 h-2.5 rounded-full ${isServiceOnline ? 'bg-[#52c41a]' : 'bg-[#ff4d4f]'}`} />
          <span className="text-[13px] text-[#555555]">
            {isServiceOnline ? '服务可用' : '服务不可用'}
          </span>
        </div>

        {/* ICP & public security filing */}
        <footer className="site-footer mt-1 pt-2 border-t border-[#e8e8e8] flex flex-col items-center gap-1 px-2">
          <a
            href="https://beian.mps.gov.cn/#/query/webSearch?code=21011302000542"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] leading-4 text-[#999999] hover:text-[#555555] transition-colors"
          >
            <img src="/beian.png" alt="公安备案图标" className="w-3.5 h-3.5" />
            <span>辽公网安备21011302000542号</span>
          </a>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] leading-4 text-[#999999] hover:text-[#555555] transition-colors"
          >
            辽ICP备2026019919号-1
          </a>
        </footer>
      </div>
    </aside>
  );
}
