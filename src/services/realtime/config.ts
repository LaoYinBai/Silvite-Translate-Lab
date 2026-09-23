export const REALTIME_CONFIG = Object.freeze({
  sampleRate: 16_000,
  chunkMs: 2_200,
  overlapMs: 350,
  silenceCommitMs: 520,
  minimumSpeechMs: 360,
  preRollMs: 160,
  vadRmsThreshold: 0.012,
  maxQueuedAudioChunks: 3,
  resumeQueueDepth: 1,
  provisionalTranslationIntervalMs: 1_050,
  minimumTranslationCharacters: 3,
  recentContextSegments: 8,
  maxRetries: 2,
  retryBaseDelayMs: 350,
  retryMaxDelayMs: 2_400,
  retryJitterRatio: 0.25,
});

export type RealtimeSourceLanguage = 'auto' | 'zh' | 'en';
export type RealtimeTargetLanguage = 'auto' | 'zh' | 'en';
