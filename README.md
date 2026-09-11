# 🌐 Silvite Translate Lab

> 面向译者与翻译学习场景的 AI 翻译工作台。  
> 不只是“把文字换一种语言”，而是尽可能理解 **上下文、术语、文体与图片中的视觉关系**。

Silvite Translate Lab 是一个基于 **React + EdgeOne Pages + Xiaomi MiMo V2.5** 构建的实验性 AI 翻译工具。

它支持文本与图片翻译、多语言自动路由、上下文消歧、术语硬约束，以及针对文学、学术、商务和漫画等不同场景的翻译策略。

> 🚀 Online: `https://translate.modiconnect.cn`

---

## ✨ Features

### 🌍 多语言自动路由

无需手动选择源语言。

当前路由规则：

- 🇨🇳 中文 → 英语
- 🇬🇧 英语 → 中文
- 🌐 其他语言 → 中文

支持自动识别日语、法语、西班牙语、阿拉伯语等多种语言。

混合语言文本会根据主体语言判断翻译方向，品牌名、代码、URL、缩写等不会干扰语言识别。

---

### 📝 六种翻译模式

| 模式 | 适用场景 |
| --- | --- |
| 🤖 Auto | 根据内容自动判断最合适的翻译策略 |
| 💬 Natural | 日常表达、自然口语 |
| 📖 Literary | 小说、散文、文学文本 |
| 🎓 Academic | 论文、技术文档、研究材料 |
| 💼 Business | 商务邮件、正式沟通 |
| 💭 Comic | 漫画对白、气泡、旁白与拟声词 |

Auto 并不等同于 Natural。

它会根据文本内容、Context、Terminology、图片视觉信息与语言风格，在同一次请求中动态判断最合适的翻译策略。

---

## 🧠 Context 上下文消歧

同一句话，在不同场景下可能完全不是一个意思。

例如：

```text
这个窗口马上就要关了。
```

GUI 场景：

```text
That window is about to be closed.
```

项目时间窗口场景：

```text
The time window is about to close.
```

Context 只用于：

- 语义消歧
- 判断领域
- 判断人物关系
- 判断语气
- 判断术语含义
- 辅助视觉理解

Context **不会被直接翻译进正文，也不会被用于扩写原文不存在的信息**。

---

## 🏷️ Terminology 术语硬约束

支持显式指定固定译法：

```text
墨堤 -> MoDi Connect
广播 -> network broadcast
回连 -> reconnection
```

也支持保持专有名词原样：

```text
MoDi Connect -> 保持原样
Silvite Translate Lab -> 保持原样
```

Terminology 是翻译链路中的高优先级硬约束。

同时，系统会结合 Context 和实际语义判断术语是否真的适用于当前位置，避免简单粗暴的全文字符串替换。

例如：

```text
苹果发布后，窗口里的苹果也更新了。
```

系统可以根据上下文区分：

- Apple 公司
- 普通名词 apple

---

## 🖼️ 图片翻译

支持：

- JPG
- PNG
- WebP
- 海报
- UI 截图
- 漫画
- 普通图片文字

桌面端支持：

- 拖入图片
- 点击选择
- 剪贴板粘贴

移动端使用系统原生文件选择。

较大的图片会在浏览器侧进行压缩，以控制请求体积。

---

## 💭 Comic 漫画视觉理解

Comic Mode 不只是 OCR。

漫画翻译会尝试结合：

- Panel / 分镜
- Speech Bubble / 气泡
- Bubble Tail / 气泡尾巴
- Speaker / 说话人
- 人物位置
- 人物朝向
- 表情与动作
- 阅读方向
- 对话问答关系
- 对话语义承接
- Narration / 旁白
- Background Text / 背景文字
- Onomatopoeia / 拟声词

来理解漫画中的视觉叙事结构。

系统会尽量区分：

```text
dialogue
narration
sound_effect
title
caption
sign
background_text
ui_text
text
```

对于漫画对白，还可以使用结构化数据记录：

```json
{
  "panel": 2,
  "order": 3,
  "speaker": "女生",
  "type": "dialogue",
  "source": "ほんと？また言い訳じゃないの？",
  "translation": "真的？不会又是在找借口吧？"
}
```

最终展示不只是简单平铺 OCR 文本，而是尽量恢复真实的漫画阅读顺序和角色对话关系。

---

## 📚 Translation Notes 翻译说明

对于真正值得解释的翻译决策，模型会生成 Translation Notes。

例如：

- 专有名词处理
- Context 消歧
- Terminology 约束
- 文化表达
- 文学意象
- 学术证据强度
- 商务语气
- 漫画拟声词
- 特殊视觉语境

翻译说明开关只控制：

```text
显示 / 隐藏
```

不会因为切换开关再次请求模型。

Notes 数据始终保留，可用于结果查看与导出。

---

## 📤 本地导出

支持：

- 📄 PDF
- 📝 Word `.docx`

导出直接在浏览器侧完成。

不会为了导出再次调用模型。

导出内容可包含：

- 原文
- 译文
- 源语言
- 目标语言
- 翻译模式
- Context
- Terminology
- 图片识别文本
- Segments
- Translation Notes
- 生成时间

---

## 📱 Responsive UI

Silvite Translate Lab 针对 Desktop 与 Mobile 使用不同的布局策略。

移动端并不是简单把桌面 UI 压缩到更小宽度，而是重新组织：

- 输入模式
- 翻译模式
- 高级设置
- 主操作按钮
- 图片选择
- 结果操作
- Translation Notes
- 导出功能

目标是让第一次使用的用户不需要阅读复杂说明，也能自然完成主要操作。

---

## 🧪 Demo Samples

项目内置多组演示样本，用于快速体验不同能力：

- 💬 日常表达
- 🧠 上下文消歧
- 🏷️ 术语约束
- 🎓 学术文本
- 💼 商务邮件
- 📖 文学片段
- 🛡️ 品牌与专名
- 🌏 日文识别
- 🖼️ 图片海报
- 💭 漫画对白

Demo 数据与真实用户翻译状态相互隔离。

这些样本只是能力展示，不会伪装成用户历史记录。

---

# 🏗️ Architecture

```text
┌─────────────────────────────┐
│          Browser            │
│                             │
│ React + TypeScript + Vite   │
│ Tailwind CSS + Zustand      │
└──────────────┬──────────────┘
               │
               │ POST /api/translate
               ▼
┌─────────────────────────────┐
│       EdgeOne Pages         │
│                             │
│ Static Frontend             │
│ +                           │
│ Node.js Cloud Function      │
└──────────────┬──────────────┘
               │
               │ Server-side API
               ▼
┌─────────────────────────────┐
│      Xiaomi MiMo V2.5       │
│                             │
│ Text + Multimodal Model     │
└─────────────────────────────┘
```

---

## ⚛️ Frontend

- React 19
- TypeScript
- Vite 8
- Tailwind CSS 4
- Zustand

---

## ☁️ Backend

- EdgeOne Pages
- EdgeOne Cloud Functions
- Node.js 20 Runtime（单次执行上限 120 秒）
- Xiaomi MiMo V2.5

API：

```text
POST /api/translate
```

主要 Cloud Function：

```text
cloud-functions/api/translate.js
```

Prompt：

```text
cloud-functions/api/prompts.mjs
```

### 翻译请求生命周期（Streaming）

后端以 `stream: true` 调用 MiMo，消费其 SSE 后转换成 Silvite 自有的
SSE 事件协议返回（`text/event-stream`）。前端永远看不到 MiMo 协议细节。

事件类型（一行一个 JSON）：

| 事件 | 说明 |
| --- | --- |
| `start` | `{ mode }` 请求已受理 |
| `delta` | `{ text }` 临时译文增量（仅文本/图片模式；Comic 抑制） |
| `reset` | `{ reason }` 首次尝试失败（截断、格式异常或断流），临时文本作废 |
| `final` | `{ result }` 唯一权威结果（canonical） |
| `error` | `{ code, message }` 分类失败，中文提示 |

职责边界：

- **流式只负责体验**：`delta` 是临时文本（provisional），协议 JSON 永远不会
  以任何形式流给用户（后端有增量 translation extractor，只解码
  `"translation"` 字段值，escape/unicode 全量解码，notes/segments 不泄漏）。
- **canonical final result 才是真相**：无论流式与否，最终都走同一条
  parse/repair → 语言路由 → Comic `reply_to` 强制 + 确定性重建 → sanitize。
- **截断防护**：`finish_reason === 'length'` 或结构化 JSON 解析失败 → 绝不
  raw fallback；自动以加倍预算重试一次，仍失败则报
  `OUTPUT_TRUNCATED`（译文过长）。
- **断流防护**：MiMo SSE 抛错或未携带终止原因就结束时，后端清空临时文本并
  以原预算重试一次；浏览器到 Serverless 的连接中断时，前端同样清空临时文本并
  自动重新请求一次。收到 `final` 后立即停止读取，避免连接尾部异常误伤完整结果。
- **Thinking 关闭**：翻译请求显式 `thinking: { type: 'disabled' }`（MiMo
  V2.5 默认开启，会挤占输出预算并把 temperature 强制为 1.0）。
- **输出预算**：`getCompletionBudget()` 按输入长度/图片/模式给出
  4096–32768，`MAX_COMPLETION_TOKENS` 可覆盖（clamp [1024, 65536]），用户
  不可控。
- **长文管线**：文本及文件正文统一按标题、段落、句子优先分块；每块独立请求，
  95 秒软截止后只细分当前部分，已完成译文不会丢失。最终仅生成一个 canonical result。
- **失败分类**：`OUTPUT_TRUNCATED` / `MODEL_EMPTY_RESPONSE` /
  `MODEL_FORMAT_FAILURE` / `MODEL_UPSTREAM_ERROR` / `MODEL_STREAM_INTERRUPTED`
  等仅在内部日志与错误码中区分，用户只看到中文提示；后端与前端传输层各自最多自动重试 1 次。

---

## 📦 Export

使用：

- `jsPDF`
- `docx`

在浏览器侧生成 PDF 与 Word 文档。

## 📄 文件输入

不需要先选择输入类型：**直接拖入、粘贴，或点击「选择本地文件」**即可，程序按文件自身类型决定处理方式（图片走图片翻译，文档走长文翻译）。附件以一个紧凑的条目显示，可随时移除；没有多余的格式入口或模式切换。

支持的格式：

```text
PDF · DOCX · DOC · PPTX · PPT · XLSX · TXT · Markdown · CSV · SRT / VTT / ASS 字幕 · JPG / PNG / WebP 图片
```

文件全部在浏览器本地解析，提取正文后复用与普通文本完全相同的长文翻译管线。体积上限
为 Office 文件 25MB、其他格式 10MB，提取正文最多 100,000 字符（Office 文件常含图片，
因此允许更大的文件体积）。

几处与格式相关的处理：

- **PDF**：只读取文本层。若字体缺少 Unicode 映射导致提取不出正文，会给出明确提示，
  并可选用「视觉翻译」把每页渲染成图片逐页识别（一次最多 20 页，逐页发送图片）。
- **提取的字符会做归一化**：某些 PDF 会把汉字映射成部首码位（`倒数⽇`、`⻓期`），
  归一化会还原为 `倒数日`、`长期`。
- **字幕**：只翻译正文，序号与时间轴原样保留；VTT 的 `NOTE`/`STYLE` 块、ASS 的样式段
  与 `{\i1}` 之类的标签不会发送给模型。
- **旧版 XLS** 暂不支持，会提示另存为 `.xlsx`。

---

# 🔐 Security

MiMo API Key **不会进入前端 Bundle**。

API Key 只存在于 EdgeOne Function 的服务器端环境变量：

```text
MIMO_API_KEY
```

调用链：

```text
Browser
   ↓
POST /api/translate
   ↓
EdgeOne Cloud Function
   ↓
MiMo API
```

因此真实 API Key 不会暴露给前端 JavaScript。

---

# 🚀 Local Development

## 1. Clone

```bash
git clone https://github.com/LaoYinBai/Silvite-Translate-Lab.git
cd Silvite-Translate-Lab
```

---

## 2. Install

```bash
npm ci
```

---

## 3. Environment

创建：

```text
.env.local
```

写入：

```env
MIMO_API_KEY=your_api_key_here
SERVICE_ENABLED=true
RATE_LIMIT=30
```

`.env.local` 已被 Git 忽略。

请勿提交真实 API Key。

---

## 4. Start Local API

```bash
npm run api
```

默认：

```text
http://localhost:3001
```

---

## 5. Start Frontend

另开一个终端：

```bash
npm run dev
```

默认：

```text
http://localhost:5173
```

开发环境下，Vite 会将 `/api` 请求代理至本地 API 服务。

---

# 🧪 Test

运行：

```bash
npm test
```

测试覆盖主要包括：

- Prompt composition
- Translation handler
- Language routing
- Terminology parsing
- Context behavior
- API response handling
- Core translation constraints

---

# 🔍 Lint

```bash
npm run lint
```

---

# 📦 Build

```bash
npm run build
```

构建流程：

```text
TypeScript
   ↓
Vite Build
   ↓
dist/
```

最终静态文件输出：

```text
dist/
```

---

# ☁️ Deploy with EdgeOne Pages

项目可以直接部署至 EdgeOne Pages。

推荐配置：

```text
Framework: Vite

Install Command:
npm ci

Build Command:
npm run build

Output Directory:
dist
```

然后在 EdgeOne 项目环境变量中配置：

```env
MIMO_API_KEY=...
```

可选变量：

```env
SERVICE_ENABLED=true
ALLOWED_ORIGIN=...
RATE_LIMIT=...
RATE_LIMIT_WINDOW_MS=...
MAX_INPUT_LENGTH=...
```

EdgeOne Cloud Functions 会将：

```text
cloud-functions/api/translate.js
```

映射为：

```text
/api/translate
```

---

# 🗂️ Project Structure

```text
Silvite-Translate-Lab/
│
├── cloud-functions/
│   └── api/
│       ├── prompts.mjs
│       └── translate.js
│
├── public/
│   ├── demo/
│   └── icons/
│
├── scripts/
│
├── src/
│   ├── api/
│   ├── components/
│   ├── demo/
│   ├── services/document/
│   ├── store/
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
│
├── tests/
│
├── edgeone.json
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

# 🎯 Design Philosophy

Silvite Translate Lab 的目标不是简单堆积 AI 功能。

它更关注几个问题。

---

## 1️⃣ Accuracy First

```text
准确 > 自然 > 风格
```

翻译可以自然。

但自然不能以改变原意为代价。

尤其在：

- Academic
- Business
- Terminology

等场景中，需要尽量保持原文的：

- 条件
- 否定
- 推测
- 程度
- 责任
- 证据强度

---

## 2️⃣ Context Matters

翻译不是孤立处理字符串。

同一句话真正表达什么，可能取决于：

- Context
- Terminology
- 专业领域
- 人物关系
- 文本用途
- 图片内容
- 漫画人物
- 视觉布局

因此模型需要理解：

```text
What does this sentence mean here?
```

而不仅仅是：

```text
What does this sentence literally say?
```

---

## 3️⃣ AI for Understanding, Code for Determinism

这是项目中一个非常重要的设计原则。

AI 更擅长：

- 语言理解
- 上下文判断
- 文体判断
- 图片理解
- 漫画视觉叙事
- 语义消歧

代码更擅长：

- 状态管理
- 数据结构
- 输入验证
- UI 行为
- 导出
- API 安全
- 确定性结果组织

因此 Silvite Translate Lab 尽量避免让模型承担本可以由代码稳定完成的工作。

例如漫画模式：

```text
MiMo
  ↓
理解 Panel / Speaker / Order / Dialogue
  ↓
返回结构化 Segments
  ↓
Code
  ↓
确定性组织最终漫画译文
```

即：

> **AI 负责理解，代码负责收口。**

---

## 4️⃣ Context Is for Understanding, Not Expansion

Context 只帮助模型理解原文。

不会因为 Context 中存在额外信息，就把它擅自加入译文。

例如：

```text
Source:
这个窗口马上就要关了。

Context:
这里的窗口指项目时间窗口。
```

正确：

```text
The time window is about to close.
```

而不是：

```text
The project's available time window is about to close.
```

因为“项目”并不存在于原文中。

---

## 5️⃣ Terminology Is a Constraint, Not Search & Replace

术语系统不是简单字符串替换。

例如：

```text
苹果 = Apple
```

并不意味着全文所有“苹果”都必须变成品牌 Apple。

系统仍然需要结合：

- Context
- 当前语义
- 实际指代

逐处判断。

---

# 🌐 Language Routing

当前语言路由规则：

```text
中文
  ↓
英语

英语
  ↓
中文

其他语言
  ↓
中文
```

UI 中语言名称统一使用中文显示。

例如：

```text
日语 → 中文

法语 → 中文

西班牙语 → 中文

阿拉伯语 → 中文

中文 → 英语

英语 → 中文
```

不会混用：

```text
日本語
Français
Español
AR
```

等语言自身名称或代码作为主要 UI 标签。

---

# 🧭 Project Status

> 🧪 Experimental

Silvite Translate Lab 当前仍然是实验性项目。

它已经可以用于实际翻译、图片处理和演示场景，但 AI 翻译仍可能出现错误。

尤其是：

- OCR 识别错误
- 极复杂图片版面
- 漫画气泡归属
- 漫画阅读顺序
- 极少见语言
- 专业领域特殊术语
- 正式官方译名
- 高歧义文本

对于重要内容，请人工复核最终译文。

---

# 🤝 Contributing

Issue 与 Pull Request 都欢迎。

如果发现：

- 🐛 Bug
- 🧠 Prompt 边界问题
- 🌐 语言识别问题
- 🏷️ Terminology 问题
- 🖼️ 图片识别问题
- 💭 Comic 阅读顺序问题
- 📱 Mobile UI 问题
- 🎨 UI / UX 问题

欢迎提交 Issue。

如果是翻译问题，建议同时提供：

```text
Source
Mode
Context
Terminology
Expected Result
Actual Result
```

这样更方便复现问题。

---

# 📄 License

本项目使用 MIT License。

详见：

```text
LICENSE
```

---

<div align="center">

## ✨ Silvite Translate Lab

**让翻译多理解一点上下文，少一点机械替换。**

Built with ❤️ using React, EdgeOne & Xiaomi MiMo.

</div>
