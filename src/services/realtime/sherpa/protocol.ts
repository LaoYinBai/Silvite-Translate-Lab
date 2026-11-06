import type { ASRPreparation, StreamingTranscript } from '../providers';

export type SherpaCommand =
  | { type: 'prepare'; assetBase: string }
  | { type: 'start'; streamId: string }
  | { type: 'audio'; streamId: string; samples: Float32Array; startTime: number }
  | { type: 'finish'; streamId: string };

export type SherpaRequest = SherpaCommand & { id: number };
export type SherpaReply = { id: number } & (
  | { type: 'progress'; progress: ASRPreparation }
  | { type: 'ready' }
  | { type: 'started' | 'consumed' | 'finished'; streamId: string }
  | { type: 'transcript'; streamId: string; event: StreamingTranscript }
  | { type: 'error'; message: string; streamId?: string }
);
