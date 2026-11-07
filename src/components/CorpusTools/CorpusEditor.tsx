import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useCorpusStore } from '../../store/corpusStore';
import { languageLabel } from '../../services/export/types';
import { variantOf, type BilingualUnit, type CorpusProject, type UnitVariant } from '../../services/corpus/types';
import { addEmptyUnit, detachVariant, excludeUnits, mergeUnits, moveVariant, restoreExcluded, setReview, splitUnit, swapDirection, toggleAnchor, editVariant } from '../../services/corpus/model';

type Operation = (change: (project: CorpusProject) => CorpusProject) => boolean;
const FIELD = 'w-full rounded-md border border-border bg-bg-white px-3 py-2 text-[14px] text-text placeholder:text-text-placeholder';
const BUTTON = 'btn btn-secondary min-h-10 text-[12px]';
const REVIEW_LABEL = { unreviewed: '待复核', edited: '已修改 · 待复核', confirmed: '已复核' };

export function CorpusDialog({ title, children, close, error }: { title: string; children: React.ReactNode; close: () => void; error?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); close(); }}
    className="w-[min(94vw,720px)] max-h-[88vh] overflow-y-auto rounded-xl border border-[#e0e0e0] bg-white p-5 text-[#222222] shadow-xl backdrop:bg-black/40">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-[18px] font-semibold">{title}</h2>
      <button type="button" onClick={close} aria-label="关闭对话框" className="min-h-10 min-w-10 text-[20px] text-[#888888]">×</button></div>
    {children}
    {error && <p role="alert" className="mt-3 whitespace-pre-wrap text-[12px] leading-5 text-error-text">{error}</p>}
  </dialog>;
}

function SideEditor({ side, label, disabled, onSave }: {
  side: UnitVariant; label: string; disabled: boolean; onSave: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState({ original: side.text, value: side.text });
  const text = draft.original === side.text ? draft.value : side.text;
  return <div className="min-w-0">
    <p className="mb-1 text-[11px] font-medium text-[#888888]">{label}</p>
    <textarea aria-label={label} value={text} onChange={event => setDraft({ original: side.text, value: event.target.value })}
      onBlur={() => {
        if (text === side.text || onSave(text)) setDraft({ original: side.text, value: side.text });
      }} readOnly={side.markup !== undefined} disabled={disabled}
      rows={Math.max(2, Math.min(8, side.text.split('\n').length + Math.floor(side.text.length / 90)))}
      placeholder="此侧为空；内容不会被自动删除" className={FIELD + ' resize-y leading-6 [overflow-wrap:anywhere]'} />
    {side.markup !== undefined && <p className="mt-1 text-[10px] text-[#888888]">含受保护的行内标签，请在“更多调整”中选择“编辑标签 XML”修改文字。</p>}
    {text !== side.text && <p className="mt-1 text-[10px] text-warning-text">此处尚有未保存修改；离开输入框后应用，失败时草稿会保留。</p>}
  </div>;
}

const CorpusRow = memo(function CorpusRow({ unit, index, nextId, sourceLanguage, targetLanguage, selected, busy, canAnchor, operate, onSplit, onXml }: {
  unit: BilingualUnit; index: number; nextId?: string; sourceLanguage: string; targetLanguage: string; selected: boolean; busy: boolean; canAnchor: boolean;
  operate: Operation; onSplit: (id: string) => void; onXml: (id: string, language: string) => void;
}) {
  const source = variantOf(unit, sourceLanguage), target = variantOf(unit, targetLanguage);
  const unmatched = !source.text.trim() || !target.text.trim();
  return <li className={'min-w-0 rounded-lg border bg-white ' + (selected ? 'border-[#1677ff]' : 'border-[#e0e0e0]')}>
    <div className="flex flex-wrap items-center gap-2 border-b border-border-light bg-[#fafafa] px-3 py-2 text-[11px] text-[#777777]">
      <span>第 {index + 1} 行</span>
      <span className={unit.review === 'confirmed' ? 'text-success-text' : 'text-warning-text'}>{REVIEW_LABEL[unit.review]}</span>
      {unmatched && <span className="rounded bg-warning-bg px-2 py-1 text-warning-text">包含空侧</span>}
      {unit.locked && <span className="rounded bg-[#e6f4ff] px-2 py-1 text-[#1677ff]">锚点已锁定</span>}
    </div>
    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
      <SideEditor side={source} label={languageLabel(sourceLanguage) + ' · ' + sourceLanguage} disabled={busy}
        onSave={text => operate(project => editVariant(project, unit.id, sourceLanguage, text))} />
      <SideEditor side={target} label={languageLabel(targetLanguage) + ' · ' + targetLanguage} disabled={busy}
        onSave={text => operate(project => editVariant(project, unit.id, targetLanguage, text))} />
    </div>
    <div className="px-3 pb-3 text-[11px] text-[#555555] [&_button]:min-h-9">
      <button type="button" disabled={busy} onClick={() => operate(project => setReview(project, [unit.id], unit.review !== 'confirmed'))} className="text-[#1677ff]">{unit.review === 'confirmed' ? '改为待复核' : '确认此行'}</button>
      <details className="mt-1 min-w-0">
        <summary className="w-fit cursor-pointer py-2 text-[#777777]">更多调整{selected ? ' · 已勾选' : ''}</summary>
        <div className="mt-1 rounded-lg border border-border-light bg-[#fafafa] p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={selected} disabled={busy}
              onChange={() => useCorpusStore.getState().select(unit.id)} aria-label={'选择第 ' + (index + 1) + ' 行'} />选择此行，参与批量调整</label>
            <button type="button" disabled={busy} onClick={() => onSplit(unit.id)}>拆分此行</button>
            <button type="button" disabled={busy || !nextId} onClick={() => { if (nextId) operate(project => mergeUnits(project, [unit.id, nextId])); }}>与下一行合并</button>
            {canAnchor && <button type="button" disabled={busy} onClick={() => operate(project => toggleAnchor(project, unit.id))}>{unit.locked ? '解锁锚点' : '锁为锚点'}</button>}
            <button type="button" disabled={busy} onClick={() => operate(project => excludeUnits(project, [unit.id]))}>排除此行</button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" disabled={busy || index === 0} onClick={() => operate(project => moveVariant(project, unit.id, targetLanguage, -1))}>右侧上移</button>
            <button type="button" disabled={busy || !nextId} onClick={() => operate(project => moveVariant(project, unit.id, targetLanguage, 1))}>右侧下移</button>
            <button type="button" disabled={busy} onClick={() => operate(project => detachVariant(project, unit.id, targetLanguage))}>右侧独立成行</button>
            <button type="button" disabled={busy} onClick={() => operate(project => detachVariant(project, unit.id, sourceLanguage))}>左侧独立成行</button>
          </div>
          <p className="mt-1 leading-5 text-[#888888]">移动与合并按完整语料的行号顺序操作，可能涉及当前筛选或分页外的行。“独立成行”会保留内容，并形成空侧对应；排除记录可在批量调整中恢复。</p>
          {(source.markup !== undefined || target.markup !== undefined) && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[#1677ff]">
            {source.markup !== undefined && <button type="button" disabled={busy} onClick={() => onXml(unit.id, sourceLanguage)}>编辑标签 XML（左侧 · {languageLabel(sourceLanguage)}）</button>}
            {target.markup !== undefined && <button type="button" disabled={busy} onClick={() => onXml(unit.id, targetLanguage)}>编辑标签 XML（右侧 · {languageLabel(targetLanguage)}）</button>}
          </div>}
          <p className="mt-2 text-[#888888]">对应来源：{unit.provenance === 'automatic' ? '自动对应' : unit.provenance === 'manual' ? '人工调整' : '文件原有对应'}</p>
          <details className="mt-2 min-w-0"><summary className="cursor-pointer py-1 text-[#888888]">原文位置、其他语言与字段</summary>
        <div className="max-h-52 overflow-auto rounded bg-[#f7f8fa] p-2 text-[11px]">
          {unit.variants.map((side, position) => <p key={side.language + '-' + position} className="mb-2 whitespace-pre-wrap break-words">{side.language}：{side.text}
            {'\n'}{side.refs.map(ref => ref.blockId + ' [' + ref.start + ', ' + ref.end + ')').join('；')}</p>)}
          {unit.score !== undefined && <p>算法原始分数：{unit.score.toFixed(4)}（不是正确概率）</p>}
          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(unit.metadata, null, 2)}</pre>
        </div>
          </details>
        </div>
      </details>
    </div>
  </li>;
});

export function CorpusEditor({ busy, operate, issue }: { busy: boolean; operate: Operation; issue?: string }) {
  const project = useCorpusStore(state => state.project);
  const selected = useCorpusStore(state => state.selected);
  const past = useCorpusStore(state => state.past);
  const future = useCorpusStore(state => state.future);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [xmlEditor, setXmlEditor] = useState<{ id: string; language: string } | null>(null);
  const openXml = (id: string, language: string) => setXmlEditor({ id, language });
  const filtered = useMemo(() => project?.units.map((unit, index) => ({ unit, index })).filter(({ unit }) => {
    const source = variantOf(unit, project.sourceLanguage), target = variantOf(unit, project.targetLanguage);
    return (filter === 'all' || filter === 'unreviewed' && unit.review !== 'confirmed'
      || filter === 'unmatched' && (!source.text.trim() || !target.text.trim()) || filter === 'locked' && unit.locked)
      && (!query || unit.variants.some(side => side.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  }) || [], [project, filter, query]);
  if (!project) return null;
  const lastPage = Math.max(0, Math.ceil(filtered.length / 25) - 1), currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * 25, currentPage * 25 + 25);
  return <section aria-label="双语语料编辑器" className="mt-6 min-w-0">
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h2 className="mr-auto text-[17px] font-semibold text-[#222222]">双语对应 · {project.units.length} 行</h2>
      <button type="button" className={BUTTON} disabled={busy || !past.length} onClick={() => useCorpusStore.getState().undo()}>撤销</button>
      <button type="button" className={BUTTON} disabled={busy || !future.length} onClick={() => useCorpusStore.getState().redo()}>重做</button>
    </div>
    <div className="mb-3 flex flex-wrap gap-2">
      <label className="min-w-[140px] flex-1 text-[11px] text-[#777777]">显示
        <select value={filter} disabled={busy} onChange={event => { setFilter(event.target.value); setPage(0); }} className={FIELD + ' mt-1'}>
          <option value="all">全部行</option><option value="unreviewed">待复核</option><option value="unmatched">空侧 / 未匹配</option><option value="locked">锁定锚点</option>
        </select>
      </label>
      <label className="min-w-[180px] flex-[2] text-[11px] text-[#777777]">搜索正文
        <input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className={FIELD + ' mt-1'} placeholder="搜索中文或英文" />
      </label>
    </div>
    <details className="mb-3 rounded-lg border border-[#e0e0e0] bg-[#fafafa] px-3 py-2 text-[11px] text-[#777777]">
      <summary className="cursor-pointer py-1">批量与其他调整{selected.length ? ' · 已选 ' + selected.length + ' 行' : ''}{project.excludedUnits?.length ? ' · ' + project.excludedUnits.length + ' 行已排除' : ''}</summary>
      <p className="my-2 leading-5">在每行“更多调整”中勾选，或选择本页。跨页所选仍保留；合并需选择完整语料中相邻的行。</p>
      <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={BUTTON} disabled={busy || !visible.length} onClick={() => useCorpusStore.getState().selectMany(visible.map(({ unit }) => unit.id))}>选择本页</button>
      <button type="button" className={BUTTON} disabled={busy || !selected.length} onClick={() => useCorpusStore.getState().selectMany([])}>清除选择</button>
      <span>已选 {selected.length} 行</span>
      <button type="button" className={BUTTON} disabled={busy || selected.length < 2} onClick={() => operate(project => mergeUnits(project, selected))}>合并相邻行</button>
      <button type="button" className={BUTTON} disabled={busy || !selected.length} onClick={() => operate(project => setReview(project, selected, true))}>确认所选</button>
      <button type="button" className={BUTTON} disabled={busy || !selected.length} onClick={() => operate(project => excludeUnits(project, selected))}>排除所选</button>
      <button type="button" className={BUTTON} disabled={busy} onClick={() => operate(addEmptyUnit)}>添加空行</button>
      {!!project.excludedUnits?.length && <button type="button" className={BUTTON} disabled={busy} onClick={() => operate(restoreExcluded)}>恢复 {project.excludedUnits.length} 条排除记录</button>}
      <button type="button" className={BUTTON} disabled={busy} onClick={() => operate(swapDirection)}>交换中英方向</button>
      </div>
    </details>
    <p className="mb-3 text-[11px] leading-5 text-[#888888]">左侧 {languageLabel(project.sourceLanguage)} · {project.sourceLanguage}；右侧 {languageLabel(project.targetLanguage)} · {project.targetLanguage}。文字离开输入框后保存修改；核对无误后点击“确认此行”。</p>
    <ol className="space-y-3">
      {visible.map(({ unit, index }) => <CorpusRow key={unit.id} unit={unit} index={index} nextId={project.units[index + 1]?.id} selected={selected.includes(unit.id)}
        sourceLanguage={project.sourceLanguage} targetLanguage={project.targetLanguage} busy={busy} canAnchor={project.origin === 'alignment'}
        operate={operate} onSplit={setSplitId} onXml={openXml} />)}
    </ol>
    {!filtered.length && <p className="rounded-lg border border-[#e0e0e0] p-6 text-center text-[13px] text-[#888888]">当前没有符合条件的行。</p>}
    {lastPage > 0 && <nav aria-label="语料分页" className="mt-4 flex items-center justify-between gap-2">
      <button type="button" className={BUTTON} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
      <span className="text-[12px] text-[#888888]">{currentPage + 1} / {lastPage + 1} 页 · 共 {filtered.length} 行</span>
      <button type="button" className={BUTTON} disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>下一页</button>
    </nav>}
    {splitId && project.units.some(unit => unit.id === splitId) && <SplitDialog key={splitId} project={project} id={splitId} close={() => setSplitId(null)} operate={operate} issue={issue} />}
    {xmlEditor && project.units.some(unit => unit.id === xmlEditor.id) && <XmlDialog key={xmlEditor.id + xmlEditor.language} project={project} {...xmlEditor} close={() => setXmlEditor(null)} operate={operate} issue={issue} />}
  </section>;
}

function SplitDialog({ project, id, close, operate, issue }: { project: CorpusProject; id: string; close: () => void; operate: Operation; issue?: string }) {
  const unit = project.units.find(unit => unit.id === id)!;
  const source = variantOf(unit, project.sourceLanguage), target = variantOf(unit, project.targetLanguage);
  const middle = (text: string) => {
    const match = text.match(/[。！？.!?]\s*/);
    return Math.min(text.length, match ? match.index! + match[0].length : Math.floor(text.length / 2));
  };
  const [s, setS] = useState(middle(source.text)), [t, setT] = useState(middle(target.text));
  return <CorpusDialog title="拆分对应行" close={close} error={issue}>
    <p className="mb-3 text-[12px] leading-5 text-[#777777]">分别在两侧正文中点击拆分位置，也可调整数字，再核对两条新记录。字符和原文位置会保留；空侧位置设为 0。</p>
    <div className="grid gap-4 md:grid-cols-2">
      {[{ side: source, value: s, set: setS, label: '左侧' }, { side: target, value: t, set: setT, label: '右侧' }].map(({ side, value, set, label }) => <label key={label} className="text-[12px] text-[#555555]">
        {label}拆分位置（0–{side.text.length}）<input type="number" min={0} max={side.text.length} value={value} onChange={event => set(Number(event.target.value))} className={FIELD + ' my-2'} />
        <textarea readOnly aria-label={label + '正文，点击选择拆分位置'} value={side.text} rows={5}
          onSelect={event => set(event.currentTarget.selectionStart)} className={FIELD + ' mb-2 leading-6'} />
        <p className="min-h-16 whitespace-pre-wrap break-words rounded border border-[#e0e0e0] p-2">① {side.text.slice(0, value) || '（空）'}</p>
        <p className="mt-2 min-h-16 whitespace-pre-wrap break-words rounded border border-[#e0e0e0] p-2">② {side.text.slice(value) || '（空）'}</p>
      </label>)}
    </div>
    <button type="button" className="btn btn-primary mt-4" onClick={() => { if (operate(project => splitUnit(project, id, s, t))) close(); }}>应用拆分</button>
  </CorpusDialog>;
}
function XmlDialog({ project, id, language, close, operate, issue }: { project: CorpusProject; id: string; language: string; close: () => void; operate: Operation; issue?: string }) {
  const side = variantOf(project.units.find(unit => unit.id === id)!, language);
  const [markup, setMarkup] = useState(side.markup || '');
  return <CorpusDialog title={'编辑 ' + language + ' 的内联 XML'} close={close} error={issue}>
    <p className="mb-3 text-[12px] leading-5 text-[#777777]">只编辑 seg 内部内容，保留 bpt / ept 等标签配对和属性。应用前会校验结构与正文。</p>
    <textarea aria-label="内联 XML 内容" value={markup} onChange={event => setMarkup(event.target.value)} rows={12} className={FIELD + ' font-mono text-[12px]'} />
    <button type="button" className="btn btn-primary mt-4" onClick={() => { if (operate(project => editVariant(project, id, language, markup, true))) close(); }}>校验并应用</button>
  </CorpusDialog>;
}
