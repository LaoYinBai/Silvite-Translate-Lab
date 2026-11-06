import { useDeferredValue, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { deleteHistoryRecord, exportHistoryJson, hydrateHistory, importHistoryFile, useHistoryStore } from '../../store/historyStore';
import { historyErrorMessage, type HistoryRecord } from '../../services/history/types';
import { downloadBlob } from '../../services/export/download';
import { formatTimestamp, languageLabel } from '../../services/export/types';
import { HistoryStatus } from './HistoryStatus';

const MODES = { auto: '自动', natural: '自然', literary: '文学', academic: '学术', business: '商务', comic: '漫画' };
const INPUTS = { text: '文字', image: '图片识别', file: '文档' };
const BUTTON = 'btn btn-secondary min-h-11 text-[13px]';
const PAGE_SIZE = 30;
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

export default function History({ onBack, onRestore }: { onBack: () => void; onRestore: (record: HistoryRecord) => void }) {
  const records = useHistoryStore(state => state.records);
  const hydrated = useHistoryStore(state => state.hydrated);
  const pendingCount = useHistoryStore(state => state.pendingCount);
  const unsavedCount = useHistoryStore(state => state.unsavedCount);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const [shown, setShown] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const indexed = useMemo(() => records.map(record => ({ record, text: [
    record.sourceText, record.result.translation, record.request.context, record.request.terminology,
    ...record.result.notes.map(note => `${note.source} ${note.translation} ${note.reason}`),
    record.result.sourceLanguage, record.result.targetLanguage, languageLabel(record.result.sourceLanguage), languageLabel(record.result.targetLanguage),
    record.request.model, MODES[record.request.mode], INPUTS[record.request.inputMode],
  ].join('\n').toLocaleLowerCase() })), [records]);
  const filtered = useMemo(() => indexed.filter(item => !search || item.text.includes(search)).map(item => item.record), [indexed, search]);

  const exportAll = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const text = await exportHistoryJson();
      downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), `silvite-history-${formatTimestamp(new Date())}.json`);
      setNotice('已生成全部已保存历史的 JSON 备份。请妥善保管，其中包含原文、译文和请求设置。');
    } catch (error) { setError(historyErrorMessage(error)); }
    finally { setBusy(false); }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const summary = await importHistoryFile(file);
      setNotice(`已导入 ${summary.added} 条，跳过 ${summary.skipped} 条重复 ID。已有记录全部保留。`);
    } catch (error) { setError(historyErrorMessage(error)); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setDeleting(id); setError(null); setNotice(null);
    try { await deleteHistoryRecord(id); setNotice('已删除此条本地历史。'); }
    catch (error) { setError(historyErrorMessage(error)); }
    finally { setDeleting(null); }
  };

  const restore = (record: HistoryRecord) => {
    try { onRestore(record); }
    catch (error) { setError(historyErrorMessage(error)); }
  };
  const refresh = async () => {
    setBusy(true); setError(null); setNotice(null);
    try { await hydrateHistory(true); setNotice('已刷新此浏览器的已保存历史。'); }
    catch (error) { setError(historyErrorMessage(error)); }
    finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="history-heading" className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="history-heading" className="text-[20px] font-semibold text-[#1a1a1a]">翻译历史</h1>
          <p className="mt-1 text-[13px] text-[#777777]">真实翻译的完整结果会自动保存，包括原文、译文、分段、说明与请求设置。</p>
        </div>
        <button type="button" onClick={onBack} className={BUTTON}>返回翻译</button>
      </div>

      <HistoryStatus expanded />
      <p className="my-4 text-[13px] leading-relaxed text-[#777777]">
        历史仅存于此浏览器，不会自动同步。清除网站数据、隐私浏览或浏览器回收存储可能导致丢失，请定期导出备份。
        不保存上传文件或图片本体、API 密钥、流式草稿、演示样本及失败结果。图片和文档恢复为识别或提取后的文字。
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-[13px] text-[#555555]">
          搜索历史
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setShown(PAGE_SIZE); }}
            placeholder="搜索原文、译文、说明、上下文或术语" maxLength={1000}
            className="mt-1 block min-h-11 w-full min-w-[180px] rounded-lg border border-[#d9dde4] bg-white px-3 text-[14px] text-[#222222]" />
        </label>
        <button type="button" onClick={() => { void exportAll(); }} disabled={busy || !hydrated || !records.length} className={BUTTON}>导出全部 JSON</button>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className={BUTTON}>导入 JSON</button>
        <button type="button" onClick={() => { void refresh(); }} disabled={busy} className={BUTTON}>刷新历史</button>
        <input ref={fileInput} type="file" accept="application/json,.json" aria-label="选择历史 JSON 备份" className="hidden" onChange={event => { void importFile(event); }} />
      </div>
      <p className="mb-5 text-[12px] leading-relaxed text-[#888888]">
        最多 1,000 条 · 单条 6 MiB · 总量 28 MiB · JSON 文件最多 30 MiB。导入为合并，重复 ID 保留现有记录；格式或容量校验失败时整份不导入。达到上限不会自动删除旧记录。
      </p>
      {unsavedCount > 0 && <p className="mb-3 text-[13px] text-[#b45309]">有 {unsavedCount} 条结果正在等待保存或需要重试，导出仅包含已保存历史。</p>}
      {busy && <p role="status" className="mb-3 text-[13px] text-[#555555]">正在处理历史备份…</p>}
      {notice && <p role="status" className="mb-4 rounded-lg bg-[#f0f7ff] px-4 py-3 text-[13px] text-[#175cd3]">{notice}</p>}
      {error && <p role="alert" className="mb-4 break-words rounded-lg bg-[#fff2f0] px-4 py-3 text-[13px] text-[#b42318]">{error}</p>}

      <p className="mb-3 text-[13px] text-[#777777]" role="status">{search ? `找到 ${filtered.length} 条，共 ${records.length} 条` : `共 ${records.length} 条，按请求时间从新到旧排列`}</p>
      {!hydrated ? (
        <p className="py-10 text-center text-[14px] text-[#777777]">尚未读取到历史，请查看上方存储状态。</p>
      ) : !filtered.length ? (
        <p className="rounded-xl border border-[#e4e6ea] px-5 py-12 text-center text-[14px] text-[#777777]">
          {search ? '没有匹配的翻译历史。' : '还没有已保存的翻译。完成一次真实翻译后，会自动出现在这里。'}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.slice(0, shown).map(record => (
            <li key={record.id} className="min-w-0 rounded-xl border border-[#e4e6ea] bg-white p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#777777]">
                <span>{languageLabel(record.result.sourceLanguage)} → {languageLabel(record.result.targetLanguage)} · {MODES[record.request.mode]} · {record.request.model === 'glm' ? 'GLM' : 'DeepSeek'} · {INPUTS[record.request.inputMode]}</span>
                <time dateTime={record.requestedAt} title={`完成于 ${dateFormatter.format(new Date(record.completedAt))}`}>{dateFormatter.format(new Date(record.requestedAt))}</time>
              </div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="mb-1 text-[12px] text-[#888888]">原文</p>
                  <p className="line-clamp-3 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[#555555]">{record.sourceText.slice(0, 500) || '未返回可识别的原文'}</p>
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[12px] text-[#888888]">完整译文</p>
                  <p className="line-clamp-3 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[#222222]">{record.result.translation.slice(0, 500)}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[12px] text-[#888888]">{record.result.notes.length} 条说明 · {record.result.paragraphAlignment ? `${record.result.paragraphAlignment.rows.length} 组对照` : '无已保存分段对照'}</span>
                <div className="flex items-center gap-2">
                  <button type="button" className={BUTTON} onClick={() => restore(record)} disabled={deleting === record.id}>恢复到翻译页</button>
                  <button type="button" className={`${BUTTON} text-[#b42318]`} onClick={() => { void remove(record.id); }} disabled={busy || deleting !== null || pendingCount > 0} aria-label={`删除 ${dateFormatter.format(new Date(record.requestedAt))} 的翻译历史`}>
                    {deleting === record.id ? '正在删除…' : '删除'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {filtered.length > shown && <button type="button" className={`${BUTTON} mt-5 w-full`} onClick={() => setShown(current => current + PAGE_SIZE)}>显示更多（还有 {filtered.length - shown} 条）</button>}
    </section>
  );
}
