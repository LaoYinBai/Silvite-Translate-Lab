# 浏览器中英流式语音转文字

2026-11-07：默认本地识别由 Whisper 窗口推理改为 sherpa-onnx Zipformer 持续解码。
网页保留现有字幕与翻译界面，默认“仅转文字”；中文、英文和中英夹杂可使用同一个模型。
只有主动选择在线 MiMo 才上传音频，开启双语字幕时仅识别文字发送给 DeepSeek / GLM。

## 模型与资源

- sherpa-onnx WASM SIMD **v1.12.33**，固定官方运行包 SHA-256。
- 模型为 `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`，encoder / decoder / joiner 均采用 int8，四个源文件逐一固定 SHA-256。
- 模型加词表 **49,752,335 字节**，WASM **11,549,006 字节**，两份 JS 约 143 KB；合计约 **61.4 MB**，不代表压缩后的网络传输量或浏览器总内存。
- 原始官方演示包内的模型约 199 MB，不进入网站。构建脚本从校验过的归档中只提取所需小模型和引擎，替换生成 loader 的虚拟文件清单，并把 JS 包装成 ES module。
- 官方引擎原先预留 512 MiB 线性内存；脚本严格解析固定构建的 memory section，将初始值改为 **128 MiB**，保留按需增长至 2 GiB。构建核验原结构和 WASM 有效性；这不是浏览器总内存上限。
- 模型拆为不超过 20,000,000 字节的三片，WASM 小于站点单文件限制；所有文件来自本站 `/asr/`。模型与 WASM 读取时逐片 SHA-256 校验，Cache API 按 revision 缓存，缓存损坏重取、缓存配额失败不阻止当次加载。
- 默认构建会移除历史生成的 `public/whisper/`；旧 Whisper 源码保留为历史参考，不再由实时页面引用，也不再打包其权重和运行组件。

```sh
npm run prepare:asr
npm run dev
npm run build
```

`predev` / `prebuild` 调用资源准备脚本。构建环境需要 Node、tar，以及对 GitHub 发布资源的访问；成品用户仅需浏览器，不需要本机程序或识别服务。资源归档缓存在被忽略的 `.cache/sherpa/`。官网公开发布包下载失败时构建脚本可使用 GitHub 官方资产 API；本机已有 `GH_TOKEN` 时仅用于构建下载，不写进资源或日志。

## 流式链路与可拆模块

```text
BrowserMicrophoneCapture / AudioWorklet
  → 约 40 ms 的 16 kHz 单声道 PCM 增量
  → ASRProvider.openStream()
  → SherpaStreamingASRProvider → Worker → OnlineRecognizer / OnlineStream
  → {utteranceId, revision, text, final, startTime, endTime}
  → RealtimeSessionEngine
  → 临时字幕 / 确认字幕 → 独立的翻译调度器
```

原生流式引擎持续接收新音频，不再把同一批重叠音频反复编码 WAV、创建独立识别请求。每次解码后的整句假设替换当前草稿，停顿端点或 20 秒长语段边界确认，避免将假设修订错误追加成重复文本。结束时补充静音并排空编码器 lookahead。

暂停先停止接收新麦克风内容、排出 Worklet 尾音，再结束当前识别流；继续时在同一引擎上创建新流。Worklet 暂停期间不再持续发送静音块，避免后台不断积压。模型准备和会话均可取消，销毁 Worker 释放资源。

主线程同时最多一个音频批次在途，其余新 PCM 暂存；积压超过 1.5 秒时暂停收音，回落到 0.4 秒继续，极限 12 秒缓冲触发可见错误。暂停期间的讲话无法录入，界面提示这一点。解码任务失败不自动上传音频，也不把已丢失的流状态伪装为可重试音频；已显示文本保留，提示结束后重开。

未来 Android 实现可复用 `StreamingASRHandlers` 和 `StreamingTranscript`，提供原生识别适配器；UI、字幕和翻译调度不依赖 sherpa 的 JS 类。是否将采音也放原生层由移动端实现决定，不要求经过 JavaScript 传输每一帧。

## 参考讯飞同传的公开实现方式

用户要求参照讯飞同传。采用的是公开协议中的连续音频、中间结果修订、分句标识与提前返回翻译的思路，没有接入讯飞收费服务，也没有声称复现其专有模型或达到同等准确率/延迟。

- [讯飞实时转写](https://www.xfyun.cn/doc/asr/rtasr/API.html) 建议每 40 ms 输入 16 kHz / PCM16 单声道数据，并提供中间过程翻译策略。本站本地引擎接收 float PCM，无需做云端 PCM16 网络包装，保留同样的短帧持续输入方式。
- [讯飞动态修正](https://www.xfyun.cn/doc/asr/voicedictation/API.html) 区分追加与替换结果。本站用当前语段的完整文本假设及 revision 替换草稿，不把修正当作追加；相邻假设共有前缀仅作显示参考，不冻结成不可更改正文。
- [讯飞同传 API](https://www.xfyun.cn/doc/nlp/simultaneous-interpretation/API.html) 是其服务接口，不是本站依赖。当前依旧为本机 STT + 现有 DeepSeek/GLM 流式翻译。
- 允许较早源文快照的译文草稿在当前语段继续增长时显示，明确标记“原文已更新”；新的翻译生成开始后，旧生成不能再覆盖它。句末确认优先，正式译文必须匹配当前句末源文版本。这样避免原文频繁修订使所有在途译文都被丢弃，导致一直没有双语输出。
- 已确认字幕自动跟随底部；用户向上翻阅后停止自动滚动，回到底部恢复跟随。

## 本轮证据与限制

- 固定引擎和全 int8 权重在本机 Node V8 的 WASM 容器中真实初始化；使用官方两个 WAV，每 100 ms 输入一次 PCM，分别观察到 **13 次 / 6 次**非空假设更新，首个假设约在输入音频 **1.0 / 1.3 秒**时产生。10.05 秒 / 5.1 秒音频的计算耗时约 0.8 / 0.4 秒，属于本机离线快速喂入实验，不是浏览器墙钟延迟或手机性能数据。
- 两次连续创建/释放流成功，实验线性内存保持 128 MiB。中文样本与中英夹杂样本可得到文本，但有误识别和尾词缺失；这不是正式准确率评测，人名、专业词和噪声仍需复核。
- 实际页面采用 Worker + ES module、本站资源与缓存加载。类型检查、lint、构建和线上资源检查的具体结果随交付记录说明。
- 自动审批拒绝通过命令行启动独立 Edge 做浏览器联调，原因是该启动方式被策略拦截。因此没有把 Node 引擎实验当作浏览器麦克风、缓存、端点、暂停恢复、iOS/Android 或长时间运行已通过。
- 本轮没有增加或运行自动测试套件。首次离线重新打开整个网站、锁屏持续收音、后台录音均不在本轮已交付保证范围。

## 一级来源与声明

- [官方浏览器实时识别说明](https://k2-fsa.github.io/sherpa/onnx/wasm/hf-spaces.html)
- [官方小型中英模型及使用方法](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html#sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16-bilingual-chinese-english)
- [模型原始卡片，声明 Apache-2.0](https://huggingface.co/csukuangfj/k2fsa-zipformer-bilingual-zh-en-t)
- [固定运行版本](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.12.33)
- [固定构建中的 ONNX Runtime 1.17.1 依赖](https://github.com/k2-fsa/sherpa-onnx/blob/5092b4487125b6584b77aaa3c9dcf5f97063dce8/cmake/onnxruntime-wasm-simd.cmake)

发布资源附 sherpa Apache-2.0、ONNX Runtime MIT 与第三方声明、模型来源和 loader/WASM 修改说明。模型训练数据与实际识别质量另行评估，代码许可不等于准确率保证。
