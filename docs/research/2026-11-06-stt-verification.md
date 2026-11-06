# 2026-11-06 STT 实测与交付记录

检查范围：现有线上 MiMo STT、本地浏览器 Whisper，以及手机和 PC 的使用入口。转换与对齐功能
本轮仅写入[实施计划](../superpowers/plans/2026-11-06-browser-corpus-tools.md)，没有实现转换工具。

## 结论

线上旧 STT 对有效中英文音频均返回 502，当前不能使用。本地已修复云函数对 `Request.signal`
的假设，并接入浏览器内 Whisper Tiny，可在无识别密钥、无本机识别服务的情况下转文字。
本地静态构建经过真实模型推理；所有更改尚未部署，不能据此称线上恢复。

手机尺寸的 Chromium 模拟已通过布局与 CPU 推理验证。它仍运行在桌面 CPU 上，不能代表实际
iPhone / Android 的速度、发热、麦克风、后台和锁屏表现。中文 Tiny 有真实误识别，准确率尚未达成课堂语料验收。

## 线上故障

站点 `https://translate.modiconnect.cn` 首页响应 200；首页健康检查不等于识别成功。
使用 Windows System.Speech 合成固定测试句，再转换为单声道、16 kHz、PCM16 WAV，实际 POST
`/api/realtime/transcribe`，未模拟 API 或上游识别结果。

| 输入 | 时长 | HTTP | 实际错误 |
| --- | ---: | --- | --- |
| 你好，今天我们学习英语。 | 3.495 秒 | 502 | FUNCTION_INVOCATION_FAILED |
| Hello. We are learning English today. | 3.55 秒 | 502 | FUNCTION_INVOCATION_FAILED |

两次返回 EdgeOne 错误 HTML，异常均为 `Cannot read properties of undefined (reading 'aborted')`。
浏览器经假麦克风送入合成音频、实际调用线上接口，也出现同一故障，没有转写文字。
对应修复位于 `cloud-functions/api/realtime/transcribe.js`：允许云运行时省略 Request.signal，
仍为上游保留独立 AbortController。回归测试先复现同一异常，再确认修复后通过。
本地未配置 MiMo 密钥，因此没有用修复后的云函数完成真实上游调用；部署后仍需复验。

## 本地静态发布包实测

使用 `npm run build` 产物，在 `http://127.0.0.1:4173/` 预览；不是仅在 Vite 开发态测试。
工具：Playwright + 已安装的 Microsoft Edge。Browser plugin not available，因此使用本地 Playwright。
输入为上述合成 WAV，经 Chromium 假麦克风送入真实 getUserMedia / AudioWorklet / VAD / 分段链路；
模型权重、Worker、GPU/CPU 推理均为真实运行。未模拟识别输出，未使用真人物理麦克风录音。

硬件为 AMD Ryzen 5 5600X、NVIDIA GeForce RTX 2080 SUPER。桌面视口 1440×1120；
手机模拟为 390×844、触控、isMobile，并禁用 GPU。模型来自同源静态分片，所有资源响应成功，
没有未处理的 pageerror，本机模式每例的 POST 请求数均为 0。

最终分片版本结果：

| 场景 | 实际文字 | 模型就绪 | 首条字幕 | 断网继续 |
| --- | --- | ---: | ---: | --- |
| 桌面 GPU / 英文 | Hello. / We are learning English today. | 4.422 秒 | 7.849 秒（Hello.） | 通过 |
| 桌面 GPU / 中文 | 你好今天我们学习英语 | 4.159 秒 | 9.901 秒 | 未断网 |
| 手机尺寸 CPU / 英文 | Hello. / We are learning English today. | 2.023 秒 | 5.757 秒（Hello.） | 通过 |
| 手机尺寸 CPU / 中文 | 你好今天我們學習應餘 | 2.046 秒 | 8.065 秒 | 未断网 |

计时从点击开始，包含 localhost 静态资源、模型初始化、播放等待、音频采集和句间停顿，
不是纯模型耗时，也不是公网首次下载耗时或手机速度基准。英文的 Hello. 与后句按停顿分成两条字幕。
中文 CPU 的“應餘”是实际首轮输出，属于“英语”的误识别；没有等待循环输入后出现正确文字来替代该结果。
开发态还分别验证过 CPU 英文和简繁中文可出字，但不同分段下结果会变化，不能据此推断中文准确率。

两例英文在模型、运行组件及 AudioWorklet 就绪后，将整个浏览器 context 设为离线，仍生成后续字幕。
这只验证已打开页面的本机 STT；未实现离线安装、页面离线重载，或离线下载另一套设备模型。

交互检查：

- 手机“菜单 → 实时翻译”可进入，触控设备默认 CPU；桌面默认 GPU 自动选择。
- 实时页按钮和下拉框可见高度均至少 44 CSS px；320、390、768 px 宽度没有页面横向溢出。
- 四个模型案例的暂停、继续、结束和字幕保留通过；已查看手机和桌面截图。
- 在模型请求被延迟的情况下取消加载，再开始，成功识别英文；取消会终止 Worker。
- 用响应头 `Permissions-Policy: microphone=()` 触发浏览器真实拒绝采集，页面正确提示
  “麦克风权限未开启，请在浏览器设置中允许使用麦克风。”，并允许再次开始；没有 POST。
  这是受控的浏览器拒绝场景，不代替手机系统权限设置验收。

控制台存在资源无 Content-Length 的加载提示；GPU 另有 ONNX Runtime 的 `[W:onnxruntime]`
节点分配警告，部分形状计算在 CPU 执行。识别成功，未将这些警告称为零错误日志。

## 模型精度与托管修复

最初将 GPU 也设置为 q8，实际输出多语言乱码；CPU q8 正常。参考
[上游问题 #1317](https://github.com/huggingface/transformers.js/issues/1317) 和
[官方 dtype 指南](https://huggingface.co/docs/transformers.js/guides/dtypes)，
改为 GPU encoder fp32 / decoder q4，CPU 保持 q8，并用上表的真实推理验证。
GPU 初始化或推理异常可回退 CPU，但不会因失败自动上传音频。

原始三份权重约 30.7、32.9、86.7 MB，超过 EdgeOne Pages
[25 MB 单文件上限](https://pages.edgeone.ai/zh/document/limits-and-quotas)。
构建时改为最大 20,000,000 字节的分片，浏览器用 Transformers customCache 接口校验 SHA-256 并流式重组。
原始权重只保存在构建缓存，不进入 dist；最终 dist 最大文件是 21,596,019 字节 WASM。
模型、WASM、MJS、配置和许可均同源静态托管；用户使用时无 Python、FFmpeg、Node 或桌面工具依赖。

## 自动化验证

- `node --test tests/*.test.mjs`：**220 / 220 通过**。
- `npm run build`：准备资源、TypeScript 与 Vite 构建通过。
- `npm run lint`（实际执行同一 oxlint 二进制）：退出码 0。
- `git diff --check`：通过；大模型、生成资源与原始用户语料没有加入 Git。

回归覆盖无 Request.signal 的云请求、音频窗口尾部采样、较长窗口、暂停状态、仅转写跳过翻译、
模型加载顺序与取消、组件卸载后延迟麦克风权限的清理，以及分片顺序、损坏/缺失、缓存复用和缓存不可用。
测试与构建不能替代真实手机或真实 MiMo 上游验收。Vite 仍提示部分 JS chunk 超过 500 kB；没有构建失败。

原始 QA 脚本、JSON 与截图位于本机临时目录 `%TEMP%/translate-lab-stt-20261106/`：
`api-results.json`、`browser-production.json`、`whisper-static.cjs`、`whisper-static-results.json`、
`whisper-permission-results.json`、`static-*.png` 和 `tests-final.log`。临时文件可能被系统清理，
以上表格保留了关键证据；没有把音频、模型或用户原始语料提交到仓库。
