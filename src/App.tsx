import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { InputArea } from './components/InputArea/InputArea';
import { ResultArea } from './components/ResultArea/ResultArea';
import { useTranslationStore } from './store/translationStore';

function App() {
  const { 
    result,
    isLoading,
    checkService
  } = useTranslationStore();

  useEffect(() => {
    checkService();
  }, [checkService]);

  const handleNewChat = () => {
    useTranslationStore.getState().reset();
  };

  const hasResult = result || isLoading;

  return (
    <div className="flex h-full bg-[#fafafa]">
      {/* Sidebar - hidden on small screens for basic mobile usability */}
      <div className="hidden md:block h-full">
        <Sidebar onNewChat={handleNewChat} />
      </div>
      
      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-[68px] flex items-center justify-between px-10 bg-white border-b border-[#e0e0e0] flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-[19px] font-semibold text-[#1a1a1a]">翻译</h2>
            <span className="text-[13px] text-[#888888] bg-[#f5f5f5] px-3 py-1 rounded-full">
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
                  <div className="text-center mb-12">
                    <h1 className="text-[36px] font-semibold text-[#1a1a1a] mb-5 leading-tight">
                      Silvite Translate Lab
                    </h1>
                    <p className="text-[17px] text-[#555555] max-w-[540px] leading-relaxed">
                      面向译者的 AI 翻译工作台。自动识别语言：中文译入英文，其他语言一律译入中文；支持上下文消歧、术语硬约束与图片理解。
                    </p>
                  </div>
                  
                  <div className="w-full">
                    <InputArea />
                  </div>
                  
                  {/* Feature hints */}
                  <div className="flex items-center gap-10 mt-14">
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
