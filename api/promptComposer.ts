import { readFileSync } from 'node:fs';

export const SUPPORTED_TRANSLATION_MODES = [
  'auto',
  'natural',
  'literary',
  'academic',
  'business',
  'comic',
] as const;

export type TranslationMode = (typeof SUPPORTED_TRANSLATION_MODES)[number];

const STYLE_PROMPT_FILES: Record<Exclude<TranslationMode, 'auto'>, string> = {
  natural: 'natural.md',
  literary: 'literary.md',
  academic: 'academic.md',
  business: 'business.md',
  comic: 'comic.md',
};

const PROMPT_URLS: Record<string, URL> = {
  'base.md': new URL('./prompts/base.md', import.meta.url),
  'natural.md': new URL('./prompts/natural.md', import.meta.url),
  'literary.md': new URL('./prompts/literary.md', import.meta.url),
  'academic.md': new URL('./prompts/academic.md', import.meta.url),
  'business.md': new URL('./prompts/business.md', import.meta.url),
  'comic.md': new URL('./prompts/comic.md', import.meta.url),
};

const SAFE_BASE_FALLBACK = `你是面向专业译者和翻译学习者的中英 AI 翻译辅助系统。自动判断中英文并翻译为另一种语言，保持原意和语境，优先遵守用户的 Context 与 Terminology。仅返回符合当前接口结构的合法 JSON。`;

const AUTO_MODE_INSTRUCTION = `# 自动模式

请根据输入文本、语气、场景、用户 Context 与图片视觉上下文，自动判断最合适的翻译策略。判断内容更接近 natural、literary、academic、business 或 comic，并在内部采用对应原则；自动模式不等同于自然模式。将判断结果写入 detected_style，但不要在译文正文中解释分类过程。`;

export interface PromptCompositionOptions {
  mode?: unknown;
  context?: string;
  terminology?: string;
  preserveNames?: boolean;
  explainTranslation?: boolean;
}

interface PromptComposerDependencies {
  readPrompt?: (fileName: string) => string;
  onError?: (message: string, error: unknown) => void;
}

export interface ComposedPrompt {
  prompt: string;
  mode: TranslationMode;
  usedFallback: boolean;
}

function defaultReadPrompt(fileName: string): string {
  const promptUrl = PROMPT_URLS[fileName];
  if (!promptUrl) throw new Error(`Unknown prompt file: ${fileName}`);
  return readFileSync(promptUrl, 'utf8').trim();
}

export function normalizeTranslationMode(mode: unknown): TranslationMode {
  return typeof mode === 'string' && SUPPORTED_TRANSLATION_MODES.includes(mode as TranslationMode)
    ? mode as TranslationMode
    : 'auto';
}

export function composeTranslationPrompt(
  options: PromptCompositionOptions,
  dependencies: PromptComposerDependencies = {},
): ComposedPrompt {
  const readPrompt = dependencies.readPrompt ?? defaultReadPrompt;
  const onError = dependencies.onError ?? ((message, error) => console.error(message, error));
  let usedFallback = false;
  let basePrompt: string;

  try {
    basePrompt = readPrompt('base.md');
  } catch (error) {
    usedFallback = true;
    onError('[prompt] Failed to read base.md; using safe built-in base prompt.', error);
    basePrompt = SAFE_BASE_FALLBACK;
  }

  const requestedMode = normalizeTranslationMode(options.mode);
  let effectiveMode = requestedMode;
  let modePrompt = AUTO_MODE_INSTRUCTION;

  if (requestedMode !== 'auto') {
    const fileName = STYLE_PROMPT_FILES[requestedMode];
    try {
      modePrompt = readPrompt(fileName);
    } catch (error) {
      usedFallback = true;
      effectiveMode = 'auto';
      modePrompt = AUTO_MODE_INSTRUCTION;
      onError(`[prompt] Failed to read ${fileName}; falling back to auto mode.`, error);
    }
  }

  const sections = [basePrompt, modePrompt];

  if (options.context?.trim()) {
    sections.push(`# 用户上下文（Context）\n${options.context.trim()}`);
  }

  if (options.terminology?.trim()) {
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

  return {
    prompt: sections.join('\n\n---\n\n'),
    mode: effectiveMode,
    usedFallback,
  };
}
