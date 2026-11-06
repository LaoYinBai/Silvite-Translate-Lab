import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { WhisperWorkerReply, WhisperWorkerRequest } from './whisperProtocol';
import { createWhisperModelCache, type WhisperManifest } from './whisperAssets';

let recognizer: AutomaticSpeechRecognitionPipeline | null = null;
let device: 'webgpu' | 'wasm' = 'wasm';

const send = (reply: WhisperWorkerReply) => self.postMessage(reply);

async function load(id: number, selectedDevice: 'webgpu' | 'wasm') {
  return pipeline('automatic-speech-recognition', 'whisper-tiny', {
    device: selectedDevice,
    // Q8 decoders on this WebGPU runtime can silently produce gibberish.
    // Keep the encoder in fp32 on GPU; CPU uses the smaller Q8 pair.
    dtype: selectedDevice === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    local_files_only: true,
    progress_callback: (progress) => {
      if (progress.status === 'progress') send({ id, type: 'progress', progress: {
        message: '正在加载本机语音模型', progress: Math.round(progress.progress),
      } });
    },
  });
}

async function prepare(request: Extract<WhisperWorkerRequest, { type: 'prepare' }>) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${request.assetBase}models/`;
  const assetBase = new URL(request.assetBase, self.location.href).href;
  const manifestResponse = await fetch(`${assetBase}manifest.json`);
  if (!manifestResponse.ok) throw new Error('语音模型清单加载失败。');
  const manifest: WhisperManifest = await manifestResponse.json();
  env.useCustomCache = true;
  env.customCache = createWhisperModelCache(assetBase, manifest);
  env.useBrowserCache = false;
  env.backends.onnx.wasm!.wasmPaths = `${request.assetBase}runtime/`;
  // A static host need not opt into cross-origin isolation to run CPU inference.
  env.backends.onnx.wasm!.numThreads = 1;
  env.backends.onnx.wasm!.proxy = false;
  send({ id: request.id, type: 'progress', progress: { message: '正在准备本机语音模型和运行组件，首次加载较慢' } });
  const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const hasGPU = request.device !== 'wasm' && await gpu?.requestAdapter().catch(() => null);
  if (hasGPU) {
    try { recognizer = await load(request.id, 'webgpu'); device = 'webgpu'; }
    catch { send({ id: request.id, type: 'progress', progress: { message: 'GPU 暂不可用，正在切换本机 CPU' } }); }
  }
  if (!recognizer) { recognizer = await load(request.id, 'wasm'); device = 'wasm'; }
  send({ id: request.id, type: 'ready', device });
}

async function transcribe(request: Extract<WhisperWorkerRequest, { type: 'transcribe' }>) {
  if (!recognizer) throw new Error('请先加载本机语音模型。');
  const options = {
    task: 'transcribe' as const,
    ...(request.language === 'auto' ? {} : { language: request.language === 'zh' ? 'chinese' : 'english' }),
    max_new_tokens: 128,
    return_timestamps: false as const,
  };
  let result;
  try { result = await recognizer(request.samples, options); }
  catch (error) {
    if (device !== 'webgpu') throw error;
    send({ id: request.id, type: 'progress', progress: { message: 'GPU 识别未完成，正在切换本机 CPU' } });
    await recognizer.dispose();
    recognizer = await load(request.id, 'wasm');
    device = 'wasm';
    result = await recognizer(request.samples, options);
  }
  const output = Array.isArray(result) ? result[0] : result;
  send({ id: request.id, type: 'result', text: output.text.trim(), device });
}

self.addEventListener('message', (event: MessageEvent<WhisperWorkerRequest>) => {
  const request = event.data;
  void (request.type === 'prepare' ? prepare(request) : transcribe(request)).catch((error: unknown) => {
    console.error('Whisper inference failed:', error);
    send({ id: request.id, type: 'error', message: request.type === 'prepare'
      ? '本机语音模型加载失败。请检查网络及本站模型资源是否完整，然后重试。'
      : '本机语音识别失败。请尝试重新开始，或切换识别引擎。' });
  });
});
