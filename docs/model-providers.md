# 翻译模型与腾讯云配置

更新日期：2026-11-06。

站内翻译候选仅有 DeepSeek Flash 和 GLM 5.3 Flash，默认 DeepSeek。
已通过云端环境变量实际请求用户网关的 `/models`，确认 `deepseek-flash` 与
`glm-5.3-flash` 均存在；不把网关里的其他 DeepSeek 版本加入候选。
普通翻译和实时字幕共用 `cloud-functions/api/providers.mjs`，统一读取服务端环境变量。
浏览器默认选择 DeepSeek，可在输入区或实时翻译页切换；同一选择用于文本、图片、
文档各分块、扫描 PDF 各页及实时字幕。正在处理时禁用选择，避免途中更换供应商。
切换页面及新建翻译保留本次打开页面期间的选择，刷新恢复 DeepSeek。

## 腾讯云 EdgeOne Pages

在项目的服务端环境变量中配置以下内容，并重新部署包含 Cloud Functions 的版本。
变量属于运行环境，不要使用 `VITE_` 前缀，也不要写入前端代码。实际 Key 不提交到 Git。

| 变量 | 用途 / 默认值 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 两个翻译模型共用的网关 API Key |
| `DEEPSEEK_BASE_URL` | 用户网关地址；GLM 默认共用。仅用 DeepSeek 官方服务时可不填 |
| `DEEPSEEK_MAX_COMPLETION_TOKENS` | 可选；默认 65536，限制每次普通翻译的最大输出预算，上限 393216 |
| `DEEPSEEK_BUDGET_PARAM` | 可选；默认 `max_tokens`，仅当兼容网关要求时改成 `max_completion_tokens` |
| `MIMO_API_KEY` | 仅可选的在线 MiMo ASR 使用；MiMo 不再作为翻译候选 |

两个翻译候选共用的最小配置：

```env
DEEPSEEK_API_KEY=替换为真实Key
DEEPSEEK_BASE_URL=https://your-gateway.example/v1
```

将示例地址替换成自己的兼容网关地址。两个模型固定请求已验证的 ID，共用上述地址和 Key；
旧 `GLM_*` / `DEEPSEEK_MODEL` 变量不再作为路由覆盖项，避免旧配置选中候选之外的模型。
使用在线 MiMo ASR 时再配置 `MIMO_API_KEY`；旧 MiMo 翻译模型、地址和预算变量不再读取。

地址接受以下形式，服务端会补齐缺少的 `/chat/completions`，保留查询参数：

```text
https://api.deepseek.com
https://your-gateway.example/v1
https://your-gateway.example/v1/chat/completions
```

请填写 OpenAI Chat Completions 兼容地址，网关需要支持 Bearer 鉴权、SSE 及以下请求参数；
图片和扫描 PDF 还需要支持 `image_url` 消息。地址和 Key 只从服务端环境变量读取，
浏览器的请求只携带供应商标识及待翻译内容。

## 模型和思考参数

已核对 DeepSeek 官方文档：当前模型请求名是 `deepseek-flash`，支持文字及图片输入，
Chat Completions 地址为 `https://api.deepseek.com/chat/completions`。
用户网关中 GLM 的请求名以实际 `/models` 响应为准：`glm-5.3-flash`。
两种翻译请求都显式设置：

```json
{
  "thinking": { "type": "disabled" },
  "stream": true
}
```

不同时发送 `reasoning_effort: "low"`，因为它会开启思考；当前实现选择用户要求的“不思考”。
普通翻译温度为 0.3，实时字幕为 0.2；实时字幕输出预算最多 1024 token。
服务端只消费最终内容字段，不展示供应商推理内容。非正常结束的输出不会确认为完整译文。

官方依据：

- [DeepSeek 首次调用](https://api-docs.deepseek.com/)
- [Chat Completions 参数、图片消息、流协议](https://api-docs.deepseek.com/api/create-chat-completion/)
- [思考开关与等级](https://api-docs.deepseek.com/guides/thinking_mode/)

## 接口与语音识别

`POST /api/translate` 和 `POST /api/realtime/translate` 都接受
`model: "deepseek" | "glm"`；该字段是站内供应商标识，真实模型名由服务端决定。
不传 `model` 或传未知值时默认 DeepSeek。响应头 `X-Translation-Provider` 和
`X-Translation-Model` 标明实际选定的供应商及请求模型名，便于检查路由。
已选供应商缺 Key 时返回配置错误，不会静默切换供应商。

`GET /api/models` 在服务端读取网关模型列表，只返回两个已配置的目标模型；
不会透出完整模型目录、网关请求地址、Key 或上游错误正文。

DeepSeek / GLM 用于识别后的文字翻译。Zipformer 在浏览器本机持续识别音频，
在线 MiMo ASR 继续使用官方 `mimo-v2.5-asr` 和 `MIMO_API_KEY`。
仅转文字的本机模式无需上述 API Key，也不会调用翻译接口。实现与资源见 [中英流式 STT](realtime-zipformer.md)。

本地开发复制 `.env.example` 为 `.env.local` 并填写相同变量，运行 `npm run api`；
本地适配器已透传两家供应商的全部配置。

首次接入时，类型检查、oxlint、服务端语法检查、Whisper 资源准备及 Vite 生产构建均通过，
构建保留既有的大包提示。首次接入未新增或运行自动测试，未使用真实 Key 调用上游，未部署。

## 配置后检查（2026-11-06）

初次检查线上仍为 2026-09-23 的旧版，因此当时的 HTTP 200 不能作为 DeepSeek 生效证据。
随后按用户要求提交并发布 `85ef773` 的模型查询接口，已通过真实云端配置确认目标模型 ID。
最终版本以 DeepSeek / GLM 为翻译候选；本地模拟回归、生产构建及发布后的真实请求结果
另见 [模型供应商验证记录](research/2026-11-06-model-provider-verification.md)。
