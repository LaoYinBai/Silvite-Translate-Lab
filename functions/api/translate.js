import {
  BASE_PROMPT,
  NATURAL_PROMPT,
  LITERARY_PROMPT,
  ACADEMIC_PROMPT,
  BUSINESS_PROMPT,
  COMIC_PROMPT,
  AUTO_MODE_INSTRUCTION,
  SAFE_BASE_FALLBACK,
} from './prompts.mjs';

export const SUPPORTED_TRANSLATION_MODES = ['auto', 'natural', 'literary', 'academic', 'business', 'comic'];

const STYLE_PROMPTS = {
  natural: NATURAL_PROMPT,
  literary: LITERARY_PROMPT,
  academic: ACADEMIC_PROMPT,
  business: BUSINESS_PROMPT,
  comic: COMIC_PROMPT,
};

const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
// EdgeOne Pages edge runtime: V8 isolate, Web APIs only. The per-isolate Map
// gives per-instance rate limiting, sufficient for this short-lived demo.
const rateLimitMap = new Map();

export function normalizeTranslationMode(mode) {
  return typeof mode === 'string' && SUPPORTED_TRANSLATION_MODES.includes(mode) ? mode : 'auto';
}

export function composeTranslationPrompt(options = {}) {
  const requestedMode = normalizeTranslationMode(options.mode);
  let effectiveMode = requestedMode;
  let modePrompt = AUTO_MODE_INSTRUCTION;

  if (requestedMode !== 'auto') {
    modePrompt = STYLE_PROMPTS[requestedMode];
  }

  const sections = [BASE_PROMPT, modePrompt];

  if (typeof options.context === 'string' && options.context.trim()) {
    sections.push(`# 用户上下文（Context）\n${options.context.trim()}`);
  }

  if (typeof options.terminology === 'string' && options.terminology.trim()) {
    sections.push(`# 用户术语（Terminology，最高优先级）\n${options.terminology.trim()}`);
  }

  if (options.preserveNames === true) {
    sections.push('保留符合语境的专有名词、品牌名、人名、地名、代码和缩写。');
  }

  if (options.explainTranslation === false) {
    sections.push('除非存在关键且不直观的翻译决策，否则 notes 必须返回空数组。');
  } else if (options.explainTranslation === true) {
    sections.push('对不直观但重要的翻译选择，在 notes 中给出简短说明。');
  }

  return { prompt: sections.join('\n\n---\n\n'), mode: effectiveMode };
}

function checkRateLimit(ip, limit, windowMs) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (record.count >= limit) return false;

  record.count += 1;
  return true;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function parseModelContent(content, fallback) {
  const tryParse = (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };

  // Models occasionally emit unescaped straight quotes inside JSON string
  // values (e.g. 此处"银行"指河岸), which breaks JSON.parse. Walk the string
  // and escape quotes that are clearly not structural closers.
  const repairQuotes = (raw) => {
    let out = '';
    let inString = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (inString && ch === '\\') {
        out += ch + (raw[i + 1] || '');
        i++;
        continue;
      }
      if (ch === '"') {
        if (!inString) {
          inString = true;
          out += ch;
          continue;
        }
        let j = i + 1;
        while (j < raw.length && /\s/.test(raw[j])) j++;
        const next = raw[j];
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === undefined) {
          inString = false;
          out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
    }
    return out;
  };

  const candidates = [content];

  const fenceStart = content.indexOf('```');
  if (fenceStart !== -1) {
    const fenceEnd = content.lastIndexOf('```');
    if (fenceEnd > fenceStart) {
      candidates.push(content.slice(fenceStart + 3, fenceEnd).replace(/^json\s*/, '').trim());
    }
  }

  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    let parsed = tryParse(candidate);
    if (parsed) return parsed;
    parsed = tryParse(repairQuotes(candidate));
    if (parsed) return parsed;
  }

  return {
    source_language: fallback.sourceLanguage,
    target_language: fallback.targetLanguage,
    detected_style: fallback.detectedStyle,
    translation: content.trim(),
    segments: [],
    notes: [],
  };
}

function normalizeLang(value, fallback) {
  return value === 'zh' || value === 'en' ? value : fallback;
}

export async function onRequest(context) {
  const { request, env = {} } = context;
  const origin = env.ALLOWED_ORIGIN || request.headers.get('Origin') || '*';
  const headers = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  if (env.SERVICE_ENABLED === 'false') {
    return new Response(
      JSON.stringify({ error: 'Silvite Translate Lab experimental service is currently offline.' }),
      { status: 503, headers },
    );
  }

  const rateLimit = Number.parseInt(env.RATE_LIMIT || '10', 10);
  const rateLimitWindow = Number.parseInt(env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  const maxInputLength = Number.parseInt(env.MAX_INPUT_LENGTH || '5000', 10);
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('eo-geo') || 'unknown';
  if (!checkRateLimit(ip, rateLimit, rateLimitWindow)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
      status: 429,
      headers,
    });
  }

  // The MiMo key comes exclusively from the EdgeOne environment variable
  // MIMO_API_KEY; it never ships in source code or the frontend bundle.
  const apiKey = env.MIMO_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
  }

  const { text, mode, context: userContext, terminology, preserveNames, explainTranslation, imageDataUrl } = body || {};

  if (!text && !imageDataUrl) {
    return new Response(JSON.stringify({ error: 'Text or image is required' }), { status: 400, headers });
  }
  if (text && text.length > maxInputLength) {
    return new Response(JSON.stringify({ error: 'Input too long' }), { status: 400, headers });
  }

  try {
    const composition = composeTranslationPrompt({ mode, context: userContext, terminology, preserveNames, explainTranslation });

    const messages = [{ role: 'system', content: composition.prompt }];

    if (imageDataUrl) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          {
            type: 'text',
            text: '翻译图片中的全部文字。请结合视觉上下文、画格、人物关系与阅读顺序判断语气，并按系统要求返回结构化结果。',
          },
        ],
      });
    } else {
      messages.push({ role: 'user', content: text });
    }

    const mimoResponse = await fetch(MIMO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'mimo-v2.5',
        messages,
        max_completion_tokens: 4096,
        temperature: 0.3,
      }),
    });

    if (!mimoResponse.ok) {
      const errorText = await mimoResponse.text();
      console.error('MiMo API error:', errorText);
      return new Response(JSON.stringify({ error: 'Translation service error' }), { status: 502, headers });
    }

    const data = await mimoResponse.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return new Response(JSON.stringify({ error: 'Empty response from translation service' }), { status: 502, headers });
    }

    const isChinese = /[\u4e00-\u9fa5]/.test(text || '');
    const fallback = {
      sourceLanguage: isChinese ? 'zh' : 'en',
      targetLanguage: isChinese ? 'en' : 'zh',
      detectedStyle: composition.mode,
    };

    const parsed = parseModelContent(content, fallback);
    const sourceLanguage = normalizeLang(parsed.source_language, fallback.sourceLanguage);

    return new Response(
      JSON.stringify({
        source_language: sourceLanguage,
        target_language: normalizeLang(parsed.target_language, sourceLanguage === 'zh' ? 'en' : 'zh'),
        // For explicit modes the requested style IS the style; the model's own
        // classification is only meaningful for auto mode.
        detected_style: composition.mode !== 'auto' ? composition.mode : (parsed.detected_style || fallback.detectedStyle),
        translation: parsed.translation || '',
        // detected_text is only meaningful for image mode; in text mode the
        // user's input IS the source, so any model-invented "source" is dropped.
        detected_text: imageDataUrl ? (parsed.detected_text || null) : null,
        segments: Array.isArray(parsed.segments) ? parsed.segments : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      }),
      { status: 200, headers },
    );
  } catch (error) {
    console.error('Translation error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
}
