import { REALTIME_CONFIG } from './config';

export type AudioChunkReason = 'window' | 'silence' | 'stop';

export interface RealtimeAudioChunk {
  samples: Float32Array;
  startTime: number;
  endTime: number;
  durationMs: number;
  reason: AudioChunkReason;
}

export function resampleToMono16k(input: Float32Array, sourceRate: number, targetRate = REALTIME_CONFIG.sampleRate): Float32Array {
  if (sourceRate <= 0 || targetRate <= 0) throw new Error('采样率无效');
  if (sourceRate === targetRate) return input.slice();
  const length = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(length);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const amount = position - left;
    output[index] = (input[left] || 0) * (1 - amount) + (input[right] || 0) * amount;
  }
  return output;
}

export function encodePcm16Wav(samples: Float32Array, sampleRate = REALTIME_CONFIG.sampleRate): Blob {
  if (sampleRate !== 16_000) throw new Error('实时语音仅支持 16 kHz 音频');
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function encodeWavDataUrl(samples: Float32Array): Promise<string> {
  return encodePcm16Wav(samples).arrayBuffer().then((buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    return `data:audio/wav;base64,${btoa(binary)}`;
  });
}

export function rmsForSamples(samples: Float32Array): number {
  if (!samples.length) return 0;
  let squares = 0;
  for (const sample of samples) squares += sample * sample;
  return Math.sqrt(squares / samples.length);
}

export interface AudioChunkerOptions { chunkMs?: number; overlapMs?: number; silenceCommitMs?: number }

export class RealtimeAudioChunker {
  private pending: Float32Array<ArrayBufferLike> = new Float32Array();
  private pendingStart = 0;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private voicedSamples = 0;
  private silenceSamples = 0;
  private active = false;
  private lastTimestamp = 0;
  private readonly windowSamples: number;
  private readonly overlapSamples: number;
  private readonly silenceLimit: number;
  private readonly minSpeech = Math.round(REALTIME_CONFIG.sampleRate * REALTIME_CONFIG.minimumSpeechMs / 1000);
  private readonly preRollLimit = Math.round(REALTIME_CONFIG.sampleRate * REALTIME_CONFIG.preRollMs / 1000);

  constructor(options: AudioChunkerOptions = {}) {
    const config = { ...REALTIME_CONFIG, ...options };
    this.windowSamples = Math.round(config.sampleRate * config.chunkMs / 1000);
    this.overlapSamples = Math.round(config.sampleRate * config.overlapMs / 1000);
    this.silenceLimit = Math.round(config.sampleRate * config.silenceCommitMs / 1000);
    if (this.windowSamples <= this.overlapSamples || this.overlapSamples < 0) throw new Error('音频分段设置无效');
  }

  push(samples: Float32Array, startTime = this.lastTimestamp): RealtimeAudioChunk[] {
    if (!samples.length) return [];
    this.lastTimestamp = startTime + samples.length / REALTIME_CONFIG.sampleRate * 1000;
    const voiced = rmsForSamples(samples) >= REALTIME_CONFIG.vadRmsThreshold;
    if (!this.active && !voiced) {
      this.rememberPreRoll(samples);
      return [];
    }
    if (!this.active) {
      this.active = true;
      this.pendingStart = Math.max(0, startTime - this.preRollSamples / REALTIME_CONFIG.sampleRate * 1000);
      this.pending = this.join([...this.preRoll, samples]);
      this.preRoll = [];
      this.preRollSamples = 0;
      this.voicedSamples = samples.length;
      this.silenceSamples = 0;
    } else {
      this.pending = this.join([this.pending, samples]);
      if (voiced) {
        this.voicedSamples += samples.length;
        this.silenceSamples = 0;
      } else this.silenceSamples += samples.length;
    }

    const emitted: RealtimeAudioChunk[] = [];
    while (this.pending.length >= this.windowSamples) {
      // take() consumes pending, so preserve overlap plus tail before calling it.
      const retained = this.pending.slice(this.windowSamples - this.overlapSamples);
      const chunk = this.take(this.windowSamples, 'window');
      emitted.push(chunk);
      this.pendingStart = chunk.startTime + (this.windowSamples - this.overlapSamples) / REALTIME_CONFIG.sampleRate * 1000;
      this.pending = retained;
    }
    if (this.silenceSamples >= this.silenceLimit) {
      if (this.voicedSamples >= this.minSpeech && this.pending.length) emitted.push(this.take(this.pending.length, 'silence'));
      this.resetSpeech();
    }
    return emitted;
  }

  flush(): RealtimeAudioChunk[] {
    if (!this.active || this.voicedSamples < this.minSpeech || !this.pending.length) {
      this.resetSpeech();
      return [];
    }
    const chunk = this.take(this.pending.length, 'stop');
    this.resetSpeech();
    return [chunk];
  }

  private rememberPreRoll(samples: Float32Array) {
    const copy = samples.slice();
    this.preRoll.push(copy);
    this.preRollSamples += copy.length;
    while (this.preRollSamples > this.preRollLimit && this.preRoll.length) {
      const first = this.preRoll[0];
      const excess = this.preRollSamples - this.preRollLimit;
      if (first.length <= excess) {
        this.preRoll.shift();
        this.preRollSamples -= first.length;
      } else {
        this.preRoll[0] = first.slice(excess);
        this.preRollSamples -= excess;
      }
    }
  }

  private take(count: number, reason: AudioChunkReason): RealtimeAudioChunk {
    const samples = this.pending.slice(0, count);
    const startTime = this.pendingStart;
    const durationMs = samples.length / REALTIME_CONFIG.sampleRate * 1000;
    this.pending = this.pending.slice(count);
    this.pendingStart += durationMs;
    return { samples, startTime, endTime: startTime + durationMs, durationMs, reason };
  }

  private join(parts: Float32Array[]): Float32Array {
    const result = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  }

  private resetSpeech() {
    this.pending = new Float32Array();
    this.preRoll = [];
    this.preRollSamples = 0;
    this.pendingStart = this.lastTimestamp;
    this.voicedSamples = 0;
    this.silenceSamples = 0;
    this.active = false;
  }
}

export interface AudioCapture {
  prepare?(): Promise<void>;
  start(onSamples: (samples: Float32Array, sampleRate: number, startTime: number) => void): Promise<void>;
  setPaused(paused: boolean): void;
  flush?(): Promise<void>;
  stop(flush?: boolean): Promise<void>;
}

export class BrowserMicrophoneCapture implements AudioCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private muted: GainNode | null = null;
  private callback: ((samples: Float32Array, sampleRate: number, startTime: number) => void) | null = null;
  private captureEpoch = 0;
  private paused = false;

  // Unlock Web Audio in the original tap/click, before a model download can
  // consume Safari's user activation. This does not open the microphone.
  async prepare() {
    if (!navigator.mediaDevices?.getUserMedia || !('AudioWorkletNode' in window)) {
      throw new Error('当前页面无法采集麦克风，请使用 HTTPS 页面和新版浏览器。');
    }
    if (!this.context) {
      try { this.context = new AudioContext({ sampleRate: REALTIME_CONFIG.sampleRate }); }
      catch { this.context = new AudioContext(); }
    }
    await this.context.resume();
  }

  async start(onSamples: (samples: Float32Array, sampleRate: number, startTime: number) => void) {
    if (!this.context) await this.prepare();
    const context = this.context;
    if (!context) throw new Error('无法启动音频采集。');
    this.callback = onSamples;
    this.paused = false;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.captureEpoch = performance.now() - context.currentTime * 1000;
    await context.audioWorklet.addModule('/audio-capture-processor.js');
    this.source = context.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(context, 'silvite-audio-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.muted = context.createGain();
    this.muted.gain.value = 0;
    this.worklet.port.onmessage = ({ data }) => {
      if (data?.type === 'samples' && data.samples instanceof Float32Array) {
        const workletStart = Number(data.startTime);
        this.callback?.(data.samples, Number(data.sampleRate) || this.context?.sampleRate || REALTIME_CONFIG.sampleRate,
          Number.isFinite(workletStart) ? this.captureEpoch + workletStart : performance.now());
      }
    };
    this.source.connect(this.worklet);
    this.worklet.connect(this.muted);
    this.muted.connect(context.destination);
    await context.resume();
  }

  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (this.stream) for (const track of this.stream.getAudioTracks()) track.enabled = !paused;
    this.worklet?.port.postMessage({ type: 'pause', paused });
  }

  async flush() {
    const context = this.context;
    const worklet = this.worklet;
    if (context?.state === 'running' && worklet) {
      await new Promise<void>((resolve) => {
        const previous = worklet.port.onmessage;
        const finish = () => { window.clearTimeout(timer); worklet.port.onmessage = previous; resolve(); };
        const timer = window.setTimeout(finish, 250);
        worklet.port.onmessage = (event) => {
          previous?.call(worklet.port, event);
          if (event.data?.type === 'flush-complete') finish();
        };
        worklet.port.postMessage({ type: 'flush' });
      });
    }
  }

  async stop(flush = true) {
    const context = this.context;
    if (flush) await this.flush();
    this.callback = null;
    this.source?.disconnect(); this.worklet?.disconnect(); this.muted?.disconnect();
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null; this.source = null; this.worklet = null; this.muted = null;
    this.context = null;
    this.paused = false;
    await context?.close().catch(() => undefined);
  }
}
