# 实时翻译 Beta 架构

更新日期：2026-09-23

## 目标与边界

本功能是面向短对话/演讲的可修订双语字幕 MVP，不是零延迟会议同传。它复用当前 EdgeOne
Cloud Functions 与 Xiaomi MiMo API Key，不改变普通文本、图片和文档翻译链路。浏览器不连接
MiMo，也不持有密钥。MVP 暂不朗读译文、不存储音频，也不提供跨会话字幕历史。

部署平台没有可以从本仓库可靠配置并验证的 Cloud Function 持久 WebSocket 会话，因此采用：

```text
麦克风 → AudioWorklet → VAD / WAV 短片段
       → POST /api/realtime/transcribe → MiMo ASR SSE
       → 本站带 sequence/revision 的 partial/final SSE
       → 重叠合并 → 临时字幕
       → POST /api/realtime/translate → MiMo V2.6 Flash
       → 确认字幕
```

每个音频窗独立发起 POST 与 ASR SSE 请求，不依靠 heartbeat 延长函数生命周期。

## 模型与接口

| 用途 | 路径 | 模型 | 调用行为 |
| --- | --- | --- | --- |
| 普通文本/图片/文档翻译 | `POST /api/translate` | `mimo-v2.6-flash` | 既有 OpenAI-compatible SSE 及 canonical final 保持不变 |
| 实时语音识别 | `POST /api/realtime/transcribe` | `mimo-v2.5-asr` | 仅接受 WAV PCM16/16kHz/mono；服务端向上游提交单段音频并将 SSE 转为自有 partial/final 事件 |
| 实时语段翻译 | `POST /api/realtime/translate` | `mimo-v2.6-flash` | 单语段 JSON 请求/响应，`thinking: {type: "disabled"}`，最多带最近 8 条确认字幕 |

两个实时 handler 使用服务端 `MIMO_API_KEY`；请求日志不记录 key 或 Base64 音频。实时识别语言
仅接受 `auto`、`zh`、`en`。源语言 `auto` 用识别文本中的汉字/拉丁字母比例在 zh/en 间归类；
目标语言 `auto` 选择相反语言。

## 音频采集与窗口

实现位于 `src/services/realtime/audio.ts` 与 `public/audio-capture-processor.js`：

- `AudioWorklet` 只把短暂 Float32 单声道块送给主线程，不写入持久存储；上下文优先请求 16 kHz，
  不支持时在线性插值重采样至 16 kHz。
- WAV 编码为标准 RIFF、PCM、16-bit、mono、16 kHz；服务端在调用 MiMo 前再次校验 RIFF/WAVE、
  编码、声道、采样率和位深。
- RMS 能量 VAD 忽略静音，短静音保留为停顿判断；保留短前滚以避免切掉句首。
- 当前参数集中在 `src/services/realtime/config.ts`：采集窗 2200 ms、overlap 350 ms、静音确认
  520 ms、最短有效语音 360 ms、前滚 160 ms、RMS 阈值 0.012。它们是 MVP 默认值，应根据开发态
  实测调优，不代表所有环境的最优延迟。
- 音频 chunker 先在时间窗边界切分，停顿/停止时提交最后一个有语音的片段；纯静音不请求 ASR。

## 字幕数据与状态机

核心位于 `src/services/realtime/session.ts`。字幕段包含：

```ts
{
  id, sequence, startTime, endTime,
  sourceText, translatedText,
  sourceLanguage, targetLanguage,
  status: 'provisional' | 'confirmed', revision
}
```

会话状态包括：`idle`、`requesting-microphone`、`listening`、`recognizing`、`translating`、
`backpressure`、`network-reconnecting`、`network-disconnected`、`rate-limited`、`paused`、
`stopping`、`error`。

每个 ASR 窗口有单调递增 `sequence`；同一流式识别请求的文本更新有递增 `revision`。翻译请求
携带同一语段的 sequence/revision/stage。新修订会 abort 旧临时翻译；即使 Provider 忽略 abort，
返回仍须匹配当前 sequence 与 revision 才能更新 UI。确认历史只追加，不被后续临时结果覆盖。

相邻窗口用 `mergeTranscriptOverlap()` 对规范化后的汉字/拉丁字母/数字做后缀-前缀匹配，忽略
标点与大小写漂移，并保留原始译写及标点；英文无 overlap 时以空格衔接，汉字按中文文本衔接。
这是一种轻量确定性合并，不是 ASR 词级强制对齐。

## 翻译上下文

实时专用 Prompt 在 `cloud-functions/api/realtime/prompts.mjs`，不复用长文翻译的大型结构化 Prompt。
请求由系统规则、用户稳定 Context、Terminology/专名约束、最近最多 8 条确认双语字幕和当前
待译语段组成。Provisional 只返回当前语段译文；停顿或停止时以 `confirmed` 阶段修订一次，随后
写入确认历史。会话历史目前只在内存中保留；没有生成长期摘要。

## Provider 边界

`src/services/realtime/providers.ts` 定义 `ASRProvider`、`TranslationProvider` 和预留的
`TTSProvider`。当前分别由 `XiaomiRealtimeASRProvider`、`XiaomiRealtimeTranslationProvider`
调用 `src/api/realtimeClient.ts`；界面依赖 Provider 接口，不直接拼模型 URL。TTS 只有接口，
本轮没有语音合成实现。

未来替换为持续 WebSocket ASR 时，只需替换 ASR Provider 与传输适配，不要求改变字幕段和翻译
Provider；如启用 TTS，应只朗读确认后的译文，避免朗读临时修订内容。

## 并发、限流与错误恢复

- ASR 消费为有界串行队列，最多 3 个等待音频窗；队列接近上限时停用麦克风轨道，积压回落后恢复，
  不创建无界 Promise 队列。
- ASR / 翻译网络错误、408、429、5xx 使用最多 2 次指数退避重试，并加入 jitter；用户可显式重试
  超过自动上限后保留的当前音频窗或最终修订。429 显示节流状态，不无限重试。
- 用户停止时先停麦克风并 flush 尚有价值的音频窗，处理可完成请求后确认最后一段。组件卸载时
  abort ASR/翻译、释放 AudioWorklet、AudioContext 和 MediaStream tracks。
- 若上游 ASR SSE 在没有 `[DONE]` 或 `finish_reason: stop` 时正常 EOF，不把 partial 当 final，
  返回 `ASR_STREAM_INTERRUPTED` 以进入有限重试。
- ASR SSE 事件 `{type, sequence, revision, text}`；实时翻译是 JSON，不改普通翻译既有 SSE 协议。

实时 API 限流环境变量：`REALTIME_ASR_RATE_LIMIT`（默认 90）、
`REALTIME_TRANSLATE_RATE_LIMIT`（默认 60）、`REALTIME_RATE_LIMIT_WINDOW_MS`（默认 60000）。
目前是实例进程内窗口，不是跨实例全局 RPM 配额；EdgeOne 多实例部署时，平台级 quota 仍是最终约束。

## 观测与隐私

开发态 UI 展示 chunk 时长、ASR 总/首响应时间、翻译时间、近似端到端时间、字幕修订数、丢弃的
过期响应、重试次数和 429 次数。延迟使用实际浏览器计时数据；单测中的模拟 Provider 不代表真实
公网延迟。服务端不会打印音频 Base64 或完整 API key。原始音频只在内存与当次请求中临时存在，
页面退出时释放浏览器资源。

## 测试与当前限制

`tests/realtimeAudio.test.mjs` 覆盖 WAV、重采样、VAD、窗口 overlap、识别合并和语言路由；
`tests/realtimeSession.test.mjs` 使用 20 秒模拟输入验证字幕顺序、pause/stop、过期译文保护和
429 手动恢复；`tests/realtimeHandlers.test.mjs` 与 `tests/realtimeClient.test.mjs` 覆盖服务端模型
调用、thinking 关闭、WAV 验证、SSE 与响应 sequence 校验。

当前限制：

- 需要 HTTPS/localhost、麦克风权限和 AudioWorklet 支持；没有 MediaRecorder/WebM 回退。
- 采集延迟、RMS 阈值与字级对齐会受设备、噪声和语言影响；MVP 以约 1.5–3 秒体感为目标，不
  保证固定时延。
- 只有中文/英文/auto；不做方言专用识别、说话人分离、会议级 diarization、TTS、音频保存和摘要。
- 目前没有跨函数实例的全局会话/队列，也不支持浏览器重载后恢复。
- 必须在目标 EdgeOne 项目环境配置服务端 `MIMO_API_KEY`，并在真实浏览器授予麦克风权限后完成
  真实语音 API smoke test；离线自动化不会伪造这项外部验收。
