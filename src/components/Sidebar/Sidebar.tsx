interface SidebarProps {
  onNewChat: () => void;
}

export function Sidebar({ onNewChat }: SidebarProps) {
  return (
    <aside className="w-[280px] h-full hidden md:flex flex-col bg-white border-r border-[#e5e7eb] select-none flex-shrink-0">
      <div className="silvite-sidebar__brand h-[68px] flex items-center border-b border-[#e5e7eb]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-[#1677ff] flex items-center justify-center shadow-sm shadow-blue-100">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" className="text-white" aria-hidden="true">
              <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/>
            </svg>
          </div>
          <div>
            <h1 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1a1a1a] leading-5">Silvite</h1>
            <p className="text-[12px] text-[#777777] leading-4">翻译站</p>
          </div>
        </div>
      </div>

      <div className="silvite-sidebar__action">
        <button
          type="button"
          onClick={onNewChat}
          className="btn btn-secondary w-full h-[42px] justify-start px-[14px] text-[14px] shadow-xs"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          新建翻译
        </button>
      </div>

      <nav className="silvite-sidebar__nav flex-1" aria-label="工作区">
        <p className="silvite-sidebar__section-label text-[11px] font-semibold text-[#8a8a8a] uppercase tracking-[0.08em]">
          工作区
        </p>
        <div className="silvite-sidebar__current flex items-start gap-[12px] rounded-md bg-[#f4f6f8] border border-[#eaedf0]" aria-current="page">
          <div className="w-8 h-8 rounded-md bg-white border border-[#e1e5e9] flex items-center justify-center text-[#4f5965] flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2.5 3.25h7M6 1.75v1.5m.5 7A10.2 10.2 0 014.2 6.4m4.05 6.1h5.25m-4.5 2 2.25-6 2.25 6M7.5 3.25C7.05 6.7 5.15 9.5 2.5 11" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="silvite-sidebar__current-copy min-w-0">
            <p className="text-[14px] font-medium text-[#24272b] leading-5">翻译</p>
            <p className="silvite-sidebar__current-subtitle text-[12px] text-[#7a8087] leading-4">文本与图片翻译</p>
          </div>
        </div>
      </nav>

      <div className="silvite-sidebar__footer">
        <div className="silvite-sidebar__shortcuts rounded-md border border-[#e6e8eb] bg-[#fafafa]">
          <div className="silvite-sidebar__shortcut-heading flex items-center gap-[8px]">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="text-[#72777e]" aria-hidden="true">
              <path d="M8 14.25A6.25 6.25 0 108 1.75a6.25 6.25 0 000 12.5zM8 7.25V11m0-6.25v.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
            </svg>
            <p className="text-[12px] font-medium text-[#4d535a]">快捷键</p>
          </div>
          <p className="text-[12px] text-[#777d84] leading-5">
            <kbd className="font-[inherit] text-[#3f454b]">Enter</kbd> 开始翻译<br />
            <kbd className="font-[inherit] text-[#3f454b]">Shift + Enter</kbd> 换行
          </p>
        </div>
        <div className="silvite-sidebar__meta flex items-center justify-between">
          <span className="text-[11px] text-[#92979d]">中英文互译</span>
          <span className="text-[11px] text-[#92979d]">实验版</span>
        </div>
      </div>
    </aside>
  );
}
