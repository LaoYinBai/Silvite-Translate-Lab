import { useEffect, useRef, useState } from 'react';
import { XiaomiRealtimeASRProvider, XiaomiRealtimeTranslationProvider } from '../../services/realtime/providers';
import { BrowserMicrophoneCapture } from '../../services/realtime/audio';
import { RealtimeSessionEngine, type RealtimeSessionState } from '../../services/realtime/session';
import type { RealtimeSourceLanguage, RealtimeTargetLanguage } from '../../services/realtime/config';
import { useTranslationStore } from '../../store/translationStore';

const INITIAL_STATE: RealtimeSessionState = {
  status: 'idle', error: null, current: null, segments: [], isListening: false,
  metrics: {
    captureTimestamp: null, chunkDurationMs: 0, asrLatencyMs: null,
    asrFirstResponseLatencyMs: null, translationLatencyMs: null,
    endToEndSubtitleLatencyMs: null, revisions: 0, discardedStaleResponses: 0,
    retryCount: 0, rateLimitCount: 0,
  },
};

const STATUS_LABEL: Record<RealtimeSessionState['status'], string> = {
  idle: '尚未开始', 'requesting-microphone': '正在请求麦克风权限', listening: '正在聆听',
  recognizing: '正在识别语音', translating: '正在生成译文', backpressure: '正在处理已采集语音',
  'network-reconnecting': '正在重新连接', 'network-disconnected': '网络连接中断',
  'rate-limited': '请求较多，请稍候', paused: '已暂停', stopping: '正在结束本次翻译', error: '无法开始',
};

export function RealtimeTranslation({ onBack }: { onBack: () => void }) {
  const context = useTranslationStore((state) => state.context);
  const terminology = useTranslationStore((state) => state.terminology);
  const preserveNames = useTranslationStore((state) => state.preserveNames);
  const [sourceLanguage, setSourceLanguage] = useState<RealtimeSourceLanguage>('auto');
  const [targetLanguage, setTargetLanguage] = useState<RealtimeTargetLanguage>('auto');
  const [session, setSession] = useState(INITIAL_STATE);
  const [engine] = useState(() => new RealtimeSessionEngine({
    capture: new BrowserMicrophoneCapture(),
    asr: new XiaomiRealtimeASRProvider(),
    translation: new XiaomiRealtimeTranslationProvider(),
    sourceLanguage, targetLanguage, context, terminology, preserveNames,
    onChange: setSession,
  }));
  const lifecycle = useRef(0);

  useEffect(() => {
    engine.updateSettings({ sourceLanguage, targetLanguage, context, terminology, preserveNames });
  }, [engine, sourceLanguage, targetLanguage, context, terminology, preserveNames]);

  useEffect(() => {
    lifecycle.current += 1;
    return () => {
      const cleanupGeneration = ++lifecycle.current;
      queueMicrotask(() => {
        if (lifecycle.current === cleanupGeneration) void engine.dispose();
      });
    };
  }, [engine]);

  const active = session.isListening || ['requesting-microphone', 'stopping'].includes(session.status);
  const canRetry = ['network-disconnected', 'rate-limited'].includes(session.status);

  return (
    <section className="w-full max-w-[900px] mx-auto px-4 py-5 sm:px-7 sm:py-7">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <button type="button" onClick={onBack} className="text-[13px] text-[#777777] hover:text-[#222222] mb-2">← 返回翻译</button>
          <h1 className="text-[22px] sm:text-[26px] font-semibold text-[#1a1a1a]">实时翻译 <span className="text-[12px] font-medium text-[#777777] align-middle ml-1">Beta</span></h1>
          <p className="text-[13px] text-[#777777] mt-1">边说边看双语字幕。当前支持自动识别、中文和英文。</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[12px] text-[#777777] pt-2" role="status" aria-live="polite">
          <span className={`w-2 h-2 rounded-full ${session.isListening ? 'bg-[#52c41a]' : 'bg-[#b8bdc3]'}`} />
          {STATUS_LABEL[session.status]}
        </div>
      </div>

      <div className="border border-[#e4e6ea] rounded-lg bg-white p-4 sm:p-5 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <label className="text-[12px] font-medium text-[#666666]">
            说话语言
            <select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value as RealtimeSourceLanguage)} disabled={active} className="block mt-1.5 w-full h-10 border border-[#e0e0e0] rounded-md bg-white px-3 text-[14px] text-[#222222]">
              <option value="auto">自动识别（中 / 英）</option><option value="zh">中文</option><option value="en">English</option>
            </select>
          </label>
          <span className="hidden sm:block text-[#999999] pb-2" aria-hidden="true">→</span>
          <label className="text-[12px] font-medium text-[#666666]">
            翻译为
            <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value as RealtimeTargetLanguage)} disabled={active} className="block mt-1.5 w-full h-10 border border-[#e0e0e0] rounded-md bg-white px-3 text-[14px] text-[#222222]">
              <option value="auto">自动切换中 / 英</option><option value="zh">中文</option><option value="en">English</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {!active ? (
            <button type="button" onClick={() => void engine.start()} className="btn btn-primary h-10 px-5">
              <MicrophoneIcon /> 开始实时翻译
            </button>
          ) : (
            <>
              {session.status === 'paused' ? (
                <button type="button" onClick={() => void engine.resume()} className="btn btn-secondary">继续聆听</button>
              ) : (
                <button type="button" onClick={() => void engine.pause()} disabled={!session.isListening} className="btn btn-secondary">暂停</button>
              )}
              <button type="button" onClick={() => void engine.stop()} className="btn btn-secondary text-[#b42318]">结束并整理字幕</button>
            </>
          )}
          {canRetry && <button type="button" onClick={() => void engine.retryPending()} className="btn btn-secondary">重试未完成内容</button>}
          <span className="sm:hidden text-[12px] text-[#777777]" role="status" aria-live="polite">{STATUS_LABEL[session.status]}</span>
        </div>
        {session.error && <p role="status" className="mt-3 text-[13px] text-[#b42318]">{session.error}</p>}
        <p className="mt-3 text-[11px] leading-5 text-[#8a8a8a]">语音仅用于实时识别，不保存原始音频。请在浏览器提示中允许麦克风访问。</p>
      </div>

      <div className="border border-[#e4e6ea] rounded-lg bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-[#eeeeee] flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-[#333333]">当前语音</h2>
          {session.current && <span className="text-[11px] text-[#777777]">{session.current.status === 'confirmed' ? '正在确认' : '实时修订中'}</span>}
        </div>
        {session.current ? (
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#eeeeee]">
            <div className="p-4 sm:p-5 min-h-[112px]">
              <p className="text-[11px] uppercase tracking-wide text-[#999999] mb-2">原文</p>
              <p className="text-[16px] leading-7 text-[#222222] whitespace-pre-wrap">{session.current.sourceText}</p>
            </div>
            <div className="p-4 sm:p-5 min-h-[112px] bg-[#fcfcfd]">
              <p className="text-[11px] uppercase tracking-wide text-[#999999] mb-2">译文</p>
              <p className="text-[16px] leading-7 text-[#222222] whitespace-pre-wrap">
                {session.current.translatedText || <span className="text-[#a0a0a0]">正在生成译文…</span>}
              </p>
            </div>
          </div>
        ) : (
          <div className="px-5 py-10 text-center text-[13px] text-[#999999]">开始说话后，原文和译文会显示在这里。</div>
        )}
      </div>

      {session.segments.length > 0 && (
        <div className="mt-4 border border-[#e4e6ea] rounded-lg bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-[#eeeeee]"><h2 className="text-[13px] font-semibold text-[#333333]">已确认字幕</h2></div>
          <ol className="divide-y divide-[#eeeeee] max-h-[48vh] overflow-y-auto">
            {session.segments.map((segment) => (
              <li key={segment.id} className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-6 px-4 py-3.5 sm:px-5">
                <p className="text-[14px] leading-6 text-[#555555]">{segment.sourceText}</p>
                <p className="text-[14px] leading-6 text-[#222222]">{segment.translatedText}</p>
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

function MicrophoneIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5a2.5 2.5 0 00-2.5 2.5v5a2.5 2.5 0 005 0V5A2.5 2.5 0 0010 2.5zM5 9.5a5 5 0 0010 0M10 14.5V18m-3 0h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
}
