import { useState } from 'react';
import type { ParagraphAlignment, ParagraphRange } from '../../services/alignment/paragraphs';
import { languageLabel } from '../../services/export/types';

const PAGE_SIZE = 40;

function rangeLabel(range: ParagraphRange | null): string {
  if (!range) return '暂无对应片段';
  return range.firstParagraph === range.lastParagraph
    ? `片段 ${range.firstParagraph}`
    : `片段 ${range.firstParagraph}–${range.lastParagraph}`;
}

export function ParagraphComparison({ alignment }: { alignment: ParagraphAlignment }) {
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(alignment.rows.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const offset = currentPage * PAGE_SIZE;
  const unmatched = alignment.rows.filter(row => !row.source || !row.target).length;
  const sourceLabel = `原文 · ${languageLabel(alignment.sourceLanguage)}`;
  const targetLabel = `译文 · ${languageLabel(alignment.targetLanguage)}`;

  return (
    <section aria-label="分段中英文对照" className="min-w-0">
      <p className="mb-4 text-[12px] leading-relaxed text-[#888888]">
        已自动分为 {alignment.rows.length} 组中英对照（{alignment.method === 'ai' ? 'AI 辅助分段' : '本地规则分段'}），请核对含义。
        {unmatched > 0 && ` 其中 ${unmatched} 组暂未找到对应，内容已保留。`}
      </p>
      <div className="hidden md:grid md:grid-cols-2 border border-b-0 border-[#e0e0e0] rounded-t-lg bg-[#fafafa] text-[13px] font-medium text-[#555555]">
        <div className="px-4 py-3 border-r border-[#e0e0e0]">{sourceLabel}</div>
        <div className="px-4 py-3">{targetLabel}</div>
      </div>
      <ol start={offset + 1} className="list-none border border-[#e0e0e0] rounded-lg md:rounded-t-none overflow-hidden">
        {alignment.rows.slice(offset, offset + PAGE_SIZE).map((row, index) => (
          <li key={row.id} className="border-b border-[#e0e0e0] last:border-b-0">
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#fafafa] text-[11px] text-[#888888]">
              <span>对应 {offset + index + 1} · {rangeLabel(row.source)} → {rangeLabel(row.target)}</span>
              {row.needsCheck && <span className="shrink-0 text-[#ad6800]">待核对</span>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 min-w-0">
              <div className="min-w-0 px-4 py-3 border-b md:border-b-0 md:border-r border-[#e0e0e0]">
                <p className="md:hidden mb-2 text-[11px] font-medium text-[#888888]">{sourceLabel}</p>
                {row.source ? (
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[15px] leading-[1.8] text-[#555555]">{alignment.sourceText.slice(row.source.start, row.source.end)}</p>
                ) : <p className="text-[13px] text-[#888888]">未找到对应原文</p>}
              </div>
              <div className="min-w-0 px-4 py-3">
                <p className="md:hidden mb-2 text-[11px] font-medium text-[#888888]">{targetLabel}</p>
                {row.target ? (
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[15px] leading-[1.8] text-[#1a1a1a]">{alignment.targetText.slice(row.target.start, row.target.end)}</p>
                ) : <p className="text-[13px] text-[#888888]">未找到对应译文</p>}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {lastPage > 0 && (
        <nav aria-label="段落对照分页" className="flex items-center justify-between gap-2 mt-4">
          <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="btn btn-secondary h-10">上一页</button>
          <span className="text-[12px] text-[#888888]" aria-live="polite">{currentPage + 1} / {lastPage + 1}</span>
          <button type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)} className="btn btn-secondary h-10">下一页</button>
        </nav>
      )}
    </section>
  );
}
