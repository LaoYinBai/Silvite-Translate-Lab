import { composeTranslationPrompt } from '../prompts/compose';

const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MIMO_API_KEY = import.meta.env.VITE_MIMO_API_KEY;

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
  source_language: 'zh' | 'en';
  target_language: 'en' | 'zh';
  detected_style?: 'natural' | 'literary' | 'academic' | 'business' | 'comic';
  translation: string;
  detected_text?: string;
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

function tryParseJson(raw: string): any | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseModelContent(raw: string): any {
  let parsed = tryParseJson(raw);

  if (parsed) return parsed;

  const fencedJson = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fencedJson) {
    parsed = tryParseJson(fencedJson[1].trim());
    if (parsed) return parsed;
  }

  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    parsed = tryParseJson(objectMatch[0]);
    if (parsed) return parsed;
  }

  return undefined;
}

function detectFallbackLanguage(text?: string): 'zh' | 'en' {
  if (!text) return 'zh';
  return /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'en';
}

export async function translate(
  request: TranslationRequest
): Promise<TranslationResponse> {
  if (!MIMO_API_KEY) {
    throw new Error('VITE_MIMO_API_KEY is not configured');
  }

  const systemPrompt = composeTranslationPrompt({
    mode: request.mode,
    context: request.context,
    terminology: request.terminology,
    preserveNames: request.preserveNames,
    explainTranslation: request.explainTranslation,
  });

  const messages: Array<Record<string, unknown>> = [
    {
      role: 'system',
      content: systemPrompt,
    },
  ];

  if (request.imageDataUrl) {
    messages.push({
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: request.imageDataUrl,
          },
        },
        {
          type: 'text',
          text:
            request.text?.trim() ||
            '翻译图片中的全部文字。请结合视觉上下文、人物关系、画格、气泡、拟声词与阅读顺序理解内容，并按照系统要求返回结构化 JSON。',
        },
      ],
    });
  } else {
    messages.push({
      role: 'user',
      content: request.text || '',
    });
  }

  let response: Response;

  try {
    response = await fetch(MIMO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MIMO_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'mimo-v2.5',
        messages,
        max_completion_tokens: 4096,
        temperature: 0.3,
      }),
    });
  } catch (error) {
    console.error('[MiMo] Network / CORS error:', error);
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');

    console.error(`[MiMo] HTTP ${response.status}`, errorText);

    throw new Error(`MiMo API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || !content.trim()) {
    console.error('[MiMo] Unexpected response:', data);
    throw new Error('MiMo returned an empty response');
  }

  const parsed = parseModelContent(content);

  const fallbackSource = detectFallbackLanguage(request.text);
  const fallbackTarget = fallbackSource === 'zh' ? 'en' : 'zh';

  if (!parsed) {
    return {
      source_language: fallbackSource,
      target_language: fallbackTarget,
      translation: content.trim(),
      segments: [],
      notes: [],
    };
  }

  const sourceLanguage =
    parsed.source_language === 'zh' || parsed.source_language === 'en'
      ? parsed.source_language
      : fallbackSource;

  const targetLanguage =
    parsed.target_language === 'zh' || parsed.target_language === 'en'
      ? parsed.target_language
      : sourceLanguage === 'zh'
        ? 'en'
        : 'zh';

  return {
    source_language: sourceLanguage,
    target_language: targetLanguage,
    detected_style: parsed.detected_style,
    translation:
      typeof parsed.translation === 'string'
        ? parsed.translation
        : content.trim(),
    detected_text:
      typeof parsed.detected_text === 'string'
        ? parsed.detected_text
        : undefined,
    segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
  };
}

export async function checkHealth(): Promise<boolean> {
  return Boolean(MIMO_API_KEY);
}
