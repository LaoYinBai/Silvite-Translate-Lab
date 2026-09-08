import type { VercelRequest, VercelResponse } from '@vercel/node';
import { composeTranslationPrompt } from './promptComposer.ts';

const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
// Prefer the MIMO_API_KEY environment variable; the hardcoded value is a demo
// fallback so the serverless function works even without env configuration.
const MIMO_API_KEY = process.env.MIMO_API_KEY || 'REDACTED_MIMO_API_KEY';
const SERVICE_ENABLED = process.env.SERVICE_ENABLED !== 'false';
const MAX_INPUT_LENGTH = parseInt(process.env.MAX_INPUT_LENGTH || '5000');

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '10');
const RATE_LIMIT_WINDOW = 60000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT) return false;

  record.count++;
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SERVICE_ENABLED) {
    return res.status(503).json({
      error: 'Silvite Translate Lab experimental service is currently offline.',
    });
  }

  const ip = (req.headers['x-forwarded-for'] as string) || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
  }

  if (!MIMO_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const {
      text,
      mode,
      context,
      terminology,
      preserveNames,
      explainTranslation,
      imageDataUrl,
    } = req.body;

    if (!text && !imageDataUrl) {
      return res.status(400).json({ error: 'Text or image is required' });
    }

    if (text && text.length > MAX_INPUT_LENGTH) {
      return res.status(400).json({ error: 'Input too long' });
    }

    const promptComposition = composeTranslationPrompt({
      mode,
      context,
      terminology,
      preserveNames,
      explainTranslation,
    });

    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: promptComposition.prompt },
    ];

    if (imageDataUrl) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageDataUrl },
          },
          {
            type: 'text',
            text: '翻译图片中的全部文字。请结合视觉上下文、画格、人物关系与阅读顺序判断语气，并按系统要求返回结构化结果。',
          },
        ],
      });
    } else {
      messages.push({ role: 'user', content: text });
    }

    const response = await fetch(MIMO_API_URL, {
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('MiMo API error:', errorText);
      return res.status(response.status).json({ error: 'Translation service error' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({ error: 'Empty response from translation service' });
    }

    let parsed: any;
    const tryParse = (raw: string): any => {
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    };

    parsed = tryParse(content);
    if (!parsed) {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) parsed = tryParse(jsonMatch[1].trim());
    }
    if (!parsed) {
      const objectMatch = content.match(/\{[\s\S]*\}/);
      if (objectMatch) parsed = tryParse(objectMatch[0]);
    }
    if (!parsed) {
      const isChinese = /[\u4e00-\u9fa5]/.test(text || '');
      parsed = {
        source_language: isChinese ? 'zh' : 'en',
        target_language: isChinese ? 'en' : 'zh',
        detected_style: promptComposition.mode,
        translation: content.trim(),
        segments: [],
        notes: [],
      };
    }

    const isChinese = /[\u4e00-\u9fa5]/.test(text || '');
    const fallbackSource = isChinese ? 'zh' : 'en';
    const fallbackTarget = isChinese ? 'en' : 'zh';
    const normalizeLang = (value: unknown, fallback: string): 'zh' | 'en' =>
      value === 'zh' || value === 'en' ? value : (fallback as 'zh' | 'en');

    const sourceLanguage = normalizeLang(parsed.source_language, fallbackSource);

    return res.status(200).json({
      source_language: sourceLanguage,
      target_language: normalizeLang(parsed.target_language, sourceLanguage === 'zh' ? 'en' : 'zh'),
      detected_style: parsed.detected_style || promptComposition.mode,
      translation: parsed.translation || '',
      detected_text: parsed.detected_text || null,
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    });
  } catch (error) {
    console.error('Translation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
