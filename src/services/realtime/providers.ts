import {
  transcribeRealtimeAudio,
  translateRealtimeSegment,
  type RealtimeASRHandlers,
  type RealtimeASRResult,
  type RealtimeAudioRequest,
  type RealtimeTranslationRequest,
  type RealtimeTranslationResult,
} from '../../api/realtimeClient';
import type { RetryNotice } from './retry';

export interface ASRProvider {
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

export class XiaomiRealtimeTranslationProvider implements TranslationProvider {
  translate(request: RealtimeTranslationRequest, signal?: AbortSignal, onRetry?: (notice: RetryNotice) => void) {
    return translateRealtimeSegment(request, signal, onRetry);
  }
}
