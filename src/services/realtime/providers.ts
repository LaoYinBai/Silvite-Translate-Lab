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

export interface ASRProvider {
  readonly execution?: 'local' | 'remote';
  readonly chunkOptions?: AudioChunkerOptions;
  prepare?(onProgress: (progress: ASRPreparation) => void, signal?: AbortSignal): Promise<void>;
  dispose?(): void;
  transcribe(
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
