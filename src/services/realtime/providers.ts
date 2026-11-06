import {
  transcribeRealtimeAudio,
  translateRealtimeSegment,
  type RealtimeASRHandlers,
  type RealtimeASRResult,
  type RealtimeAudioRequest,
  type RealtimeTranslationRequest,
  type RealtimeTranslationResult,
  type RealtimeTranslationHandlers,
} from '../../api/realtimeClient';
import type { RetryNotice } from './retry';
import type { AudioChunkerOptions } from './audio';

export interface ASRPreparation { message: string; progress?: number }

export interface StreamingTranscript {
  utteranceId: string;
  revision: number;
  text: string;
  final: boolean;
  startTime: number;
  endTime: number;
  latencyMs: number;
}

export interface StreamingASRHandlers {
  onTranscript: (event: StreamingTranscript) => void;
  onPending: (bufferedMs: number) => void;
  onError: (error: Error) => void;
}

// A future Android bridge can implement this same text-event contract. Browser
// capture and decoding stay separate from subtitle/translation scheduling.
export interface ASRAudioStream {
  push(samples: Float32Array, startTime: number): void;
  finish(): Promise<void>;
  dispose(): void;
}

export interface ASRProvider {
  readonly execution?: 'local' | 'remote';
  readonly chunkOptions?: AudioChunkerOptions;
  prepare?(onProgress: (progress: ASRPreparation) => void, signal?: AbortSignal): Promise<void>;
  dispose?(): void;
  openStream?(handlers: StreamingASRHandlers, signal: AbortSignal): Promise<ASRAudioStream>;
  transcribe?(
    request: RealtimeAudioRequest,
    handlers: RealtimeASRHandlers,
    signal?: AbortSignal,
  ): Promise<RealtimeASRResult>;
}

export interface TranslationProvider {
  translate(
    request: RealtimeTranslationRequest,
    signal?: AbortSignal,
    onRetry?: (notice: RetryNotice) => void,
    handlers?: RealtimeTranslationHandlers,
  ): Promise<RealtimeTranslationResult>;
}

export interface TTSProvider {
  speak(text: string, language: 'zh' | 'en', signal?: AbortSignal): Promise<void>;
  stop(): void;
}

export class XiaomiRealtimeASRProvider implements ASRProvider {
  transcribe(request: RealtimeAudioRequest, handlers: RealtimeASRHandlers, signal?: AbortSignal) {
    return transcribeRealtimeAudio(request, handlers, signal);
  }
}

export class ServerRealtimeTranslationProvider implements TranslationProvider {
  translate(request: RealtimeTranslationRequest, signal?: AbortSignal, onRetry?: (notice: RetryNotice) => void, handlers?: RealtimeTranslationHandlers) {
    return translateRealtimeSegment(request, signal, onRetry, handlers);
  }
}
