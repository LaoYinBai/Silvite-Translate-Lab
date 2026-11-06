import { useCallback, useEffect, useRef, useState } from 'react';
import { useCorpusStore } from '../../store/corpusStore';
import { CORPUS_LIMITS, languageBase, variantOf, type CorpusProject } from '../../services/corpus/types';
import { importAlignmentDocument, importCorpusFile } from '../../services/corpus/import';
import { alignCorpusInBrowser, exportSdltmInBrowser } from '../../services/corpus/jobs';
import { textDocument } from '../../services/alignment/segment';
import { assertCorpusCoverage } from '../../services/alignment/corpusAlign';
import { exportTmx, exportTmxLosses } from '../../services/corpus/tmx';
import { exportRtf, rtfExportLosses } from '../../services/corpus/rtf';
import { sdltmExportLosses } from '../../services/corpus/sdltm';
import { swapDirection } from '../../services/corpus/model';
import { loadLocalProject, saveProjectLocally, serializeProject } from '../../services/corpus/persistence';
import { downloadBlob } from '../../services/export/download';
import { languageLabel } from '../../services/export/types';
import { CorpusDialog, CorpusEditor } from './CorpusEditor';

const FIELD = 'w-full rounded-md border border-[#d9dde4] bg-white px-3 py-2 text-[14px] text-[#222222]';
const BUTTON = 'btn btn-secondary min-h-11 text-[12px]';
interface InputDocument { file: File | null; text: string }
type ExportFormat = 'tmx' | 'rtf' | 'sdltm';

export default function CorpusTools({ onBack }: { onBack: () => void }) {
  const project = useCorpusStore(state => state.project);
  const saving = useCorpusStore(state => state.saving);
  const [tab, setTab] = useState<'convert' | 'align'>('convert');
  const [tmxDirection, setTmxDirection] = useState<'auto' | 'zh-en' | 'en-zh'>('auto');
  const [leftRtfLanguage, setLeftRtfLanguage] = useState('zh-CN');
  const [chinese, setChinese] = useState<InputDocument>({ file: null, text: '' });
  const [english, setEnglish] = useState<InputDocument>({ file: null, text: '' });
  const [direction, setDirection] = useState('zh-en');
  const [mode, setMode] = useState<'semantic' | 'structure'>('semantic');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ message: string; fraction?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<{ format: ExportFormat; snapshot: CorpusProject; losses: string[] } | null>(null);
  const operation = useRef<AbortController | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const live = useRef(true);

  const cancelWork = useCallback((message = '已取消，原有项目和内容仍保留。') => {
    const controller = operation.current;
    if (!controller) return;
    controller.abort(new DOMException('已取消', 'AbortError'));
    operation.current = null;
    setBusy(false); setProgress(null); setNotice(message);
  }, []);

  useEffect(() => {
    live.current = true;
    if (!useCorpusStore.getState().project) void loadLocalProject().then(saved => {
      if (live.current && saved && !useCorpusStore.getState().project) {
        useCorpusStore.getState().setProject(saved);
        setNotice('已恢复上次保存在此浏览器中的语料项目。');
      }
    }).catch(() => { /* manual project files remain available */ });
    return () => {
      live.current = false; operation.current?.abort(new DOMException('离开语料工具', 'AbortError')); operation.current = null;
      const current = useCorpusStore.getState();
      if (current.project && current.saving !== 'saved') void saveProjectLocally(current.project).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(() => {
      useCorpusStore.getState().setSaving('saving');
      void saveProjectLocally(project).then(() => {
        if (live.current && useCorpusStore.getState().project === project) useCorpusStore.getState().setSaving('saved');
      }).catch(() => {
        if (live.current && useCorpusStore.getState().project === project) useCorpusStore.getState().setSaving('error');
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [project]);

  const operate = useCallback((change: (project: CorpusProject) => CorpusProject): boolean => {
    if (operation.current) return false;
    try {
      useCorpusStore.getState().apply(current => {
        const changed = change(current);
        if (changed.units.length + (changed.excludedUnits?.length || 0) > CORPUS_LIMITS.units) throw new Error('项目单元数超过 10,000 行上限。');
        return changed;
      });
      setError(null);
      return true;
    } catch (error) { setError(error instanceof Error ? error.message : '未能应用修改。'); return false; }
  }, []);

  const work = async (task: (signal: AbortSignal, report: (message: string, fraction?: number) => void) => Promise<CorpusProject>) => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setExporting(null);
    setBusy(true); setError(null); setNotice(null); setProgress({ message: '准备处理资料', fraction: 0 });
    const current = () => live.current && operation.current === controller && !controller.signal.aborted;
    try {
      const result = await task(controller.signal, (message, fraction) => { if (current()) setProgress({ message, fraction }); });
      if (current()) {
        useCorpusStore.getState().setProject(result);
        setNotice('已保留 ' + result.units.length + ' 条对应记录，空侧和未匹配内容均可在编辑器中核对。');
      }
    } catch (error) {
      if (current()) setError(error instanceof Error ? error.message : '处理失败，原有项目仍保留。');
    } finally {
      if (operation.current === controller && live.current) { setBusy(false); setProgress(null); operation.current = null; }
    }
  };
  const canReplace = () => !useCorpusStore.getState().project || window.confirm('即将打开新的语料项目。当前项目如需长期保留，请先下载“保存项目”。是否继续？');
  const importFile = (file: File) => {
    if (!canReplace()) return;
    const extension = file.name.toLowerCase();
    const options = extension.endsWith('.rtf')
      ? { sourceLanguage: leftRtfLanguage, targetLanguage: leftRtfLanguage === 'zh-CN' ? 'en-US' : 'zh-CN' }
      : extension.endsWith('.tmx') && tmxDirection !== 'auto'
        ? { sourceLanguage: tmxDirection === 'zh-en' ? 'zh' : 'en', targetLanguage: tmxDirection === 'zh-en' ? 'en' : 'zh' }
        : {};
    void work((signal, progress) => importCorpusFile(file, signal, progress, options));
  };
  const inputDocument = async (input: InputDocument, language: string, name: string, signal: AbortSignal, report: (message: string, fraction?: number) => void) => {
    if (input.file) return importAlignmentDocument(input.file, language, signal, report);
    if (!input.text.trim()) throw new Error('请提供' + name + '文档或粘贴正文。');
    return { document: textDocument(input.text, name + '正文', language), warnings: [] };
  };
  const beginAlignment = () => {
    if (!canReplace()) return;
    void work(async (signal, report) => {
      const zh = await inputDocument(chinese, 'zh-CN', '中文', signal, report);
      signal.throwIfAborted();
      const en = await inputDocument(english, 'en-US', '英文', signal, report);
      signal.throwIfAborted();
      const result = await alignCorpusInBrowser({ source: direction === 'zh-en' ? zh.document : en.document,
        target: direction === 'zh-en' ? en.document : zh.document, mode }, signal, report);
      result.warnings.push(...[...zh.warnings, ...en.warnings].map(message => ({ message })));
      return result;
    });
  };
  const realign = () => {
    const current = useCorpusStore.getState().project;
    if (!current || current.origin !== 'alignment') return;
    if (!window.confirm('重新对齐会保留锁定锚点，并替换其余自动或人工调整。建议先保存项目。是否继续？')) return;
    void work(async (signal, report) => {
      const source = current.documents.find(document => document.language === current.sourceLanguage);
      const target = current.documents.find(document => document.language === current.targetLanguage);
      if (!source || !target) throw new Error('原文档不完整，无法重新对齐。');
      if (current.excludedUnits?.length) throw new Error('请先恢复排除记录再重新自动对齐，避免重复导入已排除内容。');
      return alignCorpusInBrowser({ source, target, mode, anchors: current.units.filter(unit => unit.locked), name: current.name }, signal, report);
    });
  };
  const saveProject = () => {
    try {
      const current = useCorpusStore.getState().project;
      if (!current) return;
      downloadBlob(new Blob([new Uint8Array(serializeProject(current))], { type: 'application/json;charset=utf-8' }), filename(current, 'corpus.json'));
      setNotice('项目已保存，包含原文位置、标签、人工调整、排除记录和复核状态。');
    } catch (error) { setError(error instanceof Error ? error.message : '保存项目失败。'); }
  };
  const requestExport = (format: ExportFormat) => {
    if (operation.current) return;
    try {
      const current = useCorpusStore.getState().project;
      if (!current) return;
      const losses = format === 'sdltm' ? sdltmExportLosses(current) : format === 'tmx' ? exportTmxLosses(current) : rtfExportLosses(current);
      setError(null); setNotice(null); setExporting({ format, snapshot: current, losses });
    } catch (error) { setError(error instanceof Error ? error.message : '无法准备导出。'); }
  };
  const closeExport = () => {
    if (exporting?.format === 'sdltm') cancelWork('已取消 SDLTM 导出，项目仍保留，可重新确认导出。');
    setExporting(null);
  };
  const performExport = async () => {
    if (!exporting || operation.current || !live.current) return;
    const { snapshot, format } = exporting;
    if (useCorpusStore.getState().project !== snapshot) {
      setError('项目已变更，请重新确认导出当前内容。'); setExporting(null);
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    const current = () => live.current && operation.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setNotice(null); setProgress({ message: '准备导出 ' + format.toUpperCase(), fraction: 0 });
    try {
      if (snapshot.origin === 'alignment') assertCorpusCoverage(snapshot);
      let bytes: Uint8Array;
      let message = '已导出 ' + snapshot.units.length + ' 行 ' + format.toUpperCase() + '。';
      if (format === 'sdltm') {
        sdltmExportLosses(snapshot);
        const result = await exportSdltmInBrowser(snapshot, controller.signal, (message, fraction) => {
          if (current() && useCorpusStore.getState().project === snapshot) setProgress({ message, fraction });
        });
        bytes = result.bytes;
        message = '已导出 ' + result.validation.units + ' 行 SDLTM（实验），工作方向 ' + result.validation.sourceLanguage + ' → ' + result.validation.targetLanguage
          + '。仅完成本地结构校验，不保证兼容 Trados。';
      } else bytes = format === 'tmx' ? exportTmx(snapshot) : exportRtf(snapshot);
      if (!current()) return;
      if (useCorpusStore.getState().project !== snapshot) {
        setError('项目已变更，本次结果已过期，未下载文件。请重新确认导出。'); setExporting(null);
        return;
      }
      const type = format === 'sdltm' ? 'application/octet-stream' : format === 'tmx' ? 'application/xml;charset=utf-8' : 'application/rtf';
      downloadBlob(new Blob([new Uint8Array(bytes)], { type }), filename(snapshot, format));
      setExporting(null); setError(null); setNotice(message);
    } catch (error) {
      if (current()) {
        setError(error instanceof Error ? error.message : '导出失败，项目仍保留，请重试。');
        if (useCorpusStore.getState().project !== snapshot) setExporting(null);
      }
    } finally {
      if (operation.current === controller && live.current) { setBusy(false); setProgress(null); operation.current = null; }
    }
  };
  const counts = project ? {
    confirmed: project.units.filter(unit => unit.review === 'confirmed').length,
    empty: project.units.filter(unit => !variantOf(unit, project.sourceLanguage).text.trim() || !variantOf(unit, project.targetLanguage).text.trim()).length,
    anchors: project.units.filter(unit => unit.locked).length,
  } : null;

  return <section className="mx-auto w-full max-w-[1220px] px-4 py-5 sm:px-7 sm:py-7 [&_button]:disabled:opacity-40">
    <button type="button" onClick={() => { cancelWork('已停止处理，项目仍保留。'); setExporting(null); onBack(); }} className="mb-2 min-h-10 text-[13px] text-[#777777]">← 返回翻译</button>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-[24px] font-semibold text-[#222222]">中英语料工具 <span className="text-[12px] font-normal text-[#888888]">Beta</span></h1>
        <p className="mt-1 text-[13px] leading-6 text-[#777777]">转换 TMX / 双栏 RTF，或把中文与英文文档整理为可校正的对应语料。文件在此浏览器内处理。</p></div>
      {project && <span className="text-[11px] text-[#888888]" role="status">{saving === 'saved' ? '已自动保存在此浏览器' : saving === 'saving' ? '正在本地保存…' : saving === 'error' ? '自动保存失败，请下载项目文件' : '尚有待保存修改'}</span>}
    </div>
    <div className="mb-4 flex flex-wrap gap-2" aria-label="语料工具流程">
      <button type="button" disabled={busy} aria-pressed={tab === 'convert'} className={tab === 'convert' ? 'btn btn-primary min-h-11' : BUTTON} onClick={() => setTab('convert')}>格式转换</button>
      <button type="button" disabled={busy} aria-pressed={tab === 'align'} className={tab === 'align' ? 'btn btn-primary min-h-11' : BUTTON} onClick={() => setTab('align')}>中英双文档对齐</button>
    </div>
    {tab === 'convert' ? <div className="rounded-xl border border-[#e0e0e0] bg-white p-4 sm:p-5">
      <h2 className="text-[15px] font-medium text-[#333333]">导入已有双语对应</h2>
      <p className="my-2 text-[12px] leading-6 text-[#777777]">支持 TMX、多语言 TMX 中的中英工作对、常见双列表格 RTF，以及之前保存的语料项目。TMX 直接读取语言标签；RTF 请确认左右列语言。</p>
      <div className="my-3 flex flex-wrap items-end gap-3">
        <label className="min-w-[210px] text-[12px] text-[#555555]">TMX 导入工作方向
          <select value={tmxDirection} disabled={busy} onChange={event => setTmxDirection(event.target.value as typeof tmxDirection)} className={FIELD + ' mt-1'}>
            <option value="auto">自动（按有效文件头）</option><option value="zh-en">中文 → 英文</option><option value="en-zh">英文 → 中文</option>
          </select>
        </label>
        <label className="min-w-[210px] text-[12px] text-[#555555]">RTF 源文/左列语言
          <select value={leftRtfLanguage} disabled={busy} onChange={event => setLeftRtfLanguage(event.target.value)} className={FIELD + ' my-1'}>
            <option value="zh-CN">中文（zh-CN）</option><option value="en-US">英文（en-US）</option>
          </select>
          <span className="block text-[11px] text-[#888888]">目标/右列：{leftRtfLanguage === 'zh-CN' ? '英文（en-US）' : '中文（zh-CN）'}</span>
        </label>
        <input ref={importRef} type="file" accept=".tmx,.rtf,.json" disabled={busy} className="hidden" aria-label="导入双语语料文件"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) importFile(file); }} />
        <button type="button" className="btn btn-primary min-h-11" disabled={busy} onClick={() => importRef.current?.click()}>选择 TMX / RTF / 项目文件</button>
      </div>
      <p className="text-[11px] leading-5 text-[#888888]">每个输入文件最大 10 MiB，项目文件最大 30 MiB。旧 Trados 隐藏源文 RTF、复杂合并表格会提示不支持。首次解析 RTF / DOCX 需加载约 62 MB 解析资源。</p>
    </div> : <div className="rounded-xl border border-[#e0e0e0] bg-white p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <DocumentInput label="中文文档" value={chinese} onChange={setChinese} disabled={busy} />
        <DocumentInput label="英文文档" value={english} onChange={setEnglish} disabled={busy} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-[12px] text-[#555555]">工作方向<select value={direction} disabled={busy} onChange={event => setDirection(event.target.value)} className={FIELD + ' mt-1'}><option value="zh-en">中文 → 英文</option><option value="en-zh">英文 → 中文</option></select></label>
        <label className="text-[12px] text-[#555555]">对齐方式<select value={mode} disabled={busy} onChange={event => setMode(event.target.value as typeof mode)} className={FIELD + ' mt-1'}><option value="semantic">本地语义对齐（推荐）</option><option value="structure">快速结构对齐（免模型下载）</option></select></label>
      </div>
      <p className="my-3 text-[11px] leading-5 text-[#888888]">{mode === 'semantic' ? '首次使用下载约 136 MB 中英语义模型及约 22 MB 运行资源，可缓存；在浏览器内比较含义，不调用翻译 API。' : '依据长度、数字和顺序生成初步对应，不验证语义；请逐行复核。'} 自动支持多句对应和留空；换序可在编辑器中人工调整。</p>
      <button type="button" className="btn btn-primary min-h-11" disabled={busy} onClick={beginAlignment}>开始中英文对齐</button>
    </div>}

    {busy && exporting?.format !== 'sdltm' && <div className="mt-4 rounded-lg border border-[#91caff] bg-[#f0f7ff] p-4" role="status">
      <div className="flex items-center justify-between gap-3"><span className="text-[13px] text-[#245a93]">{progress?.message || '正在处理…'}</span>
        <button type="button" className={BUTTON} onClick={() => cancelWork()}>取消</button></div>
      {progress?.fraction !== undefined && <progress max={1} value={Math.max(0, Math.min(1, progress.fraction))} className="mt-2 h-2 w-full accent-[#1677ff]" aria-label="语料处理进度" />}
    </div>}
    {error && <p role="alert" className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-[#ffccc7] bg-[#fff2f0] p-3 text-[13px] text-[#b42318]">{error}</p>}
    {notice && <p role="status" className="mt-3 text-[12px] leading-6 text-[#555555]">{notice}</p>}
    {project && counts && <>
      <div className="mt-5 rounded-xl border border-[#e0e0e0] bg-[#fafafa] p-4">
        <label className="text-[12px] text-[#777777]">项目名称（最多 500 字）<input key={project.id + ':' + project.name} defaultValue={project.name} maxLength={500} disabled={busy}
          onBlur={event => { const name = event.target.value.trim(); if (name && name !== project.name) operate(project => ({ ...project, name, updatedAt: new Date().toISOString() })); }} className={FIELD + ' my-1 max-w-[440px]'} /></label>
        <div className="my-2 flex flex-wrap items-center gap-3">
          <p className="text-[12px] text-[#777777]">{languageLabel(project.sourceLanguage)} · {project.sourceLanguage} → {languageLabel(project.targetLanguage)} · {project.targetLanguage} · {counts.confirmed} 行已复核 · {counts.empty} 行含空侧 · {counts.anchors} 个锚点{project.excludedUnits?.length ? ' · ' + project.excludedUnits.length + ' 行已排除' : ''}</p>
          <label className="min-w-[200px] text-[12px] text-[#555555]">当前项目工作方向
            <select value={languageBase(project.sourceLanguage) === 'zh' ? 'zh-en' : 'en-zh'} disabled={busy} className={FIELD + ' mt-1'}
              onChange={event => { const source = event.target.value === 'zh-en' ? 'zh' : 'en'; operate(current => languageBase(current.sourceLanguage) === source ? current : swapDirection(current)); }}>
              <option value="zh-en">中文 → 英文</option><option value="en-zh">英文 → 中文</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={BUTTON} onClick={saveProject}>保存项目 JSON</button>
          <button type="button" disabled={busy || !project.units.length} className={BUTTON} onClick={() => requestExport('tmx')}>导出 TMX</button>
          <button type="button" disabled={busy || !project.units.length} className={BUTTON} onClick={() => requestExport('rtf')}>导出双栏 RTF</button>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || !project.units.length} className={BUTTON} aria-describedby="sdltm-compatibility" onClick={() => requestExport('sdltm')}>导出 SDLTM（实验）</button>
            <small id="sdltm-compatibility" className="text-[11px] text-[#888888]">不保证兼容 Trados</small>
          </div>
          {project.origin === 'alignment' && <button type="button" disabled={busy} className={BUTTON} onClick={realign}>按锚点重新对齐</button>}
        </div>
        {project.warnings.length > 0 && <details className="mt-3 text-[12px] text-[#777777]"><summary className="cursor-pointer">查看 {project.warnings.length} 条格式与对齐提示</summary>
          <ul className="mt-2 max-h-52 list-disc space-y-1 overflow-y-auto pl-5">{project.warnings.map((warning, index) => <li key={index} className="break-words">{warning.message}</li>)}</ul>
        </details>}
      </div>
      <CorpusEditor busy={busy} operate={operate} issue={error || undefined} />
    </>}
    {exporting && <CorpusDialog title={'导出 ' + exporting.format.toUpperCase() + (exporting.format === 'sdltm' ? '（实验）' : '')} close={closeExport} error={error || undefined}>
      {exporting.format === 'sdltm' && <p className="mb-3 rounded-lg border border-[#ffe58f] bg-[#fffbe6] p-3 text-[13px] leading-6 text-[#874d00]">实验性 TMX → SDLTM 导出，不保证兼容 Trados。结果仅经过本地结构校验，尚未验证 Trados 中的打开、检索和编辑兼容性。请同时保留 TMX 与项目 JSON。</p>}
      <p className="mb-3 text-[13px] leading-6">本次导出 {exporting.snapshot.units.length} 行，包含 {exporting.snapshot.units.filter(unit => unit.review !== 'confirmed').length} 行待复核内容。{exporting.format !== 'sdltm' && '空侧和双空行会保留，'}已排除的记录不导出。</p>
      {!!exporting.losses.length && <ul className="mb-4 max-h-64 list-disc space-y-2 overflow-y-auto pl-5 text-[12px] leading-5 text-[#777777]">{exporting.losses.map((loss, index) => <li key={index}>{loss}</li>)}</ul>}
      <p className="mb-4 text-[12px] text-[#777777]">需要继续编辑、保留全部字段和复核记录时，请同时保存项目 JSON。</p>
      {busy && exporting.format === 'sdltm' && <div className="mb-4 rounded-lg border border-[#91caff] bg-[#f0f7ff] p-3" role="status" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-[13px] text-[#245a93]">{progress?.message || '正在导出 SDLTM…'}</span>
          <button type="button" className={BUTTON} onClick={() => cancelWork('已取消 SDLTM 导出，项目仍保留，可重试。')}>取消导出</button></div>
        {progress?.fraction !== undefined && <progress max={1} value={Math.max(0, Math.min(1, progress.fraction))} className="mt-2 h-2 w-full accent-[#1677ff]" aria-label="SDLTM 导出进度" />}
      </div>}
      {notice && <p role="status" className="mb-3 text-[12px] leading-6 text-[#555555]">{notice}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="btn btn-primary min-h-11" onClick={() => void performExport()}>{busy ? '正在导出…' : error ? '重试导出' : '确认导出'}</button><button type="button" className={BUTTON} onClick={closeExport}>{busy ? '取消并返回编辑' : '返回编辑'}</button></div>
    </CorpusDialog>}
  </section>;
}

function filename(project: CorpusProject, extension: string): string {
  const name = Array.from(project.name.replace(/[<>:"/\\|?*]/g, '_')).map(character => character.codePointAt(0)! < 32 ? '_' : character).join('').slice(0, 90) || '中英语料';
  const draft = extension !== 'corpus.json' && project.units.some(unit => unit.review !== 'confirmed') ? '-待复核' : '';
  return name + draft + '-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + '.' + extension;
}
function DocumentInput({ label, value, onChange, disabled }: { label: string; value: InputDocument; onChange: (value: InputDocument) => void; disabled: boolean }) {
  return <div className="min-w-0">
    <label className="mb-2 block text-[13px] font-medium text-[#333333]">{label}
      <input type="file" accept=".txt,.md,.docx,.rtf" disabled={disabled}
        onChange={event => { const file = event.target.files?.[0] || null; event.target.value = ''; onChange({ ...value, file }); }}
        className="mt-2 block max-w-full text-[12px] text-[#777777] file:mr-2 file:rounded-md file:border file:border-[#d9dde4] file:bg-white file:px-3 file:py-2 file:text-[12px]" />
    </label>
    {value.file ? <div className="rounded-lg border border-[#e0e0e0] p-3 text-[12px] text-[#555555]"><p className="break-all">{value.file.name} · {(value.file.size / 1024).toFixed(1)} KiB</p>
      <button type="button" disabled={disabled} onClick={() => onChange({ ...value, file: null })} className="mt-2 min-h-10 text-[#1677ff]">移除文件，改用粘贴正文</button></div>
      : <textarea aria-label={label + '正文'} value={value.text} disabled={disabled} onChange={event => onChange({ ...value, text: event.target.value })} rows={7} className={FIELD + ' resize-y leading-6'} placeholder={'选择 TXT / DOCX / RTF 文件，或在这里粘贴' + label + '正文'} />}
  </div>;
}
