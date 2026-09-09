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
    context: '这是一张产品宣传海报（跨设备音频互联软件"墨堤"，水墨国风），请结合版面结构识别标题、副标题、特性列表与下载信息。',
    terminology: '墨堤 = MoDi Connect\nMoDi Connect = 保持原样',
    preserveProperNames: true,
    demoImage: '/demo/poster.jpg',
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: 'MoDi Connect (墨堤) — cross-device audio interconnection tool. Tagline: "Let devices connect, naturally — A More Connected Digital Life." Intro: "Let sound and inspiration flow freely between devices." Features: multi-device pairing (phone ↔ computer); multi-source audio (microphone / system / mix); low-latency transfer (smooth and stable); multiple connection methods (LAN / Wi-Fi Direct / Bluetooth / USB). Poetic side copy: "Mountains and waters are never far apart — connections stay always on; from one device to more possibilities." Download: visit https://modiconnect.cn — open source and free, bringing devices closer. Closing line: "The meaning of connection is to give life one more possibility."',
      detectedText: '让设备，自然相连。\nA More Connected Digital Life\n墨堤\n跨设备音频互联工具\nMoDi Connect\n让声音与灵感，在不同设备间自由流动。\n多端互联 手机 ↔ 电脑\n多源音频 麦克风 / 系统 / 混音\n低延迟传输 流畅稳定\n多种连接方式 局域网 / Wi-Fi Direct / 蓝牙 / USB\n山水不远，连接常在。\n从一台设备到更多可能\n更自由 · 更简单 · 更贴近生活\n访问官网，下载体验 https://modiconnect.cn\n开源 · 免费 · 让设备更靠近\n连接的意义，是让生活多种可能。',
      segments: [
        seg('title', '墨堤 · 跨设备音频互联工具', 'MoDi Connect — Cross-Device Audio Interconnection Tool'),
        seg('text', '让设备，自然相连。', '"Let devices connect, naturally."'),
        seg('text', '让声音与灵感，在不同设备间自由流动。', '"Let sound and inspiration flow freely between devices."'),
        seg('text', '多端互联（手机 ↔ 电脑）', 'Multi-device pairing (phone ↔ computer)'),
        seg('text', '多源音频（麦克风 / 系统 / 混音）', 'Multi-source audio (microphone / system / mix)'),
        seg('text', '低延迟传输（流畅稳定）', 'Low-latency transfer (smooth and stable)'),
        seg('text', '多种连接方式（局域网 / Wi-Fi Direct / 蓝牙 / USB）', 'Multiple connection methods (LAN / Wi-Fi Direct / Bluetooth / USB)'),
        seg('text', '山水不远，连接常在。', '"Mountains and waters are never far apart — connections stay always on."'),
        seg('sign', '访问官网，下载体验 https://modiconnect.cn', 'Visit our website to download: https://modiconnect.cn'),
        seg('text', '连接的意义，是让生活多种可能。', '"The meaning of connection is to give life one more possibility."'),
      ],
      notes: [
        note('墨堤', 'MoDi Connect', '品牌名，按 Terminology 约束统一为正式英文名；画面中的书法大字与红印章属视觉元素，保持原样。'),
        note('山水不远，连接常在。', '"Mountains and waters are never far apart — connections stay always on."', '国风口号采用意象保留式意译：保留"山水"意象，"连接常在"以 always on 的英文习惯表达呼应。'),
        note('开源 · 免费 · 让设备更靠近', 'Open source and free — bringing devices closer.', '宣传短句按英文海报文案节奏断句，保留"更靠近"与"连接"的语义呼应。'),
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
    context: '这是轻松日常校园漫画，两位主角是熟人，对话语气自然，注意气泡对白、旁白与拟声词的不同处理方式。',
    demoImage: '/demo/comic.jpg',
    result: {
      source: 'demo',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: '【标题】\nThe Belated Promise\n\n【场景】\nDusk, at the school gate.\n\n【女生】\n"Why are you only showing up now?!"\n\n【男生】\n"The roads were jammed — I ran the whole way here!" *huff, huff*\n\n【女生】\n"Look at you — catch your breath first."\n\n【男生】\n"It\'s fine. When I promise you something, I show up."\n\n【女生】\n"Fine, let\'s get dinner. We can talk on the way."\n\n【男生】\n"Sure — my treat."\n\n【背景文字】\nXX University · "Youth blooms here." · "Good encounters arrive as promised."',
      detectedText: '迟到的约定\n傍晚，校门口。\n你怎么现在才来！\n路上堵死了，我已经一路跑过来了！\n呼——呼——\n看你这样子，先喘口气吧。\n没事，答应你的事我总得赶上。\n行吧，那先去吃饭，边走边说。\n好，我请你。',
      segments: [
        seg('title', '迟到的约定', 'The Belated Promise'),
        seg('narration', '傍晚，校门口。', 'Dusk, at the school gate.'),
        { type: 'dialogue', source: '你怎么现在才来！', translation: '"Why are you only showing up now?!"', speaker: '女生', panel: 1 },
        { type: 'dialogue', source: '路上堵死了，我已经一路跑过来了！', translation: '"The roads were jammed — I ran the whole way here!"', speaker: '男生', panel: 2 },
        { type: 'sound_effect', source: '呼——呼——', translation: '*huff, huff*', speaker: null, panel: 2 },
        { type: 'dialogue', source: '看你这样子，先喘口气吧。', translation: '"Look at you — catch your breath first."', speaker: '女生', panel: 3 },
        { type: 'dialogue', source: '没事，答应你的事我总得赶上。', translation: '"It\'s fine. When I promise you something, I show up."', speaker: '男生', panel: 3 },
        { type: 'dialogue', source: '行吧，那先去吃饭，边走边说。', translation: '"Fine, let\'s get dinner. We can talk on the way."', speaker: '女生', panel: 4 },
        { type: 'dialogue', source: '好，我请你。', translation: '"Sure — my treat."', speaker: '男生', panel: 4 },
      ],
      notes: [
        note('呼——呼——', '*huff, huff*', '拟声词：B 一路跑来喘气，按英文漫画习惯以斜体小字处理，不逐字直译。'),
        note('答应你的事我总得赶上', '"When I promise you something, I show up."', '口语化重述：show up 呼应前文的迟到语境，避免直译 catch up 带来的生硬感。'),
        note('先喘口气吧', '"catch your breath first"', 'A 的熟人口吻：用英语口语短语，而非书面化的 rest and breathe first。'),
        note('背景文字（校名 / 条幅）', '归入【背景文字】，不混入对白', '门牌"XX大学"与条幅"好的相遇总会如期而至"是环境信息，按漫画规则与对白分离。'),
      ],
    },
  },
];
