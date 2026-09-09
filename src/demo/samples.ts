import type { TranslationMode, TranslationNote, TranslationSegment, TranslationResult } from '../store/translationStore';

export type DemoIcon = 'message' | 'layers' | 'tag' | 'cap' | 'briefcase' | 'book' | 'shield' | 'globe' | 'image' | 'speech';

export interface DemoSample {
  id: string;
  title: string;
  description: string;
  icon: DemoIcon;
  inputType: 'text' | 'image';
  source: string;
  mode: TranslationMode;
  context?: string;
  terminology?: string;
  preserveProperNames?: boolean;
  demoImage?: string;
  result: TranslationResult;
}

const seg = (type: TranslationSegment['type'], source: string, translation: string): TranslationSegment => ({ type, source, translation });
const note = (source: string, translation: string, reason: string): TranslationNote => ({ source, translation, reason });

export const DEMO_SAMPLES: DemoSample[] = [
  {
    id: 'daily',
    title: '日常表达',
    description: 'Natural 翻译',
    icon: 'message',
    inputType: 'text',
    source: '这个周末如果天气不错，我们就出去走走吧，别老窝在寝室里。',
    mode: 'natural',
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: "If the weather's nice this weekend, let's get out and do something instead of staying cooped up in the dorm.",
      segments: [],
      notes: [],
    },
  },
  {
    id: 'context',
    title: '上下文消歧',
    description: 'Context aware',
    icon: 'layers',
    inputType: 'text',
    source: '这个窗口马上就要关了。',
    mode: 'auto',
    context: '这是项目开发讨论。"窗口"指当前可用的时间窗口，而不是软件界面窗口。',
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: 'The time window is about to close.',
      segments: [],
      notes: [
        note('窗口', 'time window', '根据 Context，此处指项目剩余的可用时间窗口，而非软件界面窗口。'),
      ],
    },
  },
  {
    id: 'terminology',
    title: '术语约束',
    description: 'Terminology 硬约束',
    icon: 'tag',
    inputType: 'text',
    source: '墨堤通过广播发现附近设备，并在断开后尝试自动回连。',
    mode: 'auto',
    context: '这是一个跨设备互联软件项目的技术说明。',
    terminology: '墨堤 = MoDi Connect\n广播 = network broadcast\n回连 = reconnection',
    preserveProperNames: true,
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: 'MoDi Connect discovers nearby devices via network broadcast and attempts to reconnect automatically after disconnection.',
      segments: [],
      notes: [
        note('墨堤', 'MoDi Connect', '根据 Terminology 保持产品正式名称。'),
        note('广播', 'network broadcast', '根据技术 Context，此处指局域网内的设备发现广播，而非 radio broadcasting。'),
        note('回连', 'reconnection', '按 Terminology 约束，指断开后的自动重新连接。'),
      ],
    },
  },
  {
    id: 'academic',
    title: '学术文本',
    description: 'Academic 模式',
    icon: 'cap',
    inputType: 'text',
    source: '实验结果表明，该方法能够在不显著增加计算复杂度的情况下提高系统的鲁棒性，但其长期稳定性仍需进一步验证。',
    mode: 'academic',
    context: '这是一篇工程类学术论文中的实验结果描述。',
    terminology: '鲁棒性 = robustness\n计算复杂度 = computational complexity',
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: 'The experimental results indicate that the proposed method improves the robustness of the system without significantly increasing computational complexity; however, its long-term stability remains to be verified.',
      segments: [],
      notes: [
        note('仍需进一步验证', 'remains to be verified', '保持原文的谨慎强度：仅指出尚待验证，未断言稳定性已确认。'),
        note('表明', 'indicate', '学术语域中 indicate 语气与原文相符，避免夸大为 demonstrate 或 prove。'),
      ],
    },
  },
  {
    id: 'business',
    title: '商务邮件',
    description: 'Business 模式',
    icon: 'briefcase',
    inputType: 'text',
    source: '感谢您的反馈。我们已经确认了当前版本存在的问题，并计划在本周五之前完成修复。如果进度发生变化，我们会第一时间通知您。',
    mode: 'business',
    context: '这是发给客户的正式商务邮件。',
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: 'Thank you for your feedback. We have confirmed the issue in the current version and plan to complete the fix by this Friday. Should there be any change in the schedule, we will notify you right away.',
      segments: [],
      notes: [],
    },
  },
  {
    id: 'literary',
    title: '文学片段',
    description: 'Literary 模式',
    icon: 'book',
    inputType: 'text',
    source: '雨停以后，街灯在湿漉漉的路面上拖出一条很长的影子。她没有回头，只是慢慢走进夜色里。',
    mode: 'literary',
    context: '这是现代小说中的叙事片段，语气克制，不需要过度文学化。',
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: "After the rain stopped, the streetlights dragged their long reflections across the wet pavement. She did not look back — she simply walked, slowly, into the night.",
      segments: [],
      notes: [
        note('拖出一条很长的影子', 'dragged their long reflections across the wet pavement', '湿路面上的光影实为倒影，译为 reflections 更符合物理意象；保留"拖"的缓慢质感。'),
      ],
    },
  },
  {
    id: 'proper-nouns',
    title: '品牌与专名',
    description: '专有名词保护',
    icon: 'shield',
    inputType: 'text',
    source: '我们计划将 Silvite Translate Lab 与 MoDi Connect 的部分实验能力结合起来。',
    mode: 'natural',
    context: 'Silvite Translate Lab 与 MoDi Connect 均为产品 / 项目名称。',
    terminology: 'Silvite Translate Lab = 保持原样\nMoDi Connect = 保持原样',
    preserveProperNames: true,
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: 'We plan to combine selected experimental capabilities of Silvite Translate Lab with those of MoDi Connect.',
      segments: [],
      notes: [
        note('Silvite Translate Lab', 'Silvite Translate Lab', '产品名，按 Terminology 保持原样。'),
        note('MoDi Connect', 'MoDi Connect', '产品名，按 Terminology 保持原样。'),
      ],
    },
  },
  {
    id: 'japanese',
    title: '日文识别',
    description: '自动译入中文',
    icon: 'globe',
    inputType: 'text',
    source: 'これは翻訳機能を確認するためのテストです。文脈を理解し、自然な中国語に翻訳してください。',
    mode: 'auto',
    context: '这是普通说明文字。',
    result: {
      source: 'demo',
      sourceLanguage: 'ja',
      targetLanguage: 'zh',
      translation: '这是用于确认翻译功能的测试。请理解上下文，并翻译成自然的中文。',
      segments: [],
      notes: [
        note('これは翻訳機能を確認するためのテスト', '这是用于确认翻译功能的测试', '源语言自动识别为日语，按语言路由规则译入中文。'),
      ],
    },
  },
  {
    id: 'poster',
    title: '图片海报',
    description: 'Image 翻译',
    icon: 'image',
    inputType: 'image',
    source: '',
    mode: 'auto',
    context: '这是一张活动宣传海报，请结合版面结构识别标题、正文、时间和地点。',
    terminology: 'MoDi Connect = 保持原样',
    demoImage: '/demo/poster.png',
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: 'Silvite Developer Meetup — AI Translation Tech Session (Vol. 3), jointly presented by MoDi Connect and Silvite. September 26, 2026 (Saturday), 14:00, at Yunqi Space, No. 88 Chuangxin Road, Hunnan District, Shenyang. Featuring live demos of multilingual translation, context disambiguation and terminology constraints. Free admission.',
      detectedText: 'MoDi Connect × Silvite 联合呈现\nSilvite 开发者沙龙\nAI 翻译技术分享 · 第 3 期\n2026 年 9 月 26 日（周六）14:00\n沈阳市浑南区创新路 88 号 · 云启空间\n多语言翻译 · 上下文消歧 · 术语约束\n现场演示与交流 · 免费报名参加',
      segments: [
        seg('title', 'Silvite 开发者沙龙', 'Silvite Developer Meetup'),
        seg('text', 'AI 翻译技术分享 · 第 3 期', 'AI Translation Tech Session (Vol. 3)'),
        seg('text', 'MoDi Connect × Silvite 联合呈现', 'Jointly presented by MoDi Connect and Silvite'),
        seg('sign', '2026 年 9 月 26 日（周六）14:00', 'September 26, 2026 (Saturday), 14:00'),
        seg('sign', '沈阳市浑南区创新路 88 号 · 云启空间', 'Yunqi Space, No. 88 Chuangxin Road, Hunnan District, Shenyang'),
        seg('text', '多语言翻译 · 上下文消歧 · 术语约束', 'Multilingual translation · Context disambiguation · Terminology constraints'),
      ],
      notes: [
        note('MoDi Connect', 'MoDi Connect', '按 Terminology 保持原样。'),
        note('云启空间', 'Yunqi Space', '场馆名为自拟活动信息，采用意译 + 保留拼音式处理，正式英文名以主办方公布为准。'),
      ],
    },
  },
  {
    id: 'comic',
    title: '漫画对白',
    description: 'Comic 模式',
    icon: 'speech',
    inputType: 'image',
    source: '',
    mode: 'comic',
    context: '这是轻松日常漫画，两个人是熟人，对话语气自然。',
    demoImage: '/demo/comic.png',
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: 'Caption: Ten minutes earlier.\nA: "Why are you only showing up now!"\nB: "The roads were jammed — I ran all the way here!" (huff—)',
      detectedText: '十分钟前。\n你怎么现在才来！\n路上堵死了，我已经跑过来了！\n呼——',
      segments: [
        seg('narration', '十分钟前。', 'Ten minutes earlier.'),
        seg('dialogue', '你怎么现在才来！', '"Why are you only showing up now!"'),
        seg('dialogue', '路上堵死了，我已经跑过来了！', '"The roads were jammed — I ran all the way here!"'),
        seg('sound_effect', '呼——', 'Huff—'),
      ],
      notes: [
        note('呼——', 'Huff—', '拟声词：角色 B 跑到后喘气声，按英文漫画习惯译为 Huff—，不逐字直译。'),
        note('路上堵死了', 'The roads were jammed', '熟人口吻，用口语化表达而非书面语 the traffic was heavily congested。'),
      ],
    },
  },
];
