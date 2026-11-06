# 实时翻译 Beta 架构

更新日期：2026-11-06

## 目标与边界

本功能提供语音转文字和可修订双语字幕。默认使用浏览器内的 Whisper Tiny，且默认“仅转文字”；
这一模式不需要 API Key 或转换后端，音频及识别文字不上传。可选在线 MiMo 识别；开启双语翻译时，
识别文字通过现有 EdgeOne Cloud Functions 翻译。浏览器不持有 MiMo 密钥。当前不提供朗读、
音频保存或跨会话字幕历史。

部署平台没有可以从本仓库可靠配置并验证的 Cloud Function 持久 WebSocket 会话，因此采用：

```text
麦克风 → AudioWorklet → VAD / WAV 短片段
       → 本机 Whisper Worker（WebGPU / CPU WASM）→ 识别文字
       或
       → POST /api/realtime/transcribe → MiMo ASR SSE
       → 本站带 sequence/revision 的 partial/final SSE
       → 重叠合并 → 临时字幕
       → 仅转文字：本地确认字幕
       或 → 独立翻译队列 → POST /api/realtime/translate → MiMo V2.6 Flash SSE
                     → 可修订译文草稿 → 句末确认字幕
```

在线识别的每个音频窗独立发起 POST 与 SSE 请求。本机 Whisper 为短片段批次推理，识别完一段再更新，
不提供逐字流式识别。

## 模型与接口

| 用途 | 路径 | 模型 | 调用行为 |
| --- | --- | --- | --- |
| 普通文本/图片/文档翻译 | `POST /api/translate` | `mimo-v2.6-flash` | 既有 OpenAI-compatible SSE 及 canonical final 保持不变 |
| 本机语音识别（默认） | 浏览器 Worker | 多语 `onnx-community/whisper-tiny` | GPU 用 fp32 encoder / q4 decoder，CPU 用 q8；本站静态资源、无语音 API 请求 |
| 实时语音识别 | `POST /api/realtime/transcribe` | `mimo-v2.5-asr` | 仅接受 WAV PCM16/16kHz/mono；服务端向上游提交单段音频并将 SSE 转为自有 partial/final 事件 |
| 实时语段翻译 | `POST /api/realtime/translate` | `mimo-v2.6-flash` | JSON 请求、start/delta/final/error SSE 响应；`thinking: {type: "disabled"}`，最多带之前 8 条语段 |

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
- 本机 Whisper 覆盖窗口为 6000 ms、overlap 800 ms、静音确认 650 ms，短句在停顿时提前提交。
  分窗前先保留真实重叠采样及未消费尾部，避免只重叠时间戳却丢失实际音频。
- 用户点击开始时先解锁 AudioContext，再异步加载模型，模型就绪后才请求麦克风；这样避免首次模型
  下载耗尽移动 Safari 的用户手势。取消、权限延迟返回及卸载时均关闭采集资源。
- 音频 chunker 先在时间窗边界切分，停顿/停止时提交最后一个有语音的片段；纯静音不请求 ASR。

## 字幕数据与状态机

核心位于 `src/services/realtime/session.ts`。字幕段包含：

```ts
{
  id, sequence, startTime, endTime,
  sourceText, stableSourceText, translatedText,
  sourceLanguage, targetLanguage,
  status: 'provisional' | 'confirmed', revision,
  translationStatus: 'off' | 'queued' | 'streaming' | 'draft' | 'confirmed' | 'error',
  translationRequestId, translationSourceRevision, translationRevision, translationError
}
```

会话状态包括：`idle`、`preparing-model`、`requesting-microphone`、`listening`、`recognizing`、`translating`、
`backpressure`、`network-reconnecting`、`network-disconnected`、`rate-limited`、`paused`、
`recognition-failed`、`stopping`、`error`。本机推理失败不显示成网络故障；暂停后的结果确认也不能将状态覆盖为聆听。

每个 ASR 窗口有递增 `sequence`；语段 `id` 独立于窗口，同一句跨窗口时不更换 ID。`revision`
跟随本句完整源文快照递增，相同文本不产生重复修订。源文相邻窗口的相同前缀写入 `stableSourceText`，
只是稳定性启发式，不保证语义准确；第一阶段只将句末有效完成的译文视为确认结果。

`translationScheduler.ts` 独立消费翻译任务：一个在途请求，每句一个最新待译草稿，句末任务按序保留。
草稿间隔为 1050 ms，保留末次执行定时器；句末任务取消过时草稿并优先处理。Provider 忽略取消时，
旧任务的回调和完成结果也不能更新字幕。请求携带 utteranceId / revision / requestId / stage，重试
另加 attempt 后缀；字幕同时检查会话代次、语段修订和当前请求，避免跨句或跨会话串写。

静音、停止、窗口结果的句末标点及 20 秒语段触发确认。源文超过 1200 字符按附近标点/空白切段，
保留全部余文，避免超出接口 1800 字符限制。连续窗口确认后保留源文尾部用于去除音频重叠；
真正静音或手动暂停后清空这个尾部，避免抹掉下一次讲话。标点与重叠识别均是启发式规则。

源文结束后立即进入「字幕记录」，译文可处于排队、生成中或失败。只有 `translationStatus: confirmed`
表示译文已确认；新句的识别不等待旧句翻译。失败保留源文和未确认草稿，可按句或批量重试。

相邻窗口用 `mergeTranscriptOverlap()` 对规范化后的汉字/拉丁字母/数字做后缀-前缀匹配，忽略
标点与大小写漂移，并保留原始译写及标点；英文无 overlap 时以空格衔接，汉字按中文文本衔接。
这是一种轻量确定性合并，不是 ASR 词级强制对齐。

## 翻译上下文

实时专用 Prompt 在 `cloud-functions/api/realtime/prompts.mjs`，不复用长文翻译的大型结构化 Prompt。
请求由系统规则、用户稳定 Context、Terminology/专名约束、之前最多 8 条语段和当前待译语段组成。
上下文在任务实际开始时读取，只包含当前语段之前的源文；未确认译文以空值传递，不能把草稿当成历史事实。
Provisional 只翻译当前完整源文快照；句末以 `confirmed` 阶段重新生成并替换草稿。
会话历史目前只在内存中保留；没有生成长期摘要。

## Provider 边界

`src/services/realtime/providers.ts` 定义 `ASRProvider`、`TranslationProvider` 和预留的
`TTSProvider`。ASR 支持 `WhisperASRProvider` 与 `XiaomiRealtimeASRProvider`，翻译使用
`XiaomiRealtimeTranslationProvider`。ASR 可提供 prepare / dispose、执行位置和分窗参数；本机模型
加载、GPU/CPU 推理在 `whisper.worker.ts`，取消时终止 Worker，重开时创建新实例。界面只依赖
Provider；TTS 目前只有接口。

移动触控设备默认 CPU 兼容模式；桌面默认自动选择 GPU，GPU 缺失或推理失败时尝试 CPU。
用户可主动选择 CPU。模型下载与发布步骤见 [Whisper 静态交付](realtime-whisper.md)。

未来替换为持续 WebSocket ASR 时，只需替换 ASR Provider 与传输适配，不要求改变字幕段和翻译
Provider；如启用 TTS，应只朗读确认后的译文，避免朗读临时修订内容。

## 并发、限流与错误恢复

- ASR 消费为有界串行队列，最多 3 个等待音频窗；队列接近上限时停用麦克风轨道，积压回落后恢复，
  已经交付的 Worklet 尾部继续保留，因此瞬时可能多出尾窗。待确认译文达到 12 段时也暂停收音，
  ASR 继续处理已采集音频；不会为了腾队列而丢掉句末任务。采集暂停期间说的话无法记录，界面明确提示。
- ASR / 翻译网络错误、408、429、5xx 使用最多 2 次指数退避重试，并加入 jitter；用户可显式重试
  超过自动上限后保留的当前音频窗或最终修订。429 显示节流状态，不无限重试。
- 用户停止时先停麦克风并 flush 尚有价值的音频窗，处理 ASR 后将最后一段交给独立翻译队列，
  收音已结束但剩余译文可继续整理；识别失败则保留音频和原文以供重试。组件卸载时
  abort ASR/翻译、释放 AudioWorklet、AudioContext 和 MediaStream tracks。
- 若上游 ASR SSE 在没有 `[DONE]` 或 `finish_reason: stop` 时正常 EOF，不把 partial 当 final，
  返回 `ASR_STREAM_INTERRUPTED` 以进入有限重试。
- ASR SSE 事件 `{type, sequence, revision, text}`；实时译文事件包含 utteranceId / sequence / revision /
  requestId / stage，delta 另带 UTF-16 累计 offset，final 带完整 text；不改普通翻译既有 SSE 协议。
- 译文客户端处理跨包 UTF-8、CRLF/CR、多行 SSE 与重复 offset；错误 offset、缺少 final、上游
  异常 EOF、length/content_filter 截断均不能确认成功。单次请求客户端 30 秒、服务端 28 秒超时，
  失败进入有限重试；每次重试重置本轮累积器，并保留上一份有效草稿，收到新文本后整条替换。
  无效协议文本不会作为回退草稿；历史字幕不变。
- 翻译服务端同样兼容无 Request.signal 的云运行时。下游流取消、外部 signal 与超时均取消上游并释放 reader。
- 取消启动会保持忙状态直到权限请求和采集清理完成；设置与开始按钮保持禁用，开始动作再次同步当前设置。
  快速暂停/恢复使用操作代次，旧暂停的排空回调不能确认或清空恢复后的新语段。
- 在线 ASR 不能假定云运行时存在 `Request.signal`：不存在时仍使用上游 AbortController，存在时继续传递取消。

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
`tests/realtimeSession.test.mjs` 包含 20 秒模拟输入、字幕顺序、pause/stop、过期译文保护和
429 手动恢复；`tests/realtimeHandlers.test.mjs` 与 `tests/realtimeClient.test.mjs` 覆盖服务端模型
调用、thinking 关闭、WAV 验证、SSE 与响应 sequence 校验。以上是仓库测试覆盖内容，
本轮未执行自动测试或真实 MiMo 调用；本轮检查及交付范围见 [流式字幕实施记录](realtime-streaming.md)。

当前限制：

- 需要 HTTPS/localhost、麦克风权限和 AudioWorklet 支持；没有 MediaRecorder/WebM 回退。
- 采集延迟、RMS 阈值、模型速度与合并质量会受设备、噪声和语言影响；本机短片段模式不保证固定时延。
- Tiny 优先下载量和运行成本，中文可能有同音字误识别、简繁混合；人名、术语和课堂语料需要复核。
- 只有中文/英文/auto；不做方言专用识别、说话人分离、会议级 diarization、TTS、音频保存和摘要。
- 目前没有跨函数实例的全局会话/队列，也不支持浏览器重载后恢复。
- 只有在线识别或文字翻译需要服务端 `MIMO_API_KEY`。本机仅转文字在已打开页面、所需模型与运行组件
  已加载后可以断网继续；不承诺页面离线重载或切换到尚未下载的设备模型。
- [2026-11-06 STT 检查记录](research/2026-11-06-stt-verification.md) 区分线上故障、本地修复、
  浏览器真实模型推理与手机尺寸模拟；实际 iOS/Android 麦克风及持续性能仍需真机验收。

## 社区实现依据与后续工作

[社区源码与接入建议](research/2026-11-06-streaming-interpretation.md) 记录了 LocalAgreement、
WhisperLiveKit/NLLW、AlignAtt4LLM 和浏览器 TextStreamer 的实现方式。本次已接入独立调度、
在线译文流、可修订草稿与句末确认；仍沿用黑盒文本翻译，未复现需要模型内部注意力的 AlignAtt。
后续浏览器本机翻译可接同一 Provider；TTS 仍只有接口。
