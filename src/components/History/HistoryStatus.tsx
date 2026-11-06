import { useState } from 'react';
import { retryHistory, useHistoryStore } from '../../store/historyStore';

export function HistoryStatus({ onOpen, expanded = false }: { onOpen?: () => void; expanded?: boolean }) {
  const saving = useHistoryStore(state => state.saving);
  const error = useHistoryStore(state => state.error);
  const unsaved = useHistoryStore(state => state.unsavedCount);
  const count = useHistoryStore(state => state.records.length);
  const [retrying, setRetrying] = useState(false);
  const text = saving === 'loading' ? '正在读取本地历史…'
    : saving === 'saving' ? '正在保存本地历史…'
      : saving === 'error' ? '本地历史操作失败'
        : count ? '历史已保存于此浏览器' : '本地历史已就绪';
  const retry = async () => {
    setRetrying(true);
    try { await retryHistory(); }
    catch { /* The store retains and displays the storage error. */ }
    finally { setRetrying(false); }
  };
  return (
    <div className={expanded ? 'rounded-lg border border-[#e4e6ea] bg-[#fafafa] px-4 py-3 text-[13px] text-[#555555]' : 'min-w-0 text-[12px] text-[#777777]'}>
      <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${saving === 'error' ? 'bg-[#ff4d4f]' : saving === 'saved' ? 'bg-[#52c41a]' : 'bg-[#1677ff]'}`} />
        {onOpen ? <button type="button" onClick={onOpen} title={error || text} className="min-h-11 truncate text-left hover:underline">{text}</button> : <span>{text}</span>}
      </div>
      {expanded && error && (
        <div className="mt-2 space-y-2">
          <p role="alert" className="break-words text-[#b42318]">{error}</p>
          {unsaved > 0 && <p>有 {unsaved} 条结果尚未存入浏览器，关闭页面可能丢失。导出仅包含已保存记录。</p>}
          <button type="button" onClick={() => { void retry(); }} disabled={retrying || saving === 'saving'} className="btn btn-secondary min-h-11 text-[12px]">
            {retrying ? '正在重试…' : '重试保存并刷新历史'}
          </button>
        </div>
      )}
    </div>
  );
}
