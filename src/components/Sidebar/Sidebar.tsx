import { useTranslationStore } from '../../store/translationStore';
import { DEMO_SAMPLES } from '../../demo/samples';
import { DemoSampleList } from './DemoSampleList';

interface SidebarProps {
  onNewChat: () => void;
  onSamplePicked?: () => void;
}

export function Sidebar({ onNewChat, onSamplePicked }: SidebarProps) {
  const { isServiceOnline } = useTranslationStore();

  return (
    <aside className="w-[280px] h-full flex flex-col bg-[#fafafa] border-r border-[#e8e8e8] select-none flex-shrink-0">
      {/* Logo & Brand */}
      <div className="h-[68px] flex items-center px-5 border-b border-[#e8e8e8]">
        <div className="flex items-center gap-3">
          <img
            src="/icons/app-icon.svg"
            alt="Silvite 图标"
            className="w-9 h-9 flex-shrink-0"
          />
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

        <DemoSampleList samples={DEMO_SAMPLES} onPicked={onSamplePicked} />
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
