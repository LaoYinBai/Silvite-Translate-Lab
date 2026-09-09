import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { InputArea } from './components/InputArea/InputArea';
import { ResultArea } from './components/ResultArea/ResultArea';
import { Lightbox } from './components/Lightbox/Lightbox';
import { useTranslationStore } from './store/translationStore';

function App() {
  const { 
    result,
    isLoading,
    checkService
  } = useTranslationStore();
  
  const [mobileSamplesOpen, setMobileSamplesOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (
    localStorage.getItem('silvite-theme') === 'dark' ? 'dark' : 'light'
  ));

  useEffect(() => {
    checkService();
  }, [checkService]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('silvite-theme', theme);
  }, [theme]);

  const handleNewChat = () => {
    useTranslationStore.getState().reset();
  };

  const hasResult = result || isLoading;

  return (
    // App shell: 10px breathing space (left/top/bottom) + 10px gap to main.
    // Sidebar is a flex item, so the shell padding owns the offset.
    <div className="flex h-full bg-white pt-[10px] pb-[10px] pl-[10px] pr-0 gap-[10px]">
      {/* Sidebar - hidden on small screens; samples open in a drawer.
          Desktop: fixed-width floating panel, rounded, clipped by itself. */}
      <div className="hidden md:block w-[280px] flex-shrink-0 rounded-[10px] overflow-hidden">
        <Sidebar onNewChat={handleNewChat} />
      </div>
      
      {/* Mobile samples drawer */}
      {mobileSamplesOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileSamplesOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-[280px] h-full bg-[#f6f7f9] border-r border-[#e4e6ea]">
            <Sidebar
              onNewChat={() => {
                handleNewChat();
                setMobileSamplesOpen(false);
              }}
              onSamplePicked={() => setMobileSamplesOpen(false)}
            />
          </div>
        </div>
      )}
      
      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-[68px] flex items-center justify-between px-5 sm:px-10 bg-white border-b border-[#e0e0e0] flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Mobile: samples drawer trigger */}
            <button
              type="button"
              onClick={() => setMobileSamplesOpen(true)}
              aria-label="打开演示样本"
              className="md:hidden flex items-center gap-1.5 h-9 px-3 text-[13px] font-medium text-[#1a1a1a] border border-[#e0e0e0] rounded-lg hover:bg-[#f5f5f5] transition-colors"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 3.5h12M2 8h12M2 12.5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              样本
            </button>
            <h2 className="text-[17px] sm:text-[19px] font-semibold text-[#1a1a1a]">Translate Lab</h2>
            <span className="text-[12px] sm:text-[13px] text-[#888888] bg-[#f5f5f5] px-3 py-1 rounded-full">
              实验版
            </span>
          </div>
        </header>
        
        {/* Content area - scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Workspace - true center (vertical + horizontal) */}
          <div className="min-h-full flex items-center justify-center px-6 md:px-10 py-10">
            {/* Workspace container */}
            <div className="w-full max-w-[900px]">
              {!hasResult ? (
                /* Welcome state - centered */
                <div className="flex flex-col items-center">
                  <div className="text-center mb-10 sm:mb-12">
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-5">
                      <img
                        src="/icons/app-icon.svg"
                        alt="Silvite 图标"
                        className="w-12 h-12 sm:w-16 sm:h-16 flex-shrink-0"
                      />
                      <h1 className="text-[24px] sm:text-[32px] md:text-[36px] font-semibold text-[#1a1a1a] leading-tight">
                        Silvite Translate Lab
                      </h1>
                    </div>
                    <p className="text-[15px] sm:text-[17px] text-[#555555] max-w-[540px] leading-relaxed">
                      面向译者的 AI 翻译工作台。自动识别语言：中文译入英文，其他语言一律译入中文；支持上下文消歧、术语硬约束与图片理解。
                    </p>
                  </div>
                  
                  <div className="w-full">
                    <InputArea />
                  </div>
                  
                  {/* Feature hints */}
                  <div className="flex flex-wrap items-center justify-center gap-5 sm:gap-8 lg:gap-10 mt-10 sm:mt-14">
                    <FeatureHint 
                      icon={
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      }
                      title="多语言路由"
                      desc="其他语言自动译入中文"
                    />
                    <FeatureHint 
                      icon={
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <path d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      }
                      title="图片翻译"
                      desc="漫画、海报、UI 截图均可"
                    />
                    <FeatureHint 
                      icon={
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      }
                      title="Context 消歧"
                      desc="术语硬约束，译名始终一致"
                    />
                  </div>
                </div>
              ) : (
                /* Translation state */
                <div className="w-full">
                  <InputArea />
                  <ResultArea />
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Image lightbox — rendered at the app root so no layout clips it */}
      <Lightbox />

      {/* Theme toggle — top-right of the viewport, above all layout */}
      <button
        type="button"
        onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        className="fixed top-[14px] right-[14px] z-[60] w-9 h-9 rounded-full flex items-center justify-center text-[#555555] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] transition-colors"
      >
        {theme === 'dark' ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
            <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20.5 14.2A8.3 8.3 0 019.8 3.5 8.3 8.3 0 1020.5 14.2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </div>
  );
}

function FeatureHint({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-[#f0f0f0] flex items-center justify-center text-[#555555]">
        {icon}
      </div>
      <div>
        <p className="text-[15px] font-medium text-[#1a1a1a]">{title}</p>
        <p className="text-[14px] text-[#888888] mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

export default App;
