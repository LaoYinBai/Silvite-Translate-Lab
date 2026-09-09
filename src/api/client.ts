export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export interface TranslationRequest {
  text?: string;
  imageDataUrl?: string;
  mode?: string;
  context?: string;
  terminology?: string;
  preserveNames?: boolean;
  explainTranslation?: boolean;
}

export interface TranslationResponse {
  source_language: string;
  target_language: string;
  detected_style?: 'natural' | 'literary' | 'academic' | 'business' | 'comic';
  translation: string;
  detected_text?: string | null;
  segments: Array<{
    type: string;
    source: string;
    translation: string;
  }>;
  notes: Array<{
    source: string;
    translation: string;
    reason: string;
  }>;
}

/**
 * All model calls go through the EdgeOne edge function at /api/translate.
 * The MiMo API key never reaches the frontend bundle.
 */
export async function translate(request: TranslationRequest): Promise<TranslationResponse> {
  const response = await fetch(`${API_BASE_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/translate`, { method: 'OPTIONS' });
    return response.ok;
  } catch {
    return false;
  }
}
