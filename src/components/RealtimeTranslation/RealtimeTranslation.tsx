import { useEffect, useRef, useState } from 'react';
import { XiaomiRealtimeASRProvider, ServerRealtimeTranslationProvider } from '../../services/realtime/providers';
import { BrowserMicrophoneCapture } from '../../services/realtime/audio';
import { SherpaStreamingASRProvider } from '../../services/realtime/sherpa/provider';
import { RealtimeSessionEngine, type RealtimeSessionState, type RealtimeSubtitleSegment } from '../../services/realtime/session';
import type { RealtimeSourceLanguage, RealtimeTargetLanguage } from '../../services/realtime/config';
import { useTranslationStore } from '../../store/translationStore';
import { TranslationModelSelect } from '../TranslationModelSelect/TranslationModelSelect';

const INITIAL_STATE: RealtimeSessionState = {
  status: 'idle', error: null, current: null, segments: [], isListening: false, preparation: null,
  translationPending: 0, recognitionPending: 0, isPaused: false, isStarting: false,
  metrics: {
    captureTimestamp: null, chunkDurationMs: 0, asrLatencyMs: null,
    asrFirstResponseLatencyMs: null, translationLatencyMs: null,
    endToEndSubtitleLatencyMs: null, revisions: 0, discardedStaleResponses: 0,
    retryCount: 0, rateLimitCount: 0,
  },
};

const STATUS_LABEL: Record<RealtimeSessionState['status'], string> = {
  idle: '尚未开始', 'preparing-model': '正在加载本机语音模型', 'requesting-microphone': '正在请求麦克风权限', listening: '正在聆听',
  recognizing: '正在识别语音', translating: '正在生成译文', backpressure: '正在处理已采集语音',
  'network-reconnecting': '正在重新连接', 'network-disconnected': '网络连接中断',
  'rate-limited': '请求较多，请稍候', paused: '已暂停', stopping: '正在结束本次翻译', error: '无法开始',
  'recognition-failed': '本机语音识别未完成',
};

export function RealtimeTranslation({ onBack }: { onBack: () => void }) {
  const context = useTranslationStore((state) => state.context);
  const terminology = useTranslationStore((state) => state.terminology);
  const preserveNames = useTranslationStore((state) => state.preserveNames);
  const model = useTranslationStore((state) => state.model);
  const setModel = useTranslationStore((state) => state.setModel);
  const [sourceLanguage, setSourceLanguage] = useState<RealtimeSourceLanguage>('auto');
  const [targetLanguage, setTargetLanguage] = useState<RealtimeTargetLanguage>('auto');
  const [asrEngine, setAsrEngine] = useState<'sherpa' | 'mimo'>('sherpa');
  const [transcriptionOnly, setTranscriptionOnly] = useState(true);
  const [localASR] = useState(() => new SherpaStreamingASRProvider());
  const [onlineASR] = useState(() => new XiaomiRealtimeASRProvider());
  const [session, setSession] = useState(INITIAL_STATE);
  const [engine] = useState(() => new RealtimeSessionEngine({
    capture: new BrowserMicrophoneCapture(),
    asr: localASR,
    translation: new ServerRealtimeTranslationProvider(),
    model,
    sourceLanguage, targetLanguage, context, terminology, preserveNames, transcriptionOnly,
    onChange: setSession,
  }));
  const lifecycle = useRef(0);
  const historyRef = useRef<HTMLOListElement>(null);
  const followHistory = useRef(true);

  useEffect(() => {
    if (followHistory.current && historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [session.segments]);

  useEffect(() => {
    engine.updateSettings({ model, sourceLanguage, targetLanguage, context, terminology, preserveNames, transcriptionOnly,
      asr: asrEngine === 'sherpa' ? localASR : onlineASR });
  }, [engine, model, sourceLanguage, targetLanguage, context, terminology, preserveNames, transcriptionOnly, asrEngine, localASR, onlineASR]);

  useEffect(() => {
    lifecycle.current += 1;
    return () => {
      const cleanupGeneration = ++lifecycle.current;
      queueMicrotask(() => {
        if (lifecycle.current === cleanupGeneration) void engine.dispose();
      });
    };
  }, [engine]);

  const active = session.isListening || session.isStarting || session.translationPending > 0 || session.recognitionPending > 0
    || ['preparing-model', 'requesting-microphone', 'stopping'].includes(session.status);
  const canRetry = asrEngine === 'mimo' && ['network-disconnected', 'rate-limited', 'recognition-failed'].includes(session.status);
  const failedTranslations = session.segments.filter((segment) => segment.translationStatus === 'error').length;
  const beginSession = () => {
    // Read the current controls at the start action as well as in the settings effect.
    engine.updateSettings({ model, sourceLanguage, targetLanguage, context, terminology, preserveNames, transcriptionOnly,
      asr: asrEngine === 'sherpa' ? localASR : onlineASR });
    void engine.start();
  };

  return (
    <section className="w-full max-w-[900px] mx-auto px-4 py-5 sm:px-7 sm:py-7 [&_button]:min-h-11 [&_select]:min-h-11">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <button type="button" onClick={onBack} className="text-[13px] text-[#777777] hover:text-[#222222] mb-2">← 返回翻译</button>
          <h1 className="text-[22px] sm:text-[26px] font-semibold text-[#1a1a1a]">实时翻译 <span className="text-[12px] font-medium text-[#777777] align-middle ml-1">Beta</span></h1>
          <p className="text-[13px] text-[#777777] mt-1">把语音变成文字，也可以生成双语字幕。支持中文和英文。</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[12px] text-[#777777] pt-2" role="status" aria-live="polite">
          <span className={`w-2 h-2 rounded-full ${session.isListening ? 'bg-[#52c41a]' : 'bg-[#b8bdc3]'}`} />
          {STATUS_LABEL[session.status]}
        </div>
      </div>

      <div className="border border-[#e4e6ea] rounded-lg bg-white p-4 sm:p-5 mb-4">
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <label className="text-[12px] font-medium text-[#666666] flex-1 min-w-[200px]">
            语音识别引擎
            <select value={asrEngine} onChange={(event) => setAsrEngine(event.target.value as 'sherpa' | 'mimo')} disabled={active} className="block mt-1.5 w-full h-10 border border-[#e0e0e0] rounded-md bg-white px-3 text-[14px] text-[#222222]">
              <option value="sherpa">本机中英流式识别 · 音频不上传</option>
              <option value="mimo">在线 MiMo</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-[#555555] pb-2 min-h-11">
            <input type="checkbox" checked={transcriptionOnly} disabled={active} onChange={(event) => setTranscriptionOnly(event.target.checked)} />
            仅转文字
          </label>
        </div>
        {!transcriptionOnly && <div className="mb-4">
          <TranslationModelSelect value={model} onChange={setModel} disabled={active} />
        </div>}
        <div className={`grid gap-3 items-end ${transcriptionOnly ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-[1fr_auto_1fr]'}`}>
          <label className="text-[12px] font-medium text-[#666666]">
            说话语言
            <select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value as RealtimeSourceLanguage)} disabled={active} className="block mt-1.5 w-full h-10 border border-[#e0e0e0] rounded-md bg-white px-3 text-[14px] text-[#222222]">
              <option value="auto">自动识别（中 / 英）</option><option value="zh">中文</option><option value="en">English</option>
            </select>
          </label>
          {!transcriptionOnly && <span className="hidden sm:block text-[#999999] pb-2" aria-hidden="true">→</span>}
          {!transcriptionOnly && <label className="text-[12px] font-medium text-[#666666]">
            翻译为
            <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value as RealtimeTargetLanguage)} disabled={active} className="block mt-1.5 w-full h-10 border border-[#e0e0e0] rounded-md bg-white px-3 text-[14px] text-[#222222]">
              <option value="auto">自动切换中 / 英</option><option value="zh">中文</option><option value="en">English</option>
            </select>
          </label>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {!active ? (
            <button type="button" onClick={beginSession} className="btn btn-primary h-10 px-5">
              <MicrophoneIcon /> {transcriptionOnly ? '开始语音转文字' : '开始实时翻译'}
            </button>
          ) : (
            <>
              {session.isPaused ? (
                <button type="button" onClick={() => void engine.resume()} disabled={!session.isListening || session.status === 'stopping'} className="btn btn-secondary">继续聆听</button>
              ) : (
                <button type="button" onClick={() => void engine.pause()} disabled={!session.isListening || session.status === 'stopping'} className="btn btn-secondary">暂停</button>
              )}
              {(session.isListening || ['preparing-model', 'requesting-microphone'].includes(session.status)) && <button type="button" onClick={() => void engine.stop()} disabled={session.status === 'stopping'} className="btn btn-secondary text-[#b42318]">{session.status === 'preparing-model' ? '取消加载' : '结束收音并整理字幕'}</button>}
            </>
          )}
          {canRetry && <button type="button" onClick={() => void engine.retryPending()} className="btn btn-secondary">重试未完成内容</button>}
          <span className="sm:hidden text-[12px] text-[#777777]" role="status" aria-live="polite">{STATUS_LABEL[session.status]}</span>
        </div>
        {session.error && <p role="status" className="mt-3 text-[13px] text-[#b42318]">{session.error}</p>}
        {!transcriptionOnly && session.translationPending > 0 && <p role="status" className="mt-3 text-[12px] text-[#666666]">
          {session.isListening ? '正在接收语音' : '收音已结束'} · {session.translationPending} 段译文待完成
        </p>}
        {asrEngine === 'sherpa' && <p role="status" className="mt-3 text-[12px] text-[#666666]">
          {session.preparation?.message || '中英流式模型约 50 MB，运行组件约 12 MB；首次加载后可使用缓存。'}
          {session.status === 'preparing-model' && session.preparation?.progress !== undefined && ` · ${session.preparation.progress}%`}
        </p>}
        <p className="mt-3 text-[11px] leading-5 text-[#8a8a8a]">
          {asrEngine === 'sherpa' ? `语音在当前浏览器持续识别，边说边更新文字，停顿后确认。${transcriptionOnly ? '仅转文字时不调用翻译服务。' : '识别文字将发送给翻译服务。'}` : '语音将发送至在线识别服务。'}
          请允许麦克风访问，并核对人名和专业术语。
        </p>
      </div>

      <div className="border border-[#e4e6ea] rounded-lg bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-[#eeeeee] flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-[#333333]">当前语音</h2>
          {session.current && <span className="text-[11px] text-[#777777]">实时修订中</span>}
        </div>
        {session.current ? (
          <div className={transcriptionOnly ? '' : 'grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#eeeeee]'}>
            <div className="p-4 sm:p-5 min-h-[112px] min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-[#999999] mb-2">原文</p>
              <LiveTranscript segment={session.current} />
            </div>
            {!transcriptionOnly && <div className="p-4 sm:p-5 min-h-[112px] min-w-0 bg-[#fcfcfd]">
              <TranslationCaption segment={session.current} large onRetry={() => engine.retryTranslation(session.current!.id)} />
            </div>}
          </div>
        ) : (
          <div className="px-5 py-10 text-center text-[13px] text-[#999999]">{transcriptionOnly ? '开始说话后，识别文字会显示在这里。' : '开始说话后，原文和译文会显示在这里。'}</div>
        )}
      </div>

      {session.segments.length > 0 && (
        <div className="mt-4 border border-[#e4e6ea] rounded-lg bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-[#eeeeee] flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-[#333333]">{transcriptionOnly ? '已确认字幕' : '字幕记录'}</h2>
            {failedTranslations > 0 && !transcriptionOnly && <button type="button" onClick={() => engine.retryTranslation()} className="text-[12px] text-[#b42318]">重试 {failedTranslations} 段未完成译文</button>}
          </div>
          <ol ref={historyRef} onScroll={(event) => {
            const list = event.currentTarget;
            followHistory.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
          }} className="divide-y divide-[#eeeeee] max-h-[48vh] overflow-y-auto">
            {session.segments.map((segment) => (
              <li key={segment.id} className={`${transcriptionOnly ? '' : 'grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-6'} px-4 py-3.5 sm:px-5`}>
                <p className="text-[14px] leading-6 text-[#555555] min-w-0 whitespace-pre-wrap break-words">{segment.sourceText}</p>
                {!transcriptionOnly && <div className="min-w-0"><TranslationCaption segment={segment} onRetry={() => engine.retryTranslation(segment.id)} /></div>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {import.meta.env.DEV && <div className="mt-3 text-[10px] text-[#999999] leading-5">
        音频窗 {Math.round(session.metrics.chunkDurationMs)} ms · ASR {formatMetric(session.metrics.asrLatencyMs)} · 首响应 {formatMetric(session.metrics.asrFirstResponseLatencyMs)} · 翻译 {formatMetric(session.metrics.translationLatencyMs)} · 端到端 {formatMetric(session.metrics.endToEndSubtitleLatencyMs)} · 修订 {session.metrics.revisions} · 丢弃旧响应 {session.metrics.discardedStaleResponses} · 重试 {session.metrics.retryCount} · 429 {session.metrics.rateLimitCount}
      </div>}
    </section>
  );
}

function formatMetric(value: number | null) { return value === null ? '—' : `${Math.round(value)} ms`; }

function LiveTranscript({ segment }: { segment: RealtimeSubtitleSegment }) {
  const stable = segment.sourceText.startsWith(segment.stableSourceText) ? segment.stableSourceText : '';
  return <p className="text-[16px] leading-7 whitespace-pre-wrap break-words" aria-label="正在修订的识别文字">
    <span className="text-[#222222]">{stable}</span>
    <span className="text-[#1677ff]">{segment.sourceText.slice(stable.length)}</span>
  </p>;
}

function TranslationCaption({ segment, large = false, onRetry }: { segment: RealtimeSubtitleSegment; large?: boolean; onRetry: () => void }) {
  const labels = { off: '', queued: '等待翻译', streaming: '正在生成 · 可修订', draft: '草稿 · 句末确认', confirmed: '译文已确认', error: '译文未完成' };
  const revisedSource = segment.translatedText && segment.translationSourceRevision !== segment.revision;
  return <>
    <p className="text-[11px] text-[#888888] mb-1.5">{large && '译文 · '}{labels[segment.translationStatus]}{revisedSource && ' · 原文已更新'}</p>
    <p className={`${large ? 'text-[16px] leading-7' : 'text-[14px] leading-6'} text-[#222222] whitespace-pre-wrap break-words`}>
      {segment.translatedText || <span className="text-[#999999]">{segment.translationStatus === 'error' ? '原文已保留' : segment.translationStatus === 'draft' ? '等待足够的语音内容…' : '译文处理中…'}</span>}
    </p>
    {segment.translationError && <p className="mt-1 text-[12px] text-[#b42318] break-words">{segment.translationError}</p>}
    {segment.translationStatus === 'error' && <button type="button" onClick={onRetry} className="mt-1 text-[12px] text-[#b42318] underline underline-offset-2">重试本段译文</button>}
  </>;
}

function MicrophoneIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5a2.5 2.5 0 00-2.5 2.5v5a2.5 2.5 0 005 0V5A2.5 2.5 0 0010 2.5zM5 9.5a5 5 0 0010 0M10 14.5V18m-3 0h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
}
