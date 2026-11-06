import type { ASRPreparation } from './providers';
import type { RealtimeSourceLanguage } from './config';

export type WhisperCommand =
  | { type: 'prepare'; assetBase: string; device: 'auto' | 'wasm' }
  | { type: 'transcribe'; samples: Float32Array; language: RealtimeSourceLanguage };

export type WhisperWorkerRequest = WhisperCommand & { id: number };
export type WhisperWorkerReply = { id: number } & (
  | { type: 'progress'; progress: ASRPreparation }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'result'; text: string; device: 'webgpu' | 'wasm' }
  | { type: 'error'; message: string }
);
