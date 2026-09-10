# Silvite Translate Lab — 开发文档

> Experimental AI-assisted translation tool for Chinese-English translation scenarios.

---

## 一、技术架构确认

### 1.1 MiMo V2.5 API 真实信息（已验证）

| 项目 | 值 |
|------|-----|
| **官方 Base URL** | `https://api.xiaomimimo.com/v1` |
| **模型名称** | `mimo-v2.5` |
| **API 兼容性** | OpenAI Chat Completions 格式 |
| **图片输入方式** | `image_url` (URL) 或 `data:{MIME_TYPE};base64,{BASE64}` |
| **支持图片格式** | JPEG, PNG, GIF, WebP, BMP |
| **单图大小限制** | 50MB |
| **多图支持** | 支持同时传入多张图片 |
| **认证方式** | `Authorization: Bearer {API_KEY}` |

### 1.2 API 请求格式（文本）

```json
{
  "model": "mimo-v2.5",
  "messages": [
    {
      "role": "system",
      "content": "系统提示词..."
    },
    {
      "role": "user",
      "content": "用户输入的文本..."
    }
  ],
  "max_completion_tokens": 4096,
  "temperature": 0.3
}
```

### 1.3 API 请求格式（图片 - Base64）

```json
{
  "model": "mimo-v2.5",
  "messages": [
    {
      "role": "system",
      "content": "系统提示词..."
    },
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,iVBORw0KGgo..."
          }
        },
        {
          "type": "text",
          "text": "请翻译图片中的文字..."
        }
      ]
    }
  ],
  "max_completion_tokens": 4096
}
```

---

## 二、项目目录结构

```
silvite-translate-lab/
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Pages 自动部署
├── api/                            # Serverless 函数目录（Vercel/Cloudflare）
│   ├── translate.ts                # 翻译接口
│   └── health.ts                   # 健康检查接口
├── public/
│   ├── favicon.ico
│   └── demo/                       # Demo 样本
│       ├── demo-text-zh.json
│       ├── demo-text-en.json
│       └── demo-comic.json
├── src/
│   ├── main.tsx                    # 入口
│   ├── App.tsx                     # 根组件
│   ├── vite-env.d.ts
│   ├── index.css                   # 全局样式（引用 tokens.css）
│   ├── api/
│   │   ├── client.ts               # API 请求封装
│   │   └── types.ts                # API 类型定义
│   ├── components/
│   │   ├── Layout/
│   │   │   ├── Header.tsx          # 顶部导航
│   │   │   └── MainLayout.tsx      # 主布局
│   │   ├── SourcePanel/
│   │   │   ├── SourcePanel.tsx     # 左侧源文本面板
│   │   │   ├── TextInput.tsx       # 文本输入区
│   │   │   └── ImageUpload.tsx     # 图片上传区
│   │   ├── TranslationPanel/
│   │   │   ├── TranslationPanel.tsx # 右侧翻译结果面板
│   │   │   ├── TranslationResult.tsx
│   │   │   └── TranslationNotes.tsx
│   │   ├── Toolbar/
│   │   │   ├── Toolbar.tsx         # 顶部工具栏
│   │   │   ├── LanguageDetector.tsx # 语言识别显示
│   │   │   ├── ModeSelector.tsx    # 翻译模式选择
│   │   │   └── AdvancedPanel.tsx   # 高级选项面板
│   │   ├── Demo/
│   │   │   └── DemoLoader.tsx      # Demo 样本加载器
│   │   └── UI/
│   │       ├── Button.tsx
│   │       ├── Select.tsx
│   │       ├── Toggle.tsx
│   │       ├── Textarea.tsx
│   │       ├── Badge.tsx
│   │       ├── Tooltip.tsx
│   │       └── Spinner.tsx
│   ├── hooks/
│   │   ├── useTranslation.ts       # 翻译逻辑 hook
│   │   ├── useImageUpload.ts       # 图片上传 hook
│   │   └── useClipboard.ts         # 剪贴板 hook
│   ├── store/
│   │   └── translationStore.ts     # 状态管理（Zustand）
│   ├── prompts/
│   │   ├── system.ts               # 系统 prompt 定义
│   │   └── modes.ts                # 各翻译模式 prompt
│   ├── utils/
│   │   ├── language.ts             # 语言检测工具
│   │   ├── image.ts                # 图片处理工具
│   │   ├── json-parser.ts          # JSON 健壮解析
│   │   └── copy.ts                 # 复制到剪贴板
│   └── demo/
│       └── samples.ts              # 内置 Demo 数据
├── tokens.css                      # 设计系统 CSS 变量
├── DESIGN.md                       # 设计系统文档
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.ts              # Tailwind 配置（引用 tokens.css）
├── postcss.config.js
├── .env.example                    # 环境变量示例
├── .gitignore
└── README.md
```

---

## 三、技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| **前端框架** | React 18 + TypeScript | UI 构建 |
| **构建工具** | Vite | 开发/打包 |
| **样式方案** | Tailwind CSS + tokens.css | 设计系统 |
| **状态管理** | Zustand | 轻量状态 |
| **部署** | GitHub Pages | 静态前端 |
| **Serverless** | Vercel Functions 或 Cloudflare Workers | API 代理 |
| **模型** | MiMo V2.5 | 翻译引擎 |

---

## 四、Serverless 后端实现

### 4.1 Vercel Functions 方案（推荐）

**文件：`api/translate.ts`**

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';

const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MIMO_API_KEY = process.env.MIMO_API_KEY;
const SERVICE_ENABLED = process.env.SERVICE_ENABLED !== 'false';
const MAX_INPUT_LENGTH = parseInt(process.env.MAX_INPUT_LENGTH || '5000');
const MAX_IMAGE_SIZE = parseInt(process.env.MAX_IMAGE_SIZE || '10485760'); // 10MB

// 简单限流（内存存储，适用于短期 demo）
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '10');
const RATE_LIMIT_WINDOW = 60000; // 1 分钟

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // 服务关闭检查
  if (!SERVICE_ENABLED) {
    return res.status(503).json({
      error: 'Silvite Translate Lab experimental service is currently offline.'
    });
  }
  
  // 限流检查
  const ip = req.headers['x-forwarded-for'] as string || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
  }
  
  // API Key 检查
  if (!MIMO_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }
  
  try {
    const { messages, max_tokens = 4096, temperature = 0.3 } = req.body;
    
    // 输入长度检查
    const inputText = messages?.[messages.length - 1]?.content;
    if (typeof inputText === 'string' && inputText.length > MAX_INPUT_LENGTH) {
      return res.status(400).json({ error: 'Input too long' });
    }
    
    // 调用 MiMo API
    const response = await fetch(MIMO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MIMO_API_KEY}`
      },
      body: JSON.stringify({
        model: 'mimo-v2.5',
        messages,
        max_completion_tokens: max_tokens,
        temperature
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('MiMo API error:', error);
      return res.status(response.status).json({ error: 'Translation service error' });
    }
    
    const data = await response.json();
    return res.status(200).json(data);
    
  } catch (error) {
    console.error('Translation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

### 4.2 环境变量配置

```bash
# .env.local（仅用于本地开发，不提交到仓库）

MIMO_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
SERVICE_ENABLED=true
ALLOWED_ORIGIN=https://your-username.github.io
RATE_LIMIT=10
MAX_INPUT_LENGTH=5000
MAX_IMAGE_SIZE=10485760
```

---

## 五、前端 API 调用

### 5.1 API 客户端

**`src/api/client.ts`**

```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export interface TranslationRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string };
    }>;
  }>;
  max_tokens?: number;
  temperature?: number;
}

export interface TranslationResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

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
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
```

---

## 六、Prompt 设计

### 6.1 系统 Prompt

**`src/prompts/system.ts`**

```typescript
export const SYSTEM_PROMPT = `You are a professional Chinese-English AI translation assistant for translators and translation learners.

CORE RULES:
1. Auto-detect the primary language of input (Chinese or English)
2. Auto-translate to the other language (Chinese → English, English → Chinese)
3. For mixed-language input, determine the dominant language and translate accordingly
4. Preserve proper nouns, brand names, code, abbreviations, and terms that should not be translated
5. Prioritize: original meaning > context > tone > style > character identity
6. Never translate word-by-word mechanically
7. Keep user-specified terminology consistent
8. Output MUST be valid JSON

OUTPUT FORMAT (strict JSON):
{
  "source_language": "zh" or "en",
  "target_language": "en" or "zh",
  "translation": "main translation result",
  "detected_text": "original text extracted (for image mode)",
  "segments": [
    {
      "type": "dialogue | narration | sound_effect | text",
      "source": "original segment",
      "translation": "translated segment"
    }
  ],
  "notes": [
    {
      "source": "original",
      "translation": "translation",
      "reason": "explanation of translation choice"
    }
  ]
}

RULES FOR SEGMENTS:
- For text mode: segments is optional, can be empty array
- For image/comic mode: segments should be populated with all detected text
- segment.type: use "dialogue" for speech bubbles, "narration" for captions/boxes, "sound_effect" for onomatopoeia, "text" for general

RULES FOR NOTES:
- Only include notes when there is a meaningful translation decision to explain
- Do NOT include obvious or trivial explanations
- Focus on: why something wasn't translated literally, cultural adaptation, tone shifts, comic sound effect choices

IMPORTANT:
- Output ONLY valid JSON
- No markdown code blocks
- No additional commentary outside JSON
- If parsing would fail, still try to provide the translation in a simplified JSON structure`;
```

### 6.2 翻译模式 Prompt

**`src/prompts/modes.ts`**

```typescript
export type TranslationMode = 
  | 'auto'
  | 'natural'
  | 'literary'
  | 'academic'
  | 'business'
  | 'comic';

export const MODE_PROMPTS: Record<TranslationMode, string> = {
  auto: 'Translate naturally, adapting style to the content type.',
  
  natural: `Translate in a natural, conversational style:
- Use everyday language that native speakers would use
- Prioritize readability over literal accuracy
- Adapt idioms to equivalent expressions in the target language
- Sound like it was originally written in the target language`,
  
  literary: `Translate with literary quality:
- Preserve the author's voice and style
- Maintain literary devices (metaphor, rhythm, tone)
- Use elevated vocabulary where appropriate
- Prioritize beauty and impact of expression
- Creative adaptation is preferred over literal translation`,
  
  academic: `Translate in academic style:
- Use formal, precise language
- Maintain technical terminology accuracy
- Follow academic writing conventions in target language
- Preserve citations and references format
- Prioritize clarity and precision over style`,
  
  business: `Translate in professional business style:
- Use standard business vocabulary
- Maintain formal tone
- Follow business communication conventions
- Preserve company names and product names
- Be concise and action-oriented`,
  
  comic: `Translate manga/comic content:
- Distinguish between: dialogue (speech bubbles), narration (captions), sound effects
- Preserve character voice and personality
- Adapt sound effects naturally (don't transliterate blindly)
- Keep translations short to fit speech bubbles when possible
- Maintain reading flow and timing
- Mark segment types clearly`
};

export const IMAGE_MODE_PROMPT = `You are analyzing an image that contains text (possibly a comic/manga page).
Your task:
1. Identify ALL text in the image in reading order
2. Classify each text segment: dialogue, narration, sound_effect, or text
3. Consider visual context: character expressions, scene, relationships
4. Translate each segment naturally
5. For comics: respect panel reading order (typically right-to-left for manga, left-to-right for western comics)`;
```

---

## 七、核心组件实现

### 7.1 翻译状态管理

**`src/store/translationStore.ts`**

```typescript
import { create } from 'zustand';
import type { TranslationMode } from '../prompts/modes';

export interface TranslationSegment {
  type: 'dialogue' | 'narration' | 'sound_effect' | 'text';
  source: string;
  translation: string;
}

export interface TranslationNote {
  source: string;
  translation: string;
  reason: string;
}

export interface TranslationResult {
  sourceLanguage: 'zh' | 'en';
  targetLanguage: 'en' | 'zh';
  translation: string;
  detectedText?: string;
  segments: TranslationSegment[];
  notes: TranslationNote[];
}

interface TranslationState {
  // Input
  inputText: string;
  inputImage: string | null;
  inputMode: 'text' | 'image';
  
  // Settings
  mode: TranslationMode;
  context: string;
  terminology: string;
  preserveNames: boolean;
  explainTranslation: boolean;
  
  // Result
  result: TranslationResult | null;
  isLoading: boolean;
  error: string | null;
  
  // Service status
  isServiceOnline: boolean;
  
  // Actions
  setInputText: (text: string) => void;
  setInputImage: (image: string | null) => void;
  setInputMode: (mode: 'text' | 'image') => void;
  setMode: (mode: TranslationMode) => void;
  setContext: (context: string) => void;
  setTerminology: (terminology: string) => void;
  setPreserveNames: (preserve: boolean) => void;
  setExplainTranslation: (explain: boolean) => void;
  setResult: (result: TranslationResult | null) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setServiceOnline: (online: boolean) => void;
  reset: () => void;
}

export const useTranslationStore = create<TranslationState>((set) => ({
  inputText: '',
  inputImage: null,
  inputMode: 'text',
  
  mode: 'auto',
  context: '',
  terminology: '',
  preserveNames: true,
  explainTranslation: false,
  
  result: null,
  isLoading: false,
  error: null,
  isServiceOnline: true,
  
  setInputText: (text) => set({ inputText: text }),
  setInputImage: (image) => set({ inputImage: image }),
  setInputMode: (mode) => set({ inputMode: mode }),
  setMode: (mode) => set({ mode }),
  setContext: (context) => set({ context }),
  setTerminology: (terminology) => set({ terminology }),
  setPreserveNames: (preserve) => set({ preserveNames: preserve }),
  setExplainTranslation: (explain) => set({ explainTranslation: explain }),
  setResult: (result) => set({ result }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setServiceOnline: (online) => set({ isServiceOnline: online }),
  reset: () => set({
    inputText: '',
    inputImage: null,
    result: null,
    error: null
  })
}));
```

### 7.2 翻译 Hook

**`src/hooks/useTranslation.ts`**

```typescript
import { useCallback } from 'react';
import { useTranslationStore } from '../store/translationStore';
import { translate } from '../api/client';
import { SYSTEM_PROMPT } from '../prompts/system';
import { MODE_PROMPTS, IMAGE_MODE_PROMPT } from '../prompts/modes';
import { parseTranslationResponse } from '../utils/json-parser';
import { detectLanguage } from '../utils/language';

export function useTranslation() {
  const store = useTranslationStore();
  
  const buildMessages = useCallback(() => {
    const messages: any[] = [];
    
    // System prompt
    let systemPrompt = SYSTEM_PROMPT;
    
    // Add mode-specific instructions
    if (store.mode !== 'auto') {
      systemPrompt += `\n\nSTYLE INSTRUCTIONS:\n${MODE_PROMPTS[store.mode]}`;
    }
    
    // Add context if provided
    if (store.context) {
      systemPrompt += `\n\nCONTEXT: ${store.context}`;
    }
    
    // Add terminology if provided
    if (store.terminology) {
      systemPrompt += `\n\nTERMINOLOGY RULES:\n${store.terminology}`;
    }
    
    // Add preserve names instruction
    if (store.preserveNames) {
      systemPrompt += '\n\nPRESERVE: Keep proper nouns, brand names, person names, place names, and technical terms in their original language.';
    }
    
    // Add explain translation instruction
    if (store.explainTranslation) {
      systemPrompt += '\n\nINCLUDE NOTES: Add translation notes explaining non-obvious translation decisions in the "notes" array.';
    } else {
      systemPrompt += '\n\nNOTES: Return empty array for "notes" unless there is a critically important translation decision to explain.';
    }
    
    messages.push({ role: 'system', content: systemPrompt });
    
    // User message
    if (store.inputMode === 'image' && store.inputImage) {
      // Image mode
      let imagePrompt = IMAGE_MODE_PROMPT;
      if (store.mode === 'comic') {
        imagePrompt += '\n\nThis is a comic/manga page. Pay special attention to reading order, speech bubbles, and sound effects.';
      }
      
      messages.push({
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: store.inputImage }
          },
          {
            type: 'text',
            text: imagePrompt
          }
        ]
      });
    } else {
      // Text mode
      messages.push({
        role: 'user',
        content: store.inputText
      });
    }
    
    return messages;
  }, [store]);
  
  const handleTranslate = useCallback(async () => {
    if (!store.inputText && !store.inputImage) return;
    
    store.setIsLoading(true);
    store.setError(null);
    store.setResult(null);
    
    try {
      const messages = buildMessages();
      const response = await translate({ messages });
      const content = response.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('Empty response from translation service');
      }
      
      const parsed = parseTranslationResponse(content);
      store.setResult(parsed);
    } catch (error) {
      store.setError(error instanceof Error ? error.message : 'Translation failed');
    } finally {
      store.setIsLoading(false);
    }
  }, [store, buildMessages]);
  
  const handleRegenerate = useCallback(() => {
    handleTranslate();
  }, [handleTranslate]);
  
  return {
    translate: handleTranslate,
    regenerate: handleRegenerate
  };
}
```

---

## 八、JSON 健壮解析

**`src/utils/json-parser.ts`**

```typescript
import type { TranslationResult } from '../store/translationStore';

export function parseTranslationResponse(raw: string): TranslationResult {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    return normalizeResult(parsed);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        return normalizeResult(parsed);
      } catch {}
    }
    
    // Try to find JSON object in string
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        return normalizeResult(parsed);
      } catch {}
    }
    
    // Fallback: treat entire response as translation
    return {
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: raw.trim(),
      segments: [],
      notes: []
    };
  }
}

function normalizeResult(parsed: any): TranslationResult {
  return {
    sourceLanguage: parsed.source_language || 'zh',
    targetLanguage: parsed.target_language || 'en',
    translation: parsed.translation || '',
    detectedText: parsed.detected_text || undefined,
    segments: Array.isArray(parsed.segments) 
      ? parsed.segments.map((s: any) => ({
          type: s.type || 'text',
          source: s.source || '',
          translation: s.translation || ''
        }))
      : [],
    notes: Array.isArray(parsed.notes)
      ? parsed.notes.map((n: any) => ({
          source: n.source || '',
          translation: n.translation || '',
          reason: n.reason || ''
        }))
      : []
  };
}
```

---

## 九、图片上传交互需求（补充）

### 9.1 交互方式优先级

| 优先级 | 交互方式 | 说明 |
|--------|----------|------|
| **P0** | Drag & Drop | 主交互，用户直接拖拽本地图片到指定区域 |
| **P1** | Ctrl+V / Cmd+V | 粘贴剪贴板图片（截图、复制的图片） |
| **P2** | 点击上传按钮 | Fallback，打开系统文件选择器 |

### 9.2 Drag & Drop 详细需求

**拖拽区域设计：**
- 在 Source Panel 的图片模式下，提供明确的拖拽区域
- 拖拽区域应有明显的视觉边界（虚线边框 + 图标 + 提示文字）
- 提示文字示例：`拖拽图片到此处 / Drop image here`
- 区域尺寸建议：最小 200px 高度，占据 Source Panel 主要空间

**拖拽状态反馈：**

| 状态 | 视觉反馈 |
|------|----------|
| **默认** | 虚线边框 `--color-border-muted`，图标 + 提示文字 |
| **Hover（拖入区域）** | 边框变为实线 `--color-accent`，背景色变为 `--color-accent-muted`，文字变为 "释放以导入图片" |
| **Active（拖入有效图片）** | 边框高亮，背景色加深，显示绿色对勾图标 |
| **Active（拖入无效文件）** | 边框变为红色 `--color-danger`，显示错误提示 |

**拖拽事件处理：**

```typescript
// 必须监听的事件
- dragenter: 拖入区域时触发，显示 hover 状态
- dragover: 在区域内持续触发，必须 preventDefault() 以允许 drop
- dragleave: 拖出区域时触发，恢复默认状态（注意处理子元素冒泡）
- drop: 释放时触发，读取文件

// 关键实现要点
- dragover 必须调用 e.preventDefault()，否则浏览器会默认打开文件
- dragleave 需要判断是否真正离开区域（处理子元素事件冒泡）
- drop 时需要 e.preventDefault() 阻止浏览器默认行为
```

### 9.3 文件验证规则

```typescript
// 验证时机：drop 事件触发后立即验证
const VALIDATION_RULES = {
  // 允许的 MIME 类型
  allowedTypes: [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/webp'
  ],
  
  // 允许的文件扩展名（作为补充验证）
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
  
  // 单文件大小限制
  maxSize: 10 * 1024 * 1024, // 10MB
  
  // 是否允许多文件
  multiple: false // 单次只处理一张图片
};

// 验证失败时的错误提示
const ERROR_MESSAGES = {
  invalidType: '不支持的文件格式。请使用 JPG、PNG 或 WebP 图片',
  fileTooLarge: '文件过大。最大支持 10MB',
  multipleFiles: '请一次只拖入一张图片'
};
```

### 9.4 剪贴板粘贴支持

**监听方式：**

```typescript
// 在 Source Panel 组件挂载时添加全局监听
useEffect(() => {
  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    // 查找图片类型的剪贴板内容
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          processImageFile(file);
          break;
        }
      }
    }
  };
  
  document.addEventListener('paste', handlePaste);
  return () => document.removeEventListener('paste', handlePaste);
}, []);
```

**粘贴场景：**
- 用户使用截图工具（如 Snipaste、系统截图）复制到剪贴板
- 用户在网页/文件管理器中右键复制图片
- 用户使用 Ctrl+C 复制图片文件后粘贴

### 9.5 图片预览

**导入后立即显示预览：**

```typescript
interface ImagePreview {
  // 原始文件信息
  file: File;
  fileName: string;
  fileSize: string; // 格式化后的大小，如 "2.4 MB"
  dimensions: string; // 如 "1920 × 1080"
  
  // 预览
  previewUrl: string; // Object URL，用于 <img> 显示
  base64: string; // Base64 data URL，用于发送给 API
  
  // 状态
  isValid: boolean;
  validationError?: string;
}
```

**预览区域设计：**
- 图片自适应容器大小（`object-fit: contain`）
- 显示文件名、尺寸、大小信息
- 提供"移除图片"按钮（X 图标）
- 图片加载中显示骨架屏或 Spinner

### 9.6 输入模式自动切换

```typescript
// 当用户拖入图片或粘贴图片时，自动切换到图片模式
// 当用户在文本框输入文字时，自动切换到文本模式

const autoSwitchMode = (inputType: 'text' | 'image') => {
  if (inputType === 'image' && !inputImage) {
    setInputMode('image');
  } else if (inputType === 'text' && inputText.length > 0) {
    setInputMode('text');
  }
};
```

### 9.7 图片处理流程

```
用户操作
    │
    ├─ 拖拽图片 ──→ dragenter (显示 hover)
    │               dragover (保持 hover)
    │               drop (读取文件)
    │                   │
    │                   ├─ 验证文件类型 ──→ 失败 → 显示错误提示
    │                   ├─ 验证文件大小 ──→ 失败 → 显示错误提示
    │                   └─ 验证通过 ──→ 读取为 base64
    │                                   生成预览 URL
    │                                   显示预览
    │                                   切换到图片模式
    │
    ├─ 粘贴图片 ──→ 监听 paste 事件
    │               检查剪贴板内容
    │               提取图片文件
    │                   │
    │                   └─ (同上验证流程)
    │
    └─ 点击上传 ──→ 触发 <input type="file">
                    选择文件
                        │
                        └─ (同上验证流程)
```

### 9.8 状态管理补充

```typescript
// 在 TranslationState 中添加
interface ImageState {
  // 图片预览信息
  imagePreview: {
    fileName: string;
    fileSize: string;
    dimensions: string;
    previewUrl: string;
  } | null;
  
  // 拖拽状态
  isDragOver: boolean;
  dragError: string | null;
  
  // Actions
  setImagePreview: (preview: ImageState['imagePreview']) => void;
  setIsDragOver: (isDragOver: boolean) => void;
  setDragError: (error: string | null) => void;
  clearImage: () => void; // 清除图片和预览
}
```

### 9.9 关键实现注意事项

1. **不允许只实现 `<input type="file">`**：必须实现完整的 Drag & Drop + 粘贴支持
2. **延迟上传**：图片导入后仅在前端预览，用户点击"翻译"后才发送给后端
3. **内存管理**：组件卸载时需要释放 Object URL（`URL.revokeObjectURL`）
4. **拖拽区域覆盖**：整个 Source Panel 都应是有效的拖拽目标，而不是只有一个小图标
5. **移动端降级**：移动端不支持拖拽，应自动降级为点击上传 + 粘贴
6. **错误提示时效**：错误提示显示 3-5 秒后自动消失，或用户点击关闭

---

## 十、导出 PDF / Word 功能（增量）

### 10.1 功能定位

这是增量功能，不重构现有架构，不改动翻译流程，不引入账号、数据库、云端管理等产品化能力。

**约束：**
- 导出在浏览器前端本地完成
- 不上传内容到额外后端生成文件
- 不引入长期文件存储、数据库、用户文档中心
- 项目保持：GitHub Pages 静态前端 + 独立 Serverless 翻译后端

### 10.2 导出内容规范

**基础结构（所有导出）：**

```
┌─────────────────────────────────────────────┐
│  Silvite Translate Lab                      │
│  AI-assisted Translation Result             │
├─────────────────────────────────────────────┤
│  Source Language:  Chinese                   │
│  Target Language:  English                   │
│  Translation Mode: Natural                  │
│  Generated:        2026-09-08 14:30         │
├─────────────────────────────────────────────┤
│  Source Text / 原文                         │
│  ─────────────────────────────────────────  │
│  [当前输入原文]                             │
├─────────────────────────────────────────────┤
│  Translation / 译文                         │
│  ─────────────────────────────────────────  │
│  [当前主译文]                               │
├─────────────────────────────────────────────┤
│  Translation Notes / 翻译说明（可选）       │
│  ─────────────────────────────────────────  │
│  [当前翻译说明]                             │
├─────────────────────────────────────────────┤
│  Terminology / 术语（可选）                 │
│  ─────────────────────────────────────────  │
│  [本次任务使用的术语约束]                   │
├─────────────────────────────────────────────┤
│  Context / 上下文（可选）                   │
│  ─────────────────────────────────────────  │
│  [用户填写的上下文说明]                     │
└─────────────────────────────────────────────┘
```

**图片/漫画翻译导出额外内容：**

```
├─────────────────────────────────────────────┤
│  Original Image / 原始图片（可选增强）       │
│  ─────────────────────────────────────────  │
│  [图片缩略图 - 如果技术实现稳定]            │
├─────────────────────────────────────────────┤
│  Detected Text / 识别原文                   │
│  ─────────────────────────────────────────  │
│  [模型识别出的原文]                         │
├─────────────────────────────────────────────┤
│  Segments / 分段结果（可选）                │
│  ─────────────────────────────────────────  │
│  [分段翻译结果]                             │
└─────────────────────────────────────────────┘
```

### 10.3 导出数据结构

**`src/services/export/types.ts`**

```typescript
export interface TranslationExportData {
  // 基础信息
  sourceLanguage: string;      // 'zh' | 'en'
  targetLanguage: string;      // 'en' | 'zh'
  mode: string;                // 'auto' | 'natural' | 'literary' | 'academic' | 'business' | 'comic'
  generatedAt: Date;
  
  // 核心内容
  sourceText: string;
  translation: string;
  
  // 图片模式额外内容
  detectedText?: string;
  imageDataUrl?: string;       // 原始图片 base64
  segments?: ExportSegment[];
  
  // 可选附加信息
  context?: string;
  terminology?: string;
  notes?: ExportNote[];
}

export interface ExportSegment {
  type: 'dialogue' | 'narration' | 'sound_effect' | 'text';
  source: string;
  translation: string;
}

export interface ExportNote {
  source: string;
  translation: string;
  reason: string;
}

export type ExportFormat = 'pdf' | 'docx';
```

### 10.4 代码组织

```
src/
  services/
    export/
      types.ts              # 导出数据类型定义
      pdf.ts                # PDF 导出逻辑
      docx.ts               # Word 导出逻辑
      index.ts              # 统一导出入口
  components/
    ExportMenu/
      ExportMenu.tsx        # 导出菜单组件
      ExportButton.tsx      # 导出按钮
  assets/
    fonts/
      NotoSansSC-Regular.ttf   # 思源黑体 Regular（中文支持）
      NotoSansSC-Bold.ttf      # 思源黑体 Bold（中文支持）
```

### 10.5 PDF 导出实现

**技术选型：jsPDF**

选择 jsPDF 而非 pdf-lib，原因：
- jsPDF 有官方字体转换工具
- 社区中文支持方案成熟
- 文本自动换行支持更好

**中文字体方案：Noto Sans SC（思源黑体）**

| 项目 | 说明 |
|------|------|
| **字体** | Noto Sans SC（Google 出品，SIL Open Font License） |
| **授权** | 完全免费，可商用，可分发 |
| **格式** | TTF，jsPDF 原生支持 |
| **字重** | Regular + Bold 两个字重 |
| **文件大小** | 约 8-12MB 每个（完整版） |
| **子集优化** | 可使用 fonttools 裁剪常用汉字，降至 2-3MB |

**字体加载策略：**

```typescript
// 方案 A：VFS 方式（推荐）
// 将字体文件转换为 base64 JS 文件，打包进前端
// 优点：无需运行时网络请求，GitHub Pages 部署简单
// 缺点：增加打包体积

// 方案 B：运行时加载
// 从 CDN 或 public 目录运行时加载字体
// 优点：不影响打包体积
// 缺点：首次使用需要等待字体加载

// 推荐方案 A，因为：
// 1. 字体只在导出时使用，不影响首屏加载
// 2. 可通过 dynamic import 延迟加载字体模块
// 3. GitHub Pages 部署更可靠
```

**PDF 生成核心逻辑：**

**`src/services/export/pdf.ts`**

```typescript
import { jsPDF } from 'jspdf';
import type { TranslationExportData } from './types';

// 字体将在运行时通过 dynamic import 加载
let fontLoaded = false;

async function loadFont(): Promise<void> {
  if (fontLoaded) return;
  
  // 动态导入字体文件
  const fontModule = await import('../../assets/fonts/NotoSansSC-Regular-base64');
  const fontBoldModule = await import('../../assets/fonts/NotoSansSC-Bold-base64');
  
  // 添加到 jsPDF VFS
  jsPDF.API.addFileToVFS('NotoSansSC-Regular.ttf', fontModule.default);
  jsPDF.API.addFileToVFS('NotoSansSC-Bold.ttf', fontBoldModule.default);
  
  jsPDF.API.addFont('NotoSansSC-Regular.ttf', 'NotoSansSC', 'normal');
  jsPDF.API.addFont('NotoSansSC-Bold.ttf', 'NotoSansSC', 'bold');
  
  fontLoaded = true;
}

// 页面配置
const PAGE_CONFIG = {
  margin: {
    top: 25,
    bottom: 25,
    left: 20,
    right: 20
  },
  fontSize: {
    title: 18,
    subtitle: 12,
    heading: 14,
    body: 11,
    caption: 9
  },
  lineHeight: 1.6,
  pageWidth: 210,      // A4
  pageHeight: 297      // A4
};

export async function exportToPdf(data: TranslationExportData): Promise<void> {
  await loadFont();
  
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });
  
  const { margin, fontSize } = PAGE_CONFIG;
  const contentWidth = PAGE_CONFIG.pageWidth - margin.left - margin.right;
  let currentY = margin.top;
  
  // 检查是否需要分页
  function checkPageBreak(neededHeight: number): void {
    if (currentY + neededHeight > PAGE_CONFIG.pageHeight - margin.bottom) {
      doc.addPage();
      currentY = margin.top;
    }
  }
  
  // 添加标题
  doc.setFont('NotoSansSC', 'bold');
  doc.setFontSize(fontSize.title);
  doc.text('Silvite Translate Lab', margin.left, currentY);
  currentY += 10;
  
  doc.setFont('NotoSansSC', 'normal');
  doc.setFontSize(fontSize.subtitle);
  doc.setTextColor(100, 100, 100);
  doc.text('AI-assisted Translation Result', margin.left, currentY);
  currentY += 8;
  
  // 分隔线
  doc.setDrawColor(200, 200, 200);
  doc.line(margin.left, currentY, PAGE_CONFIG.pageWidth - margin.right, currentY);
  currentY += 8;
  
  // 翻译信息
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(fontSize.body);
  
  const infoItems = [
    `Source Language: ${data.sourceLanguage === 'zh' ? 'Chinese' : 'English'}`,
    `Target Language: ${data.targetLanguage === 'zh' ? 'Chinese' : 'English'}`,
    `Translation Mode: ${data.mode}`,
    `Generated: ${data.generatedAt.toLocaleString()}`
  ];
  
  for (const item of infoItems) {
    doc.setFont('NotoSansSC', 'normal');
    doc.text(item, margin.left, currentY);
    currentY += 6;
  }
  currentY += 4;
  
  // 分隔线
  doc.line(margin.left, currentY, PAGE_CONFIG.pageWidth - margin.right, currentY);
  currentY += 8;
  
  // 原文部分
  checkPageBreak(30);
  doc.setFont('NotoSansSC', 'bold');
  doc.setFontSize(fontSize.heading);
  doc.text('Source Text / 原文', margin.left, currentY);
  currentY += 8;
  
  doc.setFont('NotoSansSC', 'normal');
  doc.setFontSize(fontSize.body);
  const sourceLines = doc.splitTextToSize(data.sourceText, contentWidth);
  for (const line of sourceLines) {
    checkPageBreak(6);
    doc.text(line, margin.left, currentY);
    currentY += fontSize.body * PAGE_CONFIG.lineHeight * 0.352778;
  }
  currentY += 6;
  
  // 译文部分
  checkPageBreak(30);
  doc.setFont('NotoSansSC', 'bold');
  doc.setFontSize(fontSize.heading);
  doc.text('Translation / 译文', margin.left, currentY);
  currentY += 8;
  
  doc.setFont('NotoSansSC', 'normal');
  doc.setFontSize(fontSize.body);
  const translationLines = doc.splitTextToSize(data.translation, contentWidth);
  for (const line of translationLines) {
    checkPageBreak(6);
    doc.text(line, margin.left, currentY);
    currentY += fontSize.body * PAGE_CONFIG.lineHeight * 0.352778;
  }
  currentY += 6;
  
  // 可选部分：Context
  if (data.context) {
    checkPageBreak(30);
    doc.setFont('NotoSansSC', 'bold');
    doc.setFontSize(fontSize.heading);
    doc.text('Context / 上下文', margin.left, currentY);
    currentY += 8;
    
    doc.setFont('NotoSansSC', 'normal');
    doc.setFontSize(fontSize.body);
    const contextLines = doc.splitTextToSize(data.context, contentWidth);
    for (const line of contextLines) {
      checkPageBreak(6);
      doc.text(line, margin.left, currentY);
      currentY += fontSize.body * PAGE_CONFIG.lineHeight * 0.352778;
    }
    currentY += 6;
  }
  
  // 可选部分：Terminology
  if (data.terminology) {
    checkPageBreak(30);
    doc.setFont('NotoSansSC', 'bold');
    doc.setFontSize(fontSize.heading);
    doc.text('Terminology / 术语', margin.left, currentY);
    currentY += 8;
    
    doc.setFont('NotoSansSC', 'normal');
    doc.setFontSize(fontSize.body);
    const termLines = doc.splitTextToSize(data.terminology, contentWidth);
    for (const line of termLines) {
      checkPageBreak(6);
      doc.text(line, margin.left, currentY);
      currentY += fontSize.body * PAGE_CONFIG.lineHeight * 0.352778;
    }
    currentY += 6;
  }
  
  // 可选部分：Notes
  if (data.notes && data.notes.length > 0) {
    checkPageBreak(30);
    doc.setFont('NotoSansSC', 'bold');
    doc.setFontSize(fontSize.heading);
    doc.text('Translation Notes / 翻译说明', margin.left, currentY);
    currentY += 8;
    
    doc.setFont('NotoSansSC', 'normal');
    doc.setFontSize(fontSize.body);
    
    for (const note of data.notes) {
      checkPageBreak(20);
      const noteText = `${note.source} → ${note.translation}: ${note.reason}`;
      const noteLines = doc.splitTextToSize(noteText, contentWidth);
      for (const line of noteLines) {
        checkPageBreak(6);
        doc.text(line, margin.left, currentY);
        currentY += fontSize.body * PAGE_CONFIG.lineHeight * 0.352778;
      }
      currentY += 3;
    }
  }
  
  // 图片模式：Detected Text
  if (data.detectedText) {
    checkPageBreak(30);
    doc.setFont('NotoSansSC', 'bold');
    doc.setFontSize(fontSize.heading);
    doc.text('Detected Text / 识别原文', margin.left, currentY);
    currentY += 8;
    
    doc.setFont('NotoSansSC', 'normal');
    doc.setFontSize(fontSize.body);
    const detectedLines = doc.splitTextToSize(data.detectedText, contentWidth);
    for (const line of detectedLines) {
      checkPageBreak(6);
      doc.text(line, margin.left, currentY);
      currentY += fontSize.body * PAGE_CONFIG.lineHeight * 0.352778;
    }
    currentY += 6;
  }
  
  // 图片模式：Segments
  if (data.segments && data.segments.length > 0) {
    checkPageBreak(30);
    doc.setFont('NotoSansSC', 'bold');
    doc.setFontSize(fontSize.heading);
    doc.text('Segments / 分段结果', margin.left, currentY);
    currentY += 8;
    
    doc.setFont('NotoSansSC', 'normal');
    doc.setFontSize(fontSize.body);
    
    for (const segment of data.segments) {
      checkPageBreak(15);
      const segmentLabel = `[${segment.type}]`;
      doc.setFont('NotoSansSC', 'bold');
      doc.text(segmentLabel, margin.left, currentY);
      currentY += 5;
      
      doc.setFont('NotoSansSC', 'normal');
      const segmentText = `${segment.source} → ${segment.translation}`;
      const segmentLines = doc.splitTextToSize(segmentText, contentWidth - 5);
      for (const line of segmentLines) {
        checkPageBreak(6);
        doc.text(line, margin.left + 5, currentY);
        currentY += fontSize.body * PAGE_CONFIG.lineHeight * 0.352778;
      }
      currentY += 3;
    }
  }
  
  // 页脚
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('NotoSansSC', 'normal');
    doc.setFontSize(fontSize.caption);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Silvite Translate Lab - Page ${i} of ${pageCount}`,
      PAGE_CONFIG.pageWidth / 2,
      PAGE_CONFIG.pageHeight - 10,
      { align: 'center' }
    );
  }
  
  // 生成文件名
  const timestamp = formatDateForFilename(data.generatedAt);
  const filename = `Silvite-Translate-${timestamp}.pdf`;
  
  // 下载
  doc.save(filename);
}

function formatDateForFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}`;
}
```

**字体文件处理：**

```bash
# 1. 下载 Noto Sans SC 字体
# https://fonts.google.com/noto/specimen/Noto+Sans+SC

# 2. 使用 jsPDF 官方 fontconverter 转换
# 访问: https://rawgit.com/MrRio/jsPDF/master/fontconverter/fontconverter.html
# 上传 TTF → 生成 JS 文件

# 3. 或使用 Node.js 脚本转换
node -e "
const fs = require('fs');
const fontData = fs.readFileSync('NotoSansSC-Regular.ttf');
const base64 = fontData.toString('base64');
const output = \`export default \"\${base64}\";\`;
fs.writeFileSync('NotoSansSC-Regular-base64.ts', output);
"
```

### 10.6 Word 导出实现

**技术选型：docx**

| 项目 | 说明 |
|------|------|
| **库** | docx (npm) |
| **版本** | 9.7.x |
| **许可证** | MIT |
| **特点** | TypeScript 原生、浏览器/Node 通用、声明式 API |
| **中文支持** | 原生支持，无需额外字体文件 |

**Word 生成核心逻辑：**

**`src/services/export/docx.ts`**

```typescript
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  TabStopType,
  TabStopPosition,
  ImageRun,
  convertInchesToTwip
} from 'docx';
import { saveAs } from 'file-saver';
import type { TranslationExportData, ExportSegment, ExportNote } from './types';

// 样式常量
const STYLES = {
  colors: {
    primary: '1F2328',
    secondary: '656D76',
    accent: '0969DA',
    muted: '8B949E'
  },
  fonts: {
    heading: 'Microsoft YaHei',  // 微软雅黑（Windows 内置）
    body: 'Microsoft YaHei',
    // 备选：PingFang SC (macOS), Noto Sans CJK SC (Linux)
    fallback: ['PingFang SC', 'Noto Sans CJK SC', 'SimHei', 'sans-serif']
  }
};

function createHeading(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        size: 28,  // 14pt
        font: STYLES.fonts.heading,
        color: STYLES.colors.primary
      })
    ],
    spacing: {
      before: 240,
      after: 120
    }
  });
}

function createBodyText(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        size: 22,  // 11pt
        font: STYLES.fonts.body,
        color: STYLES.colors.primary
      })
    ],
    spacing: {
      after: 80
    }
  });
}

function createInfoItem(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: `${label}: `,
        bold: true,
        size: 20,
        font: STYLES.fonts.body,
        color: STYLES.colors.secondary
      }),
      new TextRun({
        text: value,
        size: 20,
        font: STYLES.fonts.body,
        color: STYLES.colors.primary
      })
    ],
    spacing: {
      after: 40
    }
  });
}

function createSeparator(): Paragraph {
  return new Paragraph({
    children: [],
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 1,
        color: 'D1D9E0'
      }
    },
    spacing: {
      after: 120
    }
  });
}

function createSegmentParagraph(segment: ExportSegment): Paragraph[] {
  const typeLabels: Record<string, string> = {
    dialogue: 'Dialogue / 对白',
    narration: 'Narration / 旁白',
    sound_effect: 'Sound Effect / 拟声词',
    text: 'Text / 文本'
  };
  
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: `[${typeLabels[segment.type] || segment.type}]`,
          bold: true,
          size: 20,
          font: STYLES.fonts.body,
          color: STYLES.colors.accent
        })
      ],
      spacing: { before: 80, after: 40 }
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${segment.source} → ${segment.translation}`,
          size: 20,
          font: STYLES.fonts.body,
          color: STYLES.colors.primary
        })
      ],
      spacing: { after: 80 },
      indent: { left: convertInchesToTwip(0.25) }
    })
  ];
}

function createNoteParagraph(note: ExportNote): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: `${note.source} → ${note.translation}`,
        bold: true,
        size: 20,
        font: STYLES.fonts.body,
        color: STYLES.colors.primary
      }),
      new TextRun({
        text: `: ${note.reason}`,
        size: 20,
        font: STYLES.fonts.body,
        color: STYLES.colors.secondary
      })
    ],
    spacing: { after: 80 }
  });
}

export async function exportToDocx(data: TranslationExportData): Promise<void> {
  const sections: any[] = [];
  
  // 标题部分
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'Silvite Translate Lab',
          bold: true,
          size: 36,  // 18pt
          font: STYLES.fonts.heading,
          color: STYLES.colors.primary
        })
      ],
      spacing: { after: 80 }
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'AI-assisted Translation Result',
          size: 24,  // 12pt
          font: STYLES.fonts.body,
          color: STYLES.colors.muted
        })
      ],
      spacing: { after: 120 }
    }),
    createSeparator()
  );
  
  // 翻译信息
  sections.push(
    createInfoItem('Source Language', data.sourceLanguage === 'zh' ? 'Chinese' : 'English'),
    createInfoItem('Target Language', data.targetLanguage === 'zh' ? 'Chinese' : 'English'),
    createInfoItem('Translation Mode', data.mode),
    createInfoItem('Generated', data.generatedAt.toLocaleString()),
    createSeparator()
  );
  
  // 原文
  sections.push(
    createHeading('Source Text / 原文'),
    createBodyText(data.sourceText),
    createSeparator()
  );
  
  // 译文
  sections.push(
    createHeading('Translation / 译文'),
    createBodyText(data.translation),
    createSeparator()
  );
  
  // 可选：Context
  if (data.context) {
    sections.push(
      createHeading('Context / 上下文'),
      createBodyText(data.context),
      createSeparator()
    );
  }
  
  // 可选：Terminology
  if (data.terminology) {
    sections.push(
      createHeading('Terminology / 术语'),
      createBodyText(data.terminology),
      createSeparator()
    );
  }
  
  // 可选：Notes
  if (data.notes && data.notes.length > 0) {
    sections.push(createHeading('Translation Notes / 翻译说明'));
    for (const note of data.notes) {
      sections.push(createNoteParagraph(note));
    }
    sections.push(createSeparator());
  }
  
  // 图片模式：Detected Text
  if (data.detectedText) {
    sections.push(
      createHeading('Detected Text / 识别原文'),
      createBodyText(data.detectedText),
      createSeparator()
    );
  }
  
  // 图片模式：Segments
  if (data.segments && data.segments.length > 0) {
    sections.push(createHeading('Segments / 分段结果'));
    for (const segment of data.segments) {
      sections.push(...createSegmentParagraph(segment));
    }
    sections.push(createSeparator());
  }
  
  // 创建文档
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
              right: convertInchesToTwip(1.25)
            }
          }
        },
        children: sections
      }
    ]
  });
  
  // 生成 Blob
  const blob = await Packer.toBlob(doc);
  
  // 生成文件名
  const timestamp = formatDateForFilename(data.generatedAt);
  const filename = `Silvite-Translate-${timestamp}.docx`;
  
  // 下载
  saveAs(blob, filename);
}

function formatDateForFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}`;
}
```

### 10.7 统一导出入口

**`src/services/export/index.ts`**

```typescript
import type { TranslationExportData, ExportFormat } from './types';
import { exportToPdf } from './pdf';
import { exportToDocx } from './docx';

export type { TranslationExportData, ExportFormat };
export { exportToPdf, exportToDocx };

export async function exportTranslation(
  data: TranslationExportData,
  format: ExportFormat
): Promise<void> {
  switch (format) {
    case 'pdf':
      return exportToPdf(data);
    case 'docx':
      return exportToDocx(data);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}
```

### 10.8 UI 组件

**`src/components/ExportMenu/ExportMenu.tsx`**

```typescript
import { useState, useRef, useEffect } from 'react';
import { useTranslationStore } from '../../store/translationStore';
import { exportTranslation } from '../../services/export';
import type { ExportFormat, TranslationExportData } from '../../services/export';

export function ExportMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  
  const { result, inputText, inputImage, mode, context, terminology, explainTranslation } = useTranslationStore();
  
  // 点击外部关闭菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // 无结果时禁用
  const isDisabled = !result || (!inputText && !inputImage);
  
  // 构建导出数据
  function buildExportData(): TranslationExportData {
    if (!result) throw new Error('No translation result');
    
    return {
      sourceLanguage: result.sourceLanguage,
      targetLanguage: result.targetLanguage,
      mode,
      generatedAt: new Date(),
      sourceText: inputText || result.detectedText || '',
      translation: result.translation,
      detectedText: result.detectedText,
      imageDataUrl: inputImage || undefined,
      segments: result.segments,
      context: context || undefined,
      terminology: terminology || undefined,
      notes: explainTranslation ? result.notes : undefined
    };
  }
  
  // 处理导出
  async function handleExport(format: ExportFormat) {
    setIsOpen(false);
    setIsExporting(true);
    setExportFormat(format);
    setError(null);
    
    try {
      const data = buildExportData();
      await exportTranslation(data, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsExporting(false);
      setExportFormat(null);
    }
  }
  
  return (
    <div className="relative" ref={menuRef}>
      {/* 导出按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isDisabled || isExporting}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
          rounded-md border transition-colors
          ${isDisabled
            ? 'border-gray-200 text-gray-400 cursor-not-allowed'
            : 'border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400'
          }
        `}
        title={isDisabled ? 'No translation result to export' : 'Export translation'}
      >
        {isExporting ? (
          <>
            <Spinner size="sm" />
            <span>Exporting {exportFormat?.toUpperCase()}...</span>
          </>
        ) : (
          <>
            <ExportIcon />
            <span>Export</span>
            <ChevronDownIcon />
          </>
        )}
      </button>
      
      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50">
          <div className="py-1">
            <button
              onClick={() => handleExport('pdf')}
              className="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <PdfIcon />
              <span>Export as PDF</span>
            </button>
            <button
              onClick={() => handleExport('docx')}
              className="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <WordIcon />
              <span>Export as Word</span>
            </button>
          </div>
        </div>
      )}
      
      {/* 错误提示 */}
      {error && (
        <div className="absolute right-0 mt-2 w-64 p-3 bg-red-50 border border-red-200 rounded-md shadow-lg z-50">
          <div className="flex items-start gap-2">
            <ErrorIcon className="text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-800">Export failed</p>
              <p className="text-xs text-red-600 mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 图标组件（示意）
function ExportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2v8m0 0l-3-3m3 3l3-3M3 12v1a1 1 0 001 1h8a1 1 0 001-1v-1" 
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function Spinner({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <svg className={`animate-spin ${sizeClass}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  );
}

function PdfIcon() { /* PDF 图标 */ }
function WordIcon() { /* Word 图标 */ }
function ErrorIcon({ className }: { className?: string }) { /* 错误图标 */ }
```

### 10.9 依赖项

**新增 npm 依赖：**

```json
{
  "dependencies": {
    "jspdf": "^3.0.0",
    "docx": "^9.7.0",
    "file-saver": "^2.0.5"
  },
  "devDependencies": {
    "@types/file-saver": "^2.0.7"
  }
}
```

| 依赖 | 版本 | 用途 | 许可证 |
|------|------|------|--------|
| jspdf | ^3.0.0 | PDF 生成 | MIT |
| docx | ^9.7.0 | Word 生成 | MIT |
| file-saver | ^2.0.5 | 浏览器文件下载 | MIT |
| @types/file-saver | ^2.0.7 | TypeScript 类型 | MIT |

### 10.10 目录结构变更

```
silvite-translate-lab/
├── src/
│   ├── services/
│   │   └── export/               # 新增
│   │       ├── types.ts          # 导出类型定义
│   │       ├── pdf.ts            # PDF 导出
│   │       ├── docx.ts           # Word 导出
│   │       └── index.ts          # 统一入口
│   ├── components/
│   │   ├── ExportMenu/           # 新增
│   │   │   ├── ExportMenu.tsx
│   │   │   └── index.ts
│   │   └── ...
│   └── assets/
│       └── fonts/                # 新增（字体文件）
│           ├── NotoSansSC-Regular-base64.ts
│           └── NotoSansSC-Bold-base64.ts
└── ...
```

### 10.11 UI 集成位置

在 TranslationPanel 的操作区添加 Export 按钮，与 Copy、Regenerate 同级：

```typescript
// src/components/TranslationPanel/TranslationPanel.tsx

<div className="flex items-center gap-2">
  {/* 现有按钮 */}
  <CopyButton text={result?.translation} />
  <RegenerateButton />
  
  {/* 新增导出菜单 */}
  <ExportMenu />
</div>
```

### 10.12 验收检查清单

- [ ] GitHub Pages 环境下可直接使用
- [ ] 不需要新增后端
- [ ] PDF 可正常导出
- [ ] Word 可正常导出
- [ ] 中文不乱码（PDF）
- [ ] 长文章可正确分页（PDF）
- [ ] Word 文本可继续编辑
- [ ] 导出不会再次调用模型
- [ ] 无翻译结果时不能导出
- [ ] 不影响现有文本翻译、图片翻译和拖拽功能
- [ ] 不引入账号、数据库、云端保存等 scope
- [ ] 导出文件名格式正确：`Silvite-Translate-YYYYMMDD-HHmm.ext`
- [ ] Export 按钮在无结果时 disabled
- [ ] 导出中有 Loading 状态
- [ ] 导出失败有错误提示

### 10.13 风险和备选方案

| 风险 | 影响 | 备选方案 |
|------|------|----------|
| 中文字体文件过大（10MB+） | 增加打包体积，首次加载慢 | 1. 使用字体子集工具裁剪<br>2. 改为运行时从 CDN 加载<br>3. 使用系统字体（降级方案） |
| jsPDF 文本换行问题 | 长文本可能溢出 | 手动实现分页逻辑，检测 Y 坐标 |
| 图片嵌入 PDF 复杂度高 | 开发时间增加 | 图片导出设为可选增强，先只导出文本 |
| docx 库在某些 Word 版本兼容性 | 格式可能微调 | 使用标准 OOXML，避免高级特性 |

---

## 十一、图片处理工具

**`src/utils/image.ts`**

```typescript
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
}

export function validateImage(file: File): ImageValidationResult {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported format. Allowed: ${ALLOWED_TYPES.map(t => t.split('/')[1].toUpperCase()).join(', ')}`
    };
  }
  
  if (file.size > MAX_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size: ${MAX_SIZE / 1024 / 1024}MB`
    };
  }
  
  return { valid: true };
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function processImage(file: File): Promise<string> {
  const validation = validateImage(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  
  return fileToBase64(file);
}
```

---

## 十二、Vite 配置

**`vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/silvite-translate-lab/',
  build: {
    outDir: 'dist',
    sourcemap: false
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
```

---

## 十三、GitHub Pages 部署

### 12.1 GitHub Actions 配置

**`.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: 'pages'
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### 12.2 SPA 路由处理

在 `public/` 目录创建 `404.html`（内容与 `index.html` 相同），解决刷新 404 问题。

---

## 十四、Demo 样本数据

**`src/demo/samples.ts`**

```typescript
export const DEMO_SAMPLES = {
  textZh: {
    title: '中文 → English',
    description: '科技产品介绍',
    input: `小米生态系统致力于为用户提供无缝的智能生活体验。
通过 MiMo Connect 协议，所有小米设备可以实现即时发现、
自动连接和智能协同。无论是手机、平板、电视还是智能家居，
都能在一个统一的平台上实现完美联动。`,
    expected: {
      source_language: 'zh',
      target_language: 'en',
      translation: `The Xiaomi ecosystem is committed to delivering a seamless smart living experience for users.
Through the MiMo Connect protocol, all Xiaomi devices can achieve instant discovery,
automatic connection, and intelligent coordination. Whether it's a phone, tablet, TV, or smart home device,
they can all work together perfectly on a unified platform.`,
      segments: [],
      notes: [
        {
          source: 'MiMo Connect',
          translation: 'MiMo Connect',
          reason: 'Brand name preserved as-is per standard practice'
        }
      ]
    }
  },
  
  textEn: {
    title: 'English → 中文',
    description: 'Technical Documentation',
    input: `The architecture employs a microservices pattern with event-driven communication. 
Services are containerized using Docker and orchestrated via Kubernetes. 
The API gateway handles authentication, rate limiting, and request routing.
Observability is achieved through distributed tracing with OpenTelemetry.`,
    expected: {
      source_language: 'en',
      target_language: 'zh',
      translation: `该架构采用微服务模式，通过事件驱动进行通信。
服务使用 Docker 容器化，并通过 Kubernetes 进行编排。
API 网关负责处理认证、限流和请求路由。
可观测性通过 OpenTelemetry 的分布式追踪来实现。`,
      segments: [],
      notes: [
        {
          source: 'microservices',
          translation: '微服务',
          reason: 'Industry standard translation'
        },
        {
          source: 'orchestrated',
          translation: '编排',
          reason: 'Standard technical term in container orchestration context'
        }
      ]
    }
  },
  
  comic: {
    title: '漫画翻译',
    description: 'Manga Panel Translation',
    input: '[Image placeholder - load demo to see comic translation]',
    expected: {
      source_language: 'ja',
      target_language: 'zh',
      translation: '漫画翻译结果将显示在这里',
      detected_text: '识别出的原文将显示在这里',
      segments: [
        { type: 'dialogue', source: 'こんにちは！', translation: '你好！' },
        { type: 'narration', source: '次の日', translation: '第二天' },
        { type: 'sound_effect', source: 'ドキドキ', translation: '扑通扑通' }
      ],
      notes: [
        {
          source: 'ドキドキ',
          translation: '扑通扑通',
          reason: '心臓の鼓動を表す擬音語、中国語の自然な表現を使用'
        }
      ]
    }
  }
};
```

---

## 十五、开发顺序（确认）

| Phase | 内容 | 产出 |
|-------|------|------|
| **Phase 0** | 初始化项目、Vite + React + TS、配置 GitHub Pages | 可运行的空项目 |
| **Phase 1** | 完成整个 UI（使用 mock 数据） | 完整界面 |
| **Phase 2** | 接 Serverless、完成 MiMo 文本翻译 | 文本翻译可用 |
| **Phase 3** | 完成图片输入、接 MiMo V2.5 多模态 | 图片翻译可用 |
| **Phase 4** | 加 Context / Terminology / Mode / Notes | 高级功能 |
| **Phase 5** | 错误处理、Loading、Copy、Regenerate、CORS、Rate Limit、服务关闭开关 | 生产就绪 |
| **Phase 6** | GitHub Pages 部署、Serverless 部署、端到端测试、Demo Samples | 上线 |

---

## 十六、验收检查清单

- [ ] GitHub Pages 可直接打开
- [ ] 页面是纯静态前端（dist 目录）
- [ ] API Key 不出现在前端代码中
- [ ] 文本中英自动识别和互译可用
- [ ] 图片/漫画翻译可用
- [ ] MiMo V2.5 官方 API 调用真实可用
- [ ] UI 像成熟工具，不像 AI 模板
- [ ] 课堂现场操作流程不超过 3 步
- [ ] 异常时不会崩页面
- [ ] 可以一键关闭后端服务（SERVICE_ENABLED=false）
- [ ] 不扩展任何产品化 scope
- [ ] **图片 Drag & Drop 功能完整可用**
- [ ] **拖拽区域有明确的 hover/active 状态反馈**
- [ ] **Ctrl+V / Cmd+V 粘贴图片功能可用**
- [ ] **拖入非图片文件时显示明确错误提示**
- [ ] **图片导入后显示预览，不自动上传**

---

## 十七、注意事项

1. **API Key 安全**：MiMo API Key 只能存在于 Vercel/Cloudflare 环境变量中，严禁写入前端代码
2. **图片处理**：优先使用 base64 data URL 方式，MiMo V2.5 原生支持
3. **JSON 解析**：必须做健壮解析，模型偶尔会返回非法 JSON
4. **限流**：短期 demo 必须防止 API 被刷爆
5. **服务开关**：通过 `SERVICE_ENABLED=false` 可一键关闭服务

---

## 十八、翻译请求生命周期（Streaming，2026-09-09）

### 18.1 链路

```text
Frontend (translateStream)
   → POST /api/translate
   → EdgeOne Cloud Function（stream:true 调 MiMo）
   → 消费 MiMo SSE（createSseEventParser / consumeMimoSse）
   → 增量 translation extractor（只解码 "translation" 字段值）
   → Silvite SSE 事件（start / delta / reset / final / error）
   → Store provisional text（体验层）
   → final 事件 = canonical result（唯一真相，整卡覆盖）
```

### 18.2 硬规则（改代码前必读）

1. **任何结构化 JSON 片段绝不能作为译文展示**：`parseModelContent` 返回
   `{ok:false, reason}` 时只能 retry 或 error；纯文本响应才允许 raw fallback。
2. **`finish_reason` 是第一手失败信号**：`length` → `OUTPUT_TRUNCATED`，不得
   把内容当成功。
3. **自动重试每层最多 1 次**：截断重试预算翻倍（clamp 65536）；空响应、MiMo
   流异常或无终止原因 EOF 同预算重试；浏览器到 Serverless 的传输中断由前端
   清空临时文本后重新请求一次；上游 4xx/5xx 不重试。
4. **Thinking 显式关闭**：`thinking: {type:'disabled'}`（官方参数；默认
   enabled 会挤占 completion 预算并把 temperature 强制为 1.0）。
5. **Comic 不流 delta**：模型自由译文顺序不可靠，最终译文必须由
   `enforceReplyOrders() + buildComicTranslation()` 确定性重建；delta 全程抑制。
6. **竞态防护**：AbortController + request generation id；新请求/reset/demo
   切换会 abort 旧流，旧 chunk 与旧 final 永远污染不了新 session。
7. **Provider 细节只进服务端日志**：SSE 只含 Silvite 自有事件。

### 18.3 失败分类（内部代码 → 用户文案）

| code | 用户文案 |
| --- | --- |
| OUTPUT_TRUNCATED | 译文过长，模型未能完整返回结果。请缩短输入后重试。 |
| MODEL_EMPTY_RESPONSE | 翻译服务返回为空，请稍后重试。 |
| MODEL_FORMAT_FAILURE | 翻译服务返回格式异常，请重试。 |
| MODEL_UPSTREAM_ERROR | 翻译服务暂时不可用，请稍后重试。 |
| MODEL_STREAM_INTERRUPTED | 翻译连接中断，请重试。 |

### 18.4 环境变量（新增）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MAX_COMPLETION_TOKENS` | 按输入 4096–32768 | 输出预算覆盖，clamp [1024, 65536] |

---

## 十九、文档与长文本翻译（2026-09-10）

### 19.1 运行时

- `/api/translate` 的唯一实现位于 `cloud-functions/api/translate.js`。
- 根目录 `edgeone.json` 配置 `cloudFunctions.nodejs.maxDuration = 120`。
- `functions/api/translate.js` 已删除，避免两个 handler 同时映射同一路由。
- 本地 `npm run api` 直接导入 Cloud Function handler，线上和本地保持同源。

### 19.2 统一管线

普通文本与 TXT / MD / DOCX / PDF 提取正文统一进入
`src/services/document/translateDocument.ts`。`chunker.ts` 根据源语言采用保守目标长度，
并按标题/段落、列表、完整句子、字符硬切的优先级分块。Markdown fenced code block
原样通过，不发送给模型。

每块独立请求 `/api/translate`，所以每块拥有新的 120 秒生命周期。浏览器在 95 秒
执行软截止，超时后只细分当前块；已完成块保留，最终按原顺序拼成一个 canonical
result。界面只显示自然语言状态和百分比，不暴露 chunk 编号。

### 19.3 文件边界

- 白名单：PDF、DOCX、TXT、MD。
- 单文件上限：10MB；提取正文上限：100,000 字符。
- PDF 只处理文本层；无文本层时提示用户更换文件，不新增 OCR。
- 扩展名、MIME、PDF/DOCX 文件签名和解析结果共同校验。

### 19.4 稳定性约束

- JSON parser 对 fenced、前后解释、partial、malformed 和嵌套协议数据执行恢复或重试，
  结构化协议永不作为正文 fallback。
- 流式 extractor 只释放已确认的顶层 `translation` 字符串；无法分类的原始内容等待
  canonical final，不在 provisional UI 中冒险展示。
- `reset()`、`loadDemoSample()` 和新翻译都会使 request generation 失效并 abort 旧流；
  delta/reset/final/catch 均检查 generation 与 AbortSignal。

---

*文档版本: 1.4.0 | 最后更新: 2026-09-10*

### 更新记录
- v1.4.0 (2026-09-10): Cloud Functions 120 秒运行时、统一长文本/文件管线、局部超时恢复、JSON 防泄漏与请求竞态修复
- v1.3.0 (2026-09-09): 第十八章「翻译请求生命周期（Streaming）」——MiMo SSE 消费、自有 SSE 事件协议、截断防护与自动重试、thinking 关闭、Comic 抑制流式、竞态防护
- v1.2.0 (2026-09-08): 新增第十章「导出 PDF / Word 功能」、图片上传交互、详细工程实现和 UI 规范
- v1.1.0 (2026-09-08): 新增第九章「图片上传（增强）」，包括 Drag & Drop、剪贴板粘贴、图片预览等详细规范
