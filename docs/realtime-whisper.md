# Whisper 本机语音转文字

2026-11-06：在当前静态前端内增加 Whisper STT，复用音频采集、VAD、分段、字幕合并和会话控制。
本机计算指浏览器的 CPU/WASM 或 WebGPU；用户无需安装 Python、FFmpeg、Whisper 服务或桌面程序。

## 使用与计算设备

进入“实时翻译”，选择“本机 Whisper”，默认勾选“仅转文字”。取消该勾选后，识别文字会发给现有翻译接口；
音频仍在本机识别。在线 MiMo 是独立可选引擎，不会因本机失败而自动上传音频。

桌面默认 GPU 优先，触控设备默认 CPU 兼容模式，均允许手动选择 CPU。缺少 WebGPU 时回退 CPU；
GPU 初始化/推理失败也会尝试 CPU，前提是相应静态资源可加载。模型准备中可取消，开始收音后可暂停、继续和结束。
“菜单”提供手机端入口，控件适配窄屏；开始点击先解锁 Web Audio，再下载模型并请求麦克风权限。

这是短片段识别：最长约 6 秒一个窗口，句间停顿会提前提交。它不是 Whisper 原生逐字流式服务。
Tiny 轻量模型在中文、人名、术语、噪声及口音上有准确度限制，可能输出繁体字，需要复核。
手机后台、锁屏及长时间运行的速度/发热尚需真机评估。

## 静态资源与发布

新增依赖 `@huggingface/transformers@3.8.1`，ONNX Runtime 版本由 lockfile 固定。
模型为多语 `onnx-community/whisper-tiny`，固定 revision `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`。

| 设备 | encoder / decoder | 模型与配置下载量（十进制约值，不含运行组件） |
| --- | --- | --- |
| CPU / WASM | q8 / q8 | 45 MB |
| WebGPU | fp32 / q4 | 124 MB |

本次在 NVIDIA 上实测 q8 decoder + WebGPU 会产生乱码，因此不能将 CPU 的精度设置原样用于 GPU。
参考 [上游问题 #1317](https://github.com/huggingface/transformers.js/issues/1317) 和
[官方精度说明](https://huggingface.co/docs/transformers.js/guides/dtypes)；当前 GPU 配置经过浏览器推理验证。

```sh
npm ci
npm run prepare:whisper
npm run dev
npm run build
```

`predev` / `prebuild` 自动执行准备脚本，重复执行会验证并复用已下载模型。脚本在**构建时**从固定版本
下载模型，验证四份 ONNX 的 SHA-256，复制锁定依赖的 WASM / MJS 运行组件及许可声明到 `public/whisper/`。
模型为派生静态文件，已 gitignore；构建产物 `dist/whisper/` 必须一同发布。不要只上传 JS/CSS。

EdgeOne Pages [单文件上限为 25 MB](https://pages.edgeone.ai/zh/document/limits-and-quotas)。三份原始权重
超过该值，准备脚本将全部 ONNX 拆成最大 20,000,000 字节的 `.partN` 文件；原始下载保存在
已忽略的 `.cache/whisper/`，不进入发布包。`manifest.json` 记录顺序、长度与每片 SHA-256。
Worker 使用 Transformers 的 customCache 接口逐片校验、重组 Response，并尝试缓存完整模型；
缓存不可用或配额不足不会阻止当次识别。重组与校验均在浏览器内完成，不增加转换服务器。
本轮构建最大静态文件为约 21.6 MB 的 WASM；ONNX 原文件不会随静态站发布。

构建环境需要访问 Hugging Face / GitHub；需要代理时使用环境提供的 HTTPS_PROXY / NODE_USE_ENV_PROXY，
或设置 `WHISPER_MODEL_BASE_URL` 为保留 `revision/文件名` 路径的可信镜像。浏览器运行不访问模型仓或外部 CDN：
`allowRemoteModels=false`、`local_files_only=true`，模型和运行组件都从本站读取。

CPU 固定单线程 WASM，避免把 COOP/COEP、SharedArrayBuffer 作为静态托管的必要条件。WebGPU 可选，
麦克风仍要求 HTTPS（或 localhost）、AudioWorklet 和浏览器授权。页面与模型加载后可断网继续本机转写；
本轮没有增加整个应用的离线安装/离线重载能力。

## 实现与验证入口

- `whisper.ts`：WAV 解码、Worker 客户端、取消、释放、Provider 契约。
- `whisper.worker.ts`：本机模型加载、精度选择、推理和 GPU→CPU 回退。
- `whisperAssets.ts`：同源模型分片流、校验与按 revision 隔离的浏览器缓存。
- `session.ts`：准备阶段、仅转写、字幕确认、暂停状态与本机错误。
- `scripts/prepare-whisper.mjs`：构建时准备；原始语音不在静态资源中。
- `tests/whisperProvider.test.mjs` 和现有 realtime 测试：协议、音频、会话、取消与云函数兼容性。

模型来源和上游 MIT 声明、Transformers Apache-2.0、ONNX Runtime MIT 与第三方声明均随静态资源发布。
实际检查范围见 [STT 验证记录](research/2026-11-06-stt-verification.md)；模拟测试通过不能代替手机真机验收。
