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

// Parses user terminology lines into structured hard constraints.
// Supported forms per line:
//   源 -> 目标        fixed translation
//   源 = 目标          fixed translation (also fullwidth ＝)
//   源 -> KEEP         preserve as-is (also "保持原样", "不翻译", "keep")
// Unparsable lines are passed through as free-form terminology notes.
export function buildTerminologySection(terminology) {
  if (typeof terminology !== 'string' || !terminology.trim()) return null;

  const keepList = [];
  const mappingList = [];
  const freeText = [];

  for (const rawLine of terminology.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/\s*(?:->|=>|→|=|＝)\s*/);
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      const source = parts[0].trim();
      const target = parts[1].trim();
      if (/^(keep|保持原样|保持原文|不翻译|保留原文)$/i.test(target)) {
        keepList.push(source);
      } else {
        mappingList.push({ source, target });
      }
    } else {
      freeText.push(line);
    }
  }

  if (keepList.length === 0 && mappingList.length === 0 && freeText.length === 0) {
    return null;
  }

  const lines = [
    '# 用户术语约束（Terminology，最高优先级硬约束）',
    '',
    '以下约束优先级最高，高于任何风格指令与专有名词处理设置，必须严格遵守：',
  ];

  if (mappingList.length > 0) {
    lines.push('', '固定译法（该词出现且确实指此事物时，必须使用指定译法）：');
    for (const { source, target } of mappingList) {
      lines.push(`- ${source} → ${target}`);
    }
  }

  if (keepList.length > 0) {
    lines.push('', '保持原文（不要翻译、不要音译、不要加注）：');
    for (const term of keepList) {
      lines.push(`- ${term}`);
    }
  }

  if (freeText.length > 0) {
    lines.push('', '其他术语说明：');
    for (const note of freeText) {
      lines.push(`- ${note}`);
    }
  }

  lines.push(
    '',
    '使用规则：',
    '- 只约束原文中真正对应的位置；结合 Context 与词义判断该处是否指术语所指事物。同形词表示其他含义时不得套用（例如术语含"苹果=Apple 公司"时，表示水果的"苹果"仍是 apple）。',
    '- 若术语约束与用户 Context 描述冲突：译名形式以术语为准，Context 继续提供其余语义信息。'
  );

  return lines.join('\n');
}

export function composeTranslationPrompt(options = {}) {
  const requestedMode = normalizeTranslationMode(options.mode);
  let effectiveMode = requestedMode;
  let modePrompt = AUTO_MODE_INSTRUCTION;

  if (requestedMode !== 'auto') {
    modePrompt = STYLE_PROMPTS[requestedMode];
  }

  // Order mirrors the declared priority: base rules → mode style →
  // terminology (hard constraints) → context → proper-name handling.
  const sections = [BASE_PROMPT, modePrompt];

  const terminologySection = buildTerminologySection(options.terminology);
  if (terminologySection) {
    sections.push(terminologySection);
  }

  if (typeof options.context === 'string' && options.context.trim()) {
    sections.push(
      `# 用户上下文（Context，仅用于消歧，不是待翻译正文）\n${options.context.trim()}`
    );
  }

  if (options.preserveNames === true) {
    sections.push(
      '# 专有名词处理（Preserve Proper Names：开启）\n' +
        '品牌名、产品名、人名、项目名、型号、缩写与已知商标：优先保留原文，或采用业界正式译名；不确定正式译名时保留原文，不要自行创造。此设置不影响 Terminology 约束（术语始终更优先）。'
    );
  } else if (options.preserveNames === false) {
    sections.push(
      '# 专有名词处理（Preserve Proper Names：关闭）\n' +
        '允许按目标语言习惯正常处理人名等内容，但品牌与产品名在没有可靠官方译名依据时仍不得随意意译，不确定时保留原文。Terminology 约束不受此设置影响，必须始终遵守。'
    );
  }

  if (options.explainTranslation === false) {
    sections.push('notes 尽量返回空数组，除非存在关键且不直观的翻译决策。');
  }
  // explainTranslation === true (or omitted): notes follow the normal rules
  // already stated in the base prompt; no extra instruction needed.

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

// Accepts any BCP-47-ish two-letter code (zh, en, ja, ko, fr, zh-CN, ...).
function normalizeLang(value, fallback) {
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (/^[a-z]{2}(-[a-z]{2})?$/.test(trimmed)) return trimmed;
  }
  return fallback;
}

// Local heuristic used only when the model fails to report a language.
function detectLanguage(text) {
  if (!text) return 'zh';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  return 'en';
}

// Fixed routing: Chinese -> English; every other language -> Chinese.
function routeTarget(source) {
  return source === 'zh' ? 'en' : 'zh';
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

    const fallbackSource = detectLanguage(text || '');
    const fallback = {
      sourceLanguage: fallbackSource,
      targetLanguage: routeTarget(fallbackSource),
      detectedStyle: composition.mode,
    };

    const parsed = parseModelContent(content, fallback);
    const sourceLanguage = normalizeLang(parsed.source_language, fallback.sourceLanguage);

    return new Response(
      JSON.stringify({
        source_language: sourceLanguage,
        target_language: normalizeLang(parsed.target_language, routeTarget(sourceLanguage)),
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
