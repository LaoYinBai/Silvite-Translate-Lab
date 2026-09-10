# Silvite 文档翻译收口设计

## 目标与边界

在不改变现有产品视觉、MiMo V2.5 provider、自有 SSE 协议和 `/api/translate` 地址的前提下，完成 Cloud Functions 120 秒运行窗口、统一长文本管线、TXT/MD/DOCX/PDF 输入、结构化 JSON 防泄漏和请求竞态修复。继续保持静态前端，不引入数据库、任务队列、账号或历史系统。

## 运行时

将 `functions/api/translate.js` 与 Prompt 模块迁至 `cloud-functions/api/`，删除旧 handler，并同步本地脚本、测试和文档引用。根目录 `edgeone.json` 使用 `cloudFunctions.nodejs.maxDuration = 120`。文件路径仍映射为 `/api/translate`，处理器接口、环境变量和响应事件保持不变。

## 统一文档管线

文本输入和文件解析正文统一转为 `DocumentInput`，再经过同一条浏览器侧管线：语言判断、标题提取、语义分块、逐块独立请求、局部恢复、顺序拼接、canonical final。

分块优先标题/段落/列表，其次完整句子，最后才硬切。Markdown fenced code block 作为不可翻译块原样保留。第一版根据源语言和字符数采用保守阈值，确保 20,000 字符不会押注一次长请求。

每个可翻译块单独调用 `/api/translate`，携带用户模式、Context、Terminology、文档标题和精简文档说明。已确认块立即保存在当前 session，后续失败不清空前块。最终仅组装一个 `TranslationResult`，不暴露内部块编号或协议。

## 超时与恢复

Cloud Function 硬上限 120 秒；浏览器为每个块设置 95 秒软截止。软截止使用独立 AbortController，区别于用户取消：超时时只将当前块进一步按语义边界拆小并重试；用户取消则安静结束。Provider 断流、浏览器 transport 中断和输出截断仍由现有单请求机制各自重试一次。

## 文件输入

文件在浏览器解析，正文进入同一文档管线：

- TXT：UTF-8 文本读取。
- MD：保留标题、列表、段落和代码围栏；围栏内代码不翻译。
- DOCX：提取标题、段落、列表及基本顺序。
- PDF：只处理文本层，按页与文本项重建阅读顺序并清理重复页眉、页脚和孤立页码；无有效文本层时明确拒绝，不做 OCR。

白名单同时检查扩展名、MIME、文件签名和解析结果。单文件上限 10MB，提取正文上限 100,000 字符；空文件、伪装类型、损坏文件均返回中文错误。

## JSON 防泄漏

服务端解析器只接受满足 canonical schema 的结构化对象；可恢复 fenced JSON 和带少量解释前后缀的完整对象。只要内容具有内部协议特征但无法可靠解析，就触发 format recovery/retry，绝不回退成翻译正文。流式阶段只释放已确认位于顶层 `translation` 字符串中的字符，无法分类的原始内容不作为 provisional translation 展示。

## 状态一致性

所有 session 切换统一使 generation 递增并 abort 当前请求。每个 delta/reset/final/catch 都同时检查 generation 与 AbortSignal。`reset()`、`loadDemoSample()`、新翻译和用户取消后，旧回调永远不能修改当前状态。

## 验收

新增纯函数与集成测试覆盖语义分块、超长单段、中文/英文、局部重试、软截止再拆分、无重复/无缺失、四类文件、状态竞态和 JSON 边界。最后运行 test/build/lint，并在本地浏览器使用约 1k、3k、10k+、近 20k 中英文及 TXT/DOCX/PDF fixtures 验收。
