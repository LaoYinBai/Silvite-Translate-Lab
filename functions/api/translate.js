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

// Dedicated user instruction for comic images. Plain image requests keep the
// generic instruction below; comics get the visual-narrative framing.
const COMIC_IMAGE_INSTRUCTION = [
  '这是漫画视觉叙事理解任务，不是单纯 OCR。',
  '请先划分分镜，识别每个气泡及气泡尾巴所属角色，并结合人物位置、视线、表情和对话语义判断真实阅读顺序。',
  '排序证据优先级（从高到低）：明确的回应 / reply 语义关系 > 问句与回答关系 > 质疑与辩解关系 > 气泡尾巴与角色归属 > 画格视觉流 > 传统阅读方向（日漫右→左、上→下）。speaker 是否交替只是最低权重的参考，绝不能为了"轮流说话"强行改序。',
  '依赖句必须排在被依赖句之后：回应、确认、辩解类句子（如"是真的""不是啦""因为……"）在语义上依赖它所回应的问句或质疑句。例：「为什么迟到了？」是质疑，「因为堵车。」是回应，质疑在前。注意：质疑句本身也可能是在回应前一句的致歉、辩解或陈述——此时链式结构为"解释 → 质疑 → 回应"，质疑仍必须排在那句解释之后，回应再排在质疑之后。',
  '词语回声线索：回应句往往复现它所回应句子的关键词——「本当？」→「本当だって」、「真的吗？」→「是真的」、「为什么」→「因为」、「ほんと」→「本当」。当一句含问号或质疑语气，另一句是包含其关键词的陈述 / 确认句时，含问号的句子在前，回声句在后；不要把回声句排到问句前面。',
  '悬空检查：若排序结果以未获回应的问句 / 质疑句收尾，几乎总是排错了——真实对话里质疑会引出回应，而不是悬空结束。若对话以问句 / 质疑结尾，而某个陈述句在语义上正是对它的回应（尤其是它的词语回声句），必须把该回应移到质疑之后。',
  'reply_to 方向规则：含确认 / 回应关键词的陈述句（如「本当だって」「是真的」「真不是」）若与一个含问号 / 质疑语气的句子互为词语回声，则含问号的句子是被回应句——陈述句的 reply_to 必须指向那个质疑句，质疑句的 reply_to 指向更早的解释或陈述。示例：三个气泡——甲「对不起，被老师叫住了。」、甲「今天是真的。」、乙「真的吗？不会又是借口吧？」。错误：对不起 → 今天是真的 → 真的吗（按空间连读）。正确：对不起 → 真的吗 → 今天是真的（「今天是真的」回应「真的吗」，其 reply_to 指向「真的吗」）。',
  '同一说话人连续出现多个气泡时，不要自动改序，也不要为了"轮流说话"强行调整顺序。仅把这当作对话连贯性复核的信号：检查后一个同角色气泡是否在语义上回应了附近另一角色的问句、质疑、指责或提示；如果是，把那个气泡插到回应之前。若两句本身确实连续（连续解释、补充、独白），必须保持同一说话人连续。',
  '输出前最后一步：逐对检查所有问答 / 质疑-回应 / 解释-质疑-回应组合，若发现回应的 order 小于它所回应句的 order，交换后重新输出。',
  '为每个对白气泡分配唯一 id（如 bubble_1、bubble_2），并用 reply_to 指明它在语义上回应哪个气泡的 id：回应句、辩解句、对质疑的答复必须写 reply_to 指向它所回应的气泡。若你的 order 与 reply_to 冲突（回应排在了所回应句之前），程序会强制纠正，请尽量自行保持一致。',
  '每个漫画 segment 必须返回：panel、order、speaker、type、source、translation。',
  'speaker 不确定时返回 null，不得编造。',
  '背景文字、标牌、场景文字、旁白、拟声词不得混入 dialogue。',
  '不要只按 OCR 检测顺序返回 segments。不要输出推理过程，只返回最终结构化结果。',
].join('\n');

const GENERIC_IMAGE_INSTRUCTION =
  '翻译图片中的全部文字。请结合视觉上下文、画格、人物关系与阅读顺序判断语气，并按系统要求返回结构化结果。';

// Block labels used by buildComicTranslation (deterministic rendering).
const COMIC_BLOCK_LABELS = {
  dialogue: '对白',
  caption: '场景',
  narration: '旁白',
  background_text: '背景文字',
  sign: '标牌',
  title: '标题',
  sound_effect: '拟声词',
  ui_text: '界面文字',
  text: '文本',
};

function comicBlockLabel(segment) {
  if (segment.type === 'dialogue') {
    const speaker = typeof segment.speaker === 'string' ? segment.speaker.trim() : '';
    return speaker || '对白';
  }
  return COMIC_BLOCK_LABELS[segment.type] || '文本';
}

// Checks whether segments carry enough structure for deterministic rendering.
export function hasUsableComicSegments(segments) {
  return (
    Array.isArray(segments) &&
    segments.some((s) => s && typeof s.translation === 'string' && s.translation.trim())
  );
}

// Executes the model's EXPLICITLY declared reply dependencies. If segment A
// declares reply_to = B.id, then order(A) must be greater than order(B); a
// violation is fixed by deterministically swapping the two order values.
// This is structural validation of model output, not semantic guessing.
// Each unordered pair is enforced at most once. For mutual declarations
// (observed in practice) the two constraints are contradictory; the VIOLATED
// one is enforced because it is the declaration that fights the spatial
// order - the satisfied one merely mirrors it.
export function enforceReplyOrders(segments) {
  if (!Array.isArray(segments)) return segments;
  const byId = new Map(
    segments.filter((s) => s && typeof s.id === 'string').map((s) => [s.id, s])
  );

  const pairGroups = new Map();
  for (const seg of segments) {
    if (!seg || typeof seg.reply_to !== 'string') continue;
    const target = byId.get(seg.reply_to);
    if (!target || target === seg) continue;
    const pairKey = [seg.id, target.id].sort().join('|');
    if (!pairGroups.has(pairKey)) pairGroups.set(pairKey, []);
    pairGroups.get(pairKey).push({ writer: seg, target });
  }

  for (const constraints of pairGroups.values()) {
    const violated = constraints.find(
      ({ writer, target }) =>
        Number.isInteger(writer.order) && Number.isInteger(target.order) &&
        writer.order > 0 && target.order > 0 &&
        writer.order <= target.order
    );
    if (violated) {
      const { writer, target } = violated;
      const swap = writer.order;
      writer.order = target.order;
      target.order = swap;
    }
  }
  return segments;
}

// Deterministically rebuilds the comic main translation from structured
// segments. The multimodal model owns reading-order inference (order field);
// this code only executes that order - it never guesses order from
// coordinates, panel numbers or text content.
//
// Rules:
// - If every usable segment carries a valid order (integer >= 1), sort by
//   order ascending; otherwise keep the model's original array order.
// - Never group by speaker globally. Blocks follow real conversation turns;
//   only strictly adjacent dialogue segments with the same non-null speaker
//   (and consecutive order values when orders exist) merge into one block.
// - background_text / sign move after the main flow so environment text never
//   interrupts dialogue; caption / narration stay inline as narrative beats.
export function buildComicTranslation(segments) {
  const usable = (Array.isArray(segments) ? segments : []).filter(
    (s) => s && typeof s.translation === 'string' && s.translation.trim()
  );
  if (usable.length === 0) return '';

  const hasValidOrder = (s) => Number.isInteger(s.order) && s.order >= 1;
  const ordered = usable.every(hasValidOrder)
    ? [...usable].sort((a, b) => a.order - b.order)
    : usable;

  const isDialogue = (s) => s.type === 'dialogue';
  const sameSpeaker = (a, b) => {
    if (!isDialogue(a) || !isDialogue(b)) return false;
    const nameA = typeof a.speaker === 'string' ? a.speaker.trim() : '';
    const nameB = typeof b.speaker === 'string' ? b.speaker.trim() : '';
    return nameA !== '' && nameA === nameB;
  };

  const inline = [];
  const trailing = [];

  for (let i = 0; i < ordered.length; i++) {
    const seg = ordered[i];
    const label = comicBlockLabel(seg);

    if (seg.type === 'background_text' || seg.type === 'sign') {
      const prevTrailing = trailing[trailing.length - 1];
      if (prevTrailing && prevTrailing.label === label) {
        prevTrailing.lines.push(seg.translation.trim());
      } else {
        trailing.push({ label, lines: [seg.translation.trim()] });
      }
      continue;
    }

    const prevSeg = ordered[i - 1];
    const prevBlock = inline[inline.length - 1];
    // "对话顺序连续": both neighbours carry order and differ by exactly 1.
    const orderConsecutive =
      !hasValidOrder(seg) || !prevSeg || !hasValidOrder(prevSeg) || seg.order - prevSeg.order === 1;

    if (prevBlock && isDialogue(seg) && prevSeg && sameSpeaker(prevSeg, seg) && orderConsecutive) {
      prevBlock.lines.push(seg.translation.trim());
    } else {
      inline.push({ label, lines: [seg.translation.trim()] });
    }
  }

  return [...inline, ...trailing]
    .map((block) => `【${block.label}】\n${block.lines.join('\n')}`)
    .join('\n\n');
}
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

  // Models occasionally double-encode the whole payload as a string inside
  // the "translation" field. Unwrap it so structure survives.
  const unwrapDoubleEncoded = (obj) => {
    if (obj && typeof obj.translation === 'string') {
      const t = obj.translation.trim();
      if (t.startsWith('{') && t.includes('"segments"')) {
        try {
          const inner = JSON.parse(t);
          if (inner && typeof inner.translation === 'string') return inner;
        } catch {
          // keep outer object
        }
      }
    }
    return obj;
  };

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
    if (parsed) return unwrapDoubleEncoded(parsed);
    parsed = tryParse(repairQuotes(candidate));
    if (parsed) return unwrapDoubleEncoded(parsed);
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
            text: composition.mode === 'comic' ? COMIC_IMAGE_INSTRUCTION : GENERIC_IMAGE_INSTRUCTION,
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

    // Comic + image: rebuild the main translation deterministically from the
    // structured segments so the UI never depends on the model's free-text
    // translation layout. Fallback: keep the model's translation whenever
    // segments are missing or unusable - a structural failure must never
    // produce an empty result. One single MiMo request; no second model call.
    let translation = parsed.translation || '';
    if (composition.mode === 'comic' && imageDataUrl && hasUsableComicSegments(parsed.segments)) {
      // Execute the model's declared reply dependencies before ordering.
      enforceReplyOrders(parsed.segments);
      const built = buildComicTranslation(parsed.segments);
      if (built) translation = built;
    }

    return new Response(
      JSON.stringify({
        source_language: sourceLanguage,
        target_language: normalizeLang(parsed.target_language, routeTarget(sourceLanguage)),
        // For explicit modes the requested style IS the style; the model's own
        // classification is only meaningful for auto mode.
        detected_style: composition.mode !== 'auto' ? composition.mode : (parsed.detected_style || fallback.detectedStyle),
        translation,
        // detected_text is only meaningful for image mode; in text mode the
        // user's input IS the source, so any model-invented "source" is dropped.
        detected_text: imageDataUrl ? (parsed.detected_text || null) : null,
        // Segments pass through untouched so panel/order/speaker survive.
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
