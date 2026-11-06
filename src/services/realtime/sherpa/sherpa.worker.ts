import { loadASRAsset, type ASRManifest } from './assets';
import type { SherpaRequest, SherpaReply } from './protocol';

interface OnlineStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  inputFinished(): void;
  free(): void;
}
interface OnlineRecognizer {
  handle: number;
  createStream(): OnlineStream;
  isReady(stream: OnlineStream): boolean;
  isEndpoint(stream: OnlineStream): boolean;
  decode(stream: OnlineStream): void;
  reset(stream: OnlineStream): void;
  getResult(stream: OnlineStream): { text: string };
  free(): void;
}
interface RuntimeModule {
  FS_unlink?: (path: string) => void;
  HEAPU8?: Uint8Array;
  wasmBinary?: ArrayBuffer;
  [key: string]: unknown;
}

const host = globalThis as typeof globalThis & { __translateLabSherpaModule?: RuntimeModule };
let recognizer: OnlineRecognizer | null = null;
let stream: OnlineStream | null = null;
let activeStreamId = '';
let utterance = 0;
let revision = 0;
let lastText = '';
let segmentStart = 0;
let audioEnd = 0;
let started = false;
let activeRequestId = 0;
const send = (reply: SherpaReply) => self.postMessage(reply);

async function prepare(id: number, assetBase: string) {
  if (recognizer) { send({ id, type: 'ready' }); return; }
  const base = new URL(assetBase);
  if (base.origin !== self.location.origin) throw new Error('语音模型必须从本站加载。');
  const response = await fetch(new URL('manifest.json', base), { cache: 'no-cache', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('本站语音模型尚未准备好，请稍后重试。');
  const manifest = await response.json() as ASRManifest;
  let loaded = 0;
  const total = manifest.files.filter(file => file.file === 'model.data' || file.file.endsWith('.wasm')).reduce((sum, file) => sum + file.bytes, 0);
  const progress = (bytes: number) => {
    loaded += bytes;
    send({ id, type: 'progress', progress: { message: '正在准备中英流式语音模型', progress: Math.min(95, Math.round(loaded / total * 95)) } });
  };
  let modelData: ArrayBuffer | null = await loadASRAsset(base, manifest, 'model.data', progress);
  const wasm = await loadASRAsset(base, manifest, 'sherpa-onnx-wasm-main-asr.wasm', progress);
  send({ id, type: 'progress', progress: { message: '正在初始化本机流式识别', progress: 97 } });
  const api = await import(/* @vite-ignore */ new URL('sherpa-onnx-asr.js', base).href) as {
    createOnlineRecognizer(module: RuntimeModule, config: Record<string, unknown>): OnlineRecognizer;
  };
  let failRuntime: (error: Error) => void = () => {};
  const ready = new Promise<RuntimeModule>((resolve, reject) => {
    failRuntime = reject;
    host.__translateLabSherpaModule = {
      noInitialRun: true, wasmBinary: wasm,
      locateFile: (file: string) => new URL(file, base).href,
      getPreloadedPackage: () => modelData,
      print: () => {}, printErr: () => {},
      onAbort: () => reject(new Error('本机识别引擎无法初始化，请检查浏览器是否支持 WebAssembly SIMD。')),
      onRuntimeInitialized: () => resolve(host.__translateLabSherpaModule!),
    };
  });
  try { await import(/* @vite-ignore */ new URL('sherpa-onnx-wasm-main-asr.js', base).href); }
  catch { failRuntime(new Error('本机识别引擎加载失败。')); }
  const module = await ready;
  recognizer = api.createOnlineRecognizer(module, {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: './encoder.onnx', decoder: './decoder.onnx', joiner: './joiner.onnx' },
      tokens: './tokens.txt', numThreads: 1, provider: 'cpu', debug: 0, modelType: 'zipformer', modelingUnit: 'cjkchar', bpeVocab: '',
    },
    decodingMethod: 'greedy_search', maxActivePaths: 4, enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 0.65, rule3MinUtteranceLength: 20,
  });
  if (!recognizer.handle) { recognizer = null; throw new Error('中英语音模型未能初始化，请重新加载。'); }
  for (const file of ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt']) {
    try { module.FS_unlink?.(file); } catch { /* model is already held by the recognizer */ }
  }
  modelData = null;
  delete module.wasmBinary;
  send({ id, type: 'ready' });
}

function emit(final: boolean, latencyMs: number) {
  if (!stream || !recognizer) return;
  const text = recognizer.getResult(stream).text.trim();
  if (!final && (!text || text === lastText)) return;
  lastText = text;
  send({ id: activeRequestId, type: 'transcript', streamId: activeStreamId, event: {
    utteranceId: activeStreamId + '-' + utterance, revision: ++revision, text, final,
    startTime: segmentStart, endTime: audioEnd, latencyMs,
  } });
}

self.onmessage = async ({ data }: MessageEvent<SherpaRequest>) => {
  activeRequestId = data.id;
  try {
    if (data.type === 'prepare') { await prepare(data.id, data.assetBase); return; }
    if (!recognizer) throw new Error('流式识别引擎尚未就绪。');
    if (data.type === 'start') {
      stream?.free();
      stream = recognizer.createStream();
      activeStreamId = data.streamId;
      utterance = 0; revision = 0; lastText = ''; started = false;
      send({ id: data.id, type: 'started', streamId: data.streamId });
      return;
    }
    if (!stream || data.streamId !== activeStreamId) return;
    const before = performance.now();
    if (data.type === 'audio') {
      if (!started) { segmentStart = data.startTime; started = true; }
      audioEnd = data.startTime + data.samples.length / 16;
      stream.acceptWaveform(16000, data.samples);
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      const endpoint = recognizer.isEndpoint(stream);
      emit(endpoint, performance.now() - before);
      if (endpoint) {
        recognizer.reset(stream);
        utterance++; revision = 0; lastText = ''; segmentStart = audioEnd;
      }
      send({ id: data.id, type: 'consumed', streamId: data.streamId });
    } else {
      // End-of-input drains encoder lookahead, so stopping never throws away
      // the last word merely because no later audio frame arrived.
      if (started) {
        stream.acceptWaveform(16000, new Float32Array(16000));
        stream.inputFinished();
        while (recognizer.isReady(stream)) recognizer.decode(stream);
        emit(true, performance.now() - before);
      }
      stream.free(); stream = null;
      send({ id: data.id, type: 'finished', streamId: data.streamId });
    }
  } catch (error) {
    send({ id: data.id, type: 'error', streamId: 'streamId' in data ? data.streamId : undefined,
      message: error instanceof Error ? error.message : '本机流式识别失败，请重新开始。' });
  }
};
