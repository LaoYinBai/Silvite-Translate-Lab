import basePrompt from './base.md?raw';
import naturalPrompt from './natural.md?raw';
import literaryPrompt from './literary.md?raw';
import academicPrompt from './academic.md?raw';
import businessPrompt from './business.md?raw';
import comicPrompt from './comic.md?raw';

export type TranslationMode =
  | 'auto'
  | 'natural'
  | 'literary'
  | 'academic'
  | 'business'
  | 'comic';

const STYLE_PROMPTS: Record<
  Exclude<TranslationMode, 'auto'>,
  string
> = {
  natural: naturalPrompt,
  literary: literaryPrompt,
  academic: academicPrompt,
  business: businessPrompt,
  comic: comicPrompt,
};

const AUTO_MODE_INSTRUCTION = `
# 自动模式

请根据输入文本、语气、场景、用户 Context 与图片视觉上下文，
自动判断最合适的翻译策略。

判断内容更接近：
- natural
- literary
- academic
- business
- comic

并在内部采用对应翻译原则。

自动模式不等同于自然模式。

将判断结果写入 detected_style，
但不要在译文正文中解释分类过程。
`;

interface ComposeOptions {
  mode?: string;
  context?: string;
  terminology?: string;
  preserveNames?: boolean;
  explainTranslation?: boolean;
}

function normalizeMode(mode?: string): TranslationMode {
  if (
    mode === 'natural' ||
    mode === 'literary' ||
    mode === 'academic' ||
    mode === 'business' ||
    mode === 'comic'
  ) {
    return mode;
  }

  return 'auto';
}

export function composeTranslationPrompt(
  options: ComposeOptions
): string {
  const mode = normalizeMode(options.mode);

  const modePrompt =
    mode === 'auto'
      ? AUTO_MODE_INSTRUCTION
      : STYLE_PROMPTS[mode];

  const sections: string[] = [
    basePrompt.trim(),
    modePrompt.trim(),
  ];

  if (options.context?.trim()) {
    sections.push(
      `# 用户上下文（Context）\n${options.context.trim()}`
    );
  }

  if (options.terminology?.trim()) {
    sections.push(
      `# 用户术语（Terminology，最高优先级）\n${options.terminology.trim()}`
    );
  }

  if (options.preserveNames === true) {
    sections.push(
      '保留符合语境的专有名词、品牌名、人名、地名、代码和缩写。'
    );
  }

  if (options.explainTranslation === false) {
    sections.push(
      '除非存在关键且不直观的翻译决策，否则 notes 必须返回空数组。'
    );
  }

  if (options.explainTranslation === true) {
    sections.push(
      '对不直观但重要的翻译选择，在 notes 中给出简短说明。'
    );
  }

  return sections.join('\n\n---\n\n');
}
