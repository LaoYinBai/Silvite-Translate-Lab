# 浏览器语料转换与中英对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给翻译专业学生提供在静态网页中运行的 TMX、RTF、SDLTM 转换和中英双文档对齐工具。

**Architecture:** 格式适配器读写统一双语单元，转换和对齐共用预览及人工校正界面。SQLite、WASM 和模型推理在 Worker 内运行，资源随静态站点发布、按需加载。TMX → SDLTM 实验出口计划采用官方真实空模板副本与 SQLite WASM 注入、输出回读；SDLTM 原生兼容性独立验收。

**Tech Stack:** 现有 React / TypeScript / Vite / Zustand；SQLite WASM；RTF 结构解析器；可选 Transformers.js / ONNX 或 Hunalign WASM。后两类组件须完成下述评估再固定依赖。

**Spec:** [2026-11-06 调研与真实样本分析](../../research/2026-11-06-static-conversion-and-alignment.md)。样本摘要见 [inventory](../../research/2026-11-06-sample-inventory.json)，实际数据库结构见 [schema](../../research/2026-11-06-sdltm-schema.sql)。

**状态（2026-11-06）：** 开发方案，尚未实现。用户提供的技术文档及真实样本已分析；第三方读取成功不等于 Trados 原生功能验收通过。

**开工审查（2026-11-07）：有条件放行 Task 0 与基础模型。** [完整审查及必须遵守的数据/质量契约](../../reviews/2026-11-07-corpus-readiness.md) 是本计划的补充约束。下面的类型是初始草图，不能省去审查要求的原始块、字符范围、混合标签节点、类型化元数据和版本化编辑关系；备选依赖通过最小浏览器验证后再锁定。完整 SDLTM 互转尚未技术放行，原始目标仍保留。

**实施进度（2026-11-07）：** 用户随后指定先完成 TMX / RTF 与中英对齐，当前已接入相应 Beta 工具、原文范围模型、编辑器、Worker、真实 Pandoc 和 MiniLM，详见 [实施及证据](../../corpus-tools.md)。原计划中的自动测试步骤本轮未执行，保留集 F1 和浏览器/真机验收尚未完成，因此不把这些关卡勾选通过。

**本次 SDLTM 进度（2026-11-07）：** **TMX → SDLTM 实验输出**的适配器、SQLite WASM Worker、导出入口及损失确认已接入，界面显示「不保证兼容 Trados」。五组 183 条已完成本地 WASM 写出、Node 原生 SQLite 独立只读检查和独立 DOM 正文/语言核对；反向特殊字符与手选方向回放也已通过，Task 5 按具体证据勾选。类型检查、lint 和 Vite 生产构建已通过。Task 3 通用读取、浏览器/手机端端到端、专业保留集 F1 及 Trados 原生兼容性仍待验收；原生未验证不阻断已授权的实验输出。历史计划中的自动测试套件步骤仍未执行。

## Global Constraints

- 转换与对齐只在浏览器内计算；运行时不依赖宿主机软件、Trados DLL、Python、Node 服务或转换 API。现有在线翻译/STT 服务与本工具的运行条件分别记录。
- WASM、模型、分词器和词典自托管；资源首次下载后可缓存，不能将“首次需要下载资源”混同于“文档需要上传”。
- 兼顾手机与 PC：窄屏可导入、复核和导出，触控操作不依赖 hover；在实际 iOS/Android 上核验文件选择、下载与内存，模拟器通过不能代替真机验收。
- 资源符合现有 EdgeOne Pages 的 25 MB 单文件上限；大模型/词典使用静态分片并在浏览器内校验重组，发布包不能夹带超限原始资源。
- 优先满足个人学习使用；第一阶段不增加班级、教师、作业或账号系统。
- 中英方向可手选：TMX 导入提供自动/中→英/英→中，显式选项优先；自动时取有效中英 header `srclang`，无适用 header 时默认中→英。正文按实际 xml:lang 读取，当前项目可再次选择导出工作方向，保留 locale，不改写文本。空源文、空译文和双空行均保留并提示。
- 不覆盖原文件；导出为新文件。大文件可取消、显示进度；主线程保持可操作。
- 原文、段落/单元格位置、标签、自定义属性与人工调整可追溯；无法支持的结构须明确提示。
- SQLite int64 全程精确处理，不能经由 JS Number。实验输出可使用明确标注的 SHA-256 截断占位哈希；模板结构或占位值不代表 Trados 专有哈希、分词和模糊检索数据已被重建。
- SDLTM 实验出口以保留当前工作文本、空侧/双空、明确损失清单及输出完整性/回读为目标。原生打开、导出、精确/模糊检索、编辑、重新打开用于后续兼容性分级，未验证不阻断实验输出；不把桌面软件修复作为每次转换的运行依赖。
- 工作中英文本含保护性行内标签或代码时阻止 SDLTM 导出，不静默丢标签；其他语种和未表示的元数据须在导出前提示。SDLTM 入口及确认区显示「不保证兼容 Trados」。
- 不将用户原始语料、数据库及个人字段提交到仓库或网站静态资源；公开夹具使用合成文本。
- 锁定代码、模型权重和词典各自的许可证与版本。Pandoc 内核 GPL、Hunalign LGPL 等分发要求在引入前确认。

## Review Focus

1. Unicode、RTF 回退字符和重复行定义：中文和单元格换行不得重复、丢字或多计行（任务 2）。
2. 空侧、多语言及方向冲突：导入显示真实内容，不静默丢行（任务 1、2）。
3. SDLTM schema 变体、int64 和混合标签：按实际表列读取，无法保留的字段有提示（任务 3）。
4. 漏译、多句对应与段落换序：保留未匹配片段并允许锚点和人工调整（任务 4）。
5. 取消、资源加载失败和重复运行：不污染下一次结果，不长时间阻塞界面（任务 1、4）。

## 文件与接口边界

| 文件 | 职责 |
| --- | --- |
| `src/services/corpus/types.ts` | 文档、句段、双语单元、格式诊断、任务协议 |
| `src/services/corpus/{tmx,rtf,sdltm}.ts` | 各格式适配器；保留正文、标签与元数据 |
| `src/services/corpus/corpus.worker.ts` | 重计算、进度、取消及资源生命周期 |
| `src/services/alignment/{segment,align}.ts` | 保留位置的分句、对齐路径及评分 |
| `src/store/corpusStore.ts` | 导入状态、双语行、人工校正和会话保存 |
| `src/components/CorpusTools/CorpusTools.tsx` | “格式转换”“中英对齐”入口及共用编辑器 |
| `src/App.tsx`、`src/components/Sidebar/Sidebar.tsx` | 新增“语料工具”，界面和重资源延迟加载 |
| `src/services/document/fileParser.ts`、`officeParser.ts` | 增加结构输出适配，复用已有格式识别 |

建议公共接口如下；实现时允许增加内部类型，不改变空侧和可追溯语义：

```ts
type Language = string;
type UnitSide = { text: string; segmentIds: string[]; originalMarkup?: string };
type BilingualUnit = {
  id: string; source: UnitSide; target: UnitSide;
  sourceLanguage: Language; targetLanguage: Language;
  metadata: Record<string, string[]>;
  score?: number; review: 'unreviewed' | 'confirmed' | 'edited';
};
type Corpus = { units: BilingualUnit[]; warnings: string[] };
type StructuredDocument = {
  id: string; language: Language;
  segments: { id: string; text: string; blockId: string; cellId?: string }[];
};
type JobOptions = { signal?: AbortSignal; onProgress?: (fraction: number) => void };
// parseCorpus(format, bytes, options) -> Promise<Corpus>
// exportCorpus(format, corpus, options) -> Promise<Uint8Array>
// alignDocuments(source, target, anchors, options) -> Promise<Corpus>
```

Worker 消息携带 jobId，提供 start / progress / result / error / cancel；AbortSignal 在调用端转换为 cancel 消息。取消同步 WASM 任务可终止并重建 Worker。XML 解析选 Worker 兼容实现，或在主线程解析后传结构化数据，不传 DOM 对象。

## Task 0：开工前置技术验证与契约固定

**Files:** 技术验证放入独立开发脚本/合成夹具，避免先接完整业务界面；结论写入 `docs/research/corpus-feasibility.md`，资源清单及模型 revision 随实现固定。

**Interfaces:** 采用开工审查的数据契约。归一化只用于匹配，原文使用不可变块和 UTF-16 范围；标签使用有序节点，编辑使旧序列化失效；int64 在项目 JSON 中采用类型化十进制字符串。

- [ ] 固定 Worker 可用的混合 XML 解析/序列化方案，证明有序正文、成对标签、属性、空侧和多语言变体保留；禁止外部实体与外部资源加载。
- [ ] 在真实浏览器验证 RTF 候选能正确读取样本式行列、Unicode/回退/代码页及隐藏源文类型检测，再选定并记录版本、加载方式、许可证及源代码声明。
- [ ] 在浏览器 Worker 里完成 SQLite 字节导入、int64 绑定/读取、字节导出回读；记录具体构建和资源哈希，不能用 Node SQLite 代验。
- [ ] 固定分句、锚点、1:1/1:2/2:1/2:2/1:0/0:1 及每侧最多 3 句的自动转移；定义长句切窗、pooling 和完整覆盖。建立分文档隔离的标注评估集，按审查文档的质量口径比较候选。
- [ ] 复用 Transformers.js 3.8.1 验证向量路线，锁定模型不可变 revision、全部资源、许可证与哈希；Hunalign 的词典/分词/许可未落实前不视为最终备选已可用。
- [ ] 固定 SDLTM 实验出口的真实空模板、SQLite WASM 和字段/编码映射，记录占位 hash 与未重建的 token/fuzzy；另列原生验收计划，不把原生未验证作为实验输出阻断条件，也不把旧内容索引冒充新文本的派生值。
- [ ] 固定首期双文档输入为 TXT / DOCX / 普通单语 RTF；文本 PDF 作为单独的提取质量检查通道，扫描 PDF 的本地 OCR 未验证前不承诺支持。其他现有翻译输入格式不自动等同于可保真对齐格式。
- [ ] 固定各通道支持矩阵、导出损失清单、项目 JSON/IndexedDB 恢复规则、PC/手机待测工作负载与离线定义；资源必须自托管，模型和 WASM 按需加载。
- [ ] 各通道按实际环境分别记录开发回读、页面 Worker 和浏览器/真机证据。SDLTM 可先按用户授权提供标明边界的实验输出；缺少浏览器、原生或质量评估证据的项目继续标为待验证，不标记完整互转或专业验收完成。

## Task 1：统一模型、编辑器和任务生命周期

**Files:** 新建 `types.ts`、`corpus.worker.ts`、`src/store/corpusStore.ts`、`CorpusTools.tsx`；修改 App 和 Sidebar；验证文件 `tests/corpusModel.test.mjs`。

**Interfaces:** 产出上述 Corpus / StructuredDocument / JobOptions；编辑动作按 unitId 操作，支持拆分、合并、修改、两侧留空及撤销；会话 JSON 保存模型版本。

按审查契约补齐原始块/字符覆盖/标签/编辑 revision/撤销重做/类型化元数据/项目恢复。此任务可先于 Task 0 的重依赖结果启动，完整界面不得假定未验证的适配器已可用。

- [ ] 为 `空源文/空译文/双空保留`、`编辑后撤销恢复原文及 segmentIds`、`取消后旧 jobId 结果被忽略` 编写验证用例。
- [ ] 运行 `node --test tests/corpusModel.test.mjs`，确认新模块缺失或行为未实现时失败。
- [ ] 实现模型、编辑动作、Worker 协议和两个流程的界面，导入后必须先预览再导出。
- [ ] 同一命令全部通过；浏览器检查重复导入、取消、会话恢复。重计算中仍可点击取消。
- [ ] 提交这一可独立演示的增量。

## Task 2：TMX 与常见 RTF 双向转换

**Files:** 新建 `tmx.ts`、`rtf.ts`、`tests/corpusFormats.test.mjs`；接入任务 1。

**Interfaces:** 实现 `parseCorpus('tmx' | 'rtf', bytes, options)` 与 `exportCorpus('tmx' | 'rtf', corpus, options)`。RTF 导入允许用户选择原文/译文列；普通单语 RTF 转入双文档对齐流程。

- [ ] 验证 TMX 的实际 `xml:lang` 正文、有效中英 header 默认方向与显式选项优先、实体与 `bpt/ept/ph`、多语言选择、空侧、元数据和往返一致性；本轮方向的具体回放结果见 Task 5，不代替这里其余自动测试要求。
- [ ] 验证 RTF `\uN` 有符号 UTF-16、`\ucN` 回退跳过、同一行重复 `\trowd`、单元格换行及中文导出再导入。
- [ ] 运行 `node --test tests/corpusFormats.test.mjs`，先确认缺失能力失败。
- [ ] 实现 TMX 适配器、样本式双栏 RTF 读写；评估 Pandoc WASM 表格 AST 并锁定版本及许可。旧 Trados 隐藏源文/分段标记单独检测和解析，不能先丢弃隐藏文字；复杂合并表格超出支持范围时显示提示。
- [ ] 同一命令全部通过；在本机用私有五组样本核对 RTF/TMX 共 183 行，导出保留空侧。
- [ ] 提交支持范围及实测限制。

## Task 3：浏览器 SDLTM 读取

**Files:** 新建 `sdltm.ts`、SQLite Worker 适配层、`tests/sdltmRead.test.mjs`；资源路径在实现时固定并随构建发布。

**Interfaces:** 实现 `parseCorpus('sdltm', bytes, options)`；读取 schema 后选取支持的列，输出相同 Corpus。以 Maxprograms TMReader 为结构参考，移除 Node 文件系统/SQLite 依赖。

本任务指面向外部 SDLTM 文件的通用读取，仍待实现及验收。Task 5 对自己生成的文件做结构/正文回读，不自动等于本任务已交付；通用读取也不作为新增 TMX → SDLTM 实验出口的前置阻断项。

- [ ] 验证合成 13 表与 20 表结构、`9077876807420713840n` 精确往返、Text/Tag、Elements 与 LastElement 去重、自定义字段和不支持版本提示。
- [ ] 运行 `node --test tests/sdltmRead.test.mjs`，确认缺失能力失败。
- [ ] 以官方 SQLite WASM 内存数据库导入 Uint8Array，按实际表列读取；不强制 OPFS。保留可解释的日期、用户、属性、标签及原始字段。
- [ ] 同一命令全部通过；本机五份 SDLTM 共 180 TU，与对应 TMX 正文按既定换行规则核对。
- [ ] 记录三条数量差异：9、20 组各缺一双空行，10 组缺一空中文/非空英文行。导入输出不伪造这些不存在的 TU。
- [ ] 提交读取支持及结构诊断。

## Task 4：中英双文档对齐与人工复核

**Files:** 新建 `segment.ts`、`align.ts`、`tests/alignment.test.mjs`；扩展结构解析及共用编辑器。

**Interfaces:** `alignDocuments(source: StructuredDocument, target: StructuredDocument, anchors: { sourceId: string; targetId: string }[], options: JobOptions): Promise<Corpus>`；返回 1:1、1:N、N:1、N:M、1:0、0:1，至少支持 2:2，自动路径每侧最多 3 句；保留原句范围和算法原始分数。锚点重叠/交叉先诊断，重跑保留锁定区间，换序由人工重新配对。

- [ ] 建立人工标注的公开合成夹具，覆盖缩写/数字、错分句、漏译、多句对应、人工锚点、换序、重复句及连续运行两次无前次结果。
- [ ] 运行 `node --test tests/alignment.test.mjs`，确认缺失能力失败。
- [ ] 给文档解析增加段落/表格结构输出；现有纯文本结果和翻译请求 chunker 不作为对齐关系。
- [ ] 比较多语 MiniLM + JS 动态规划与 Hunalign WASM：固定夹具上的对齐准确性、耗时、峰值内存、资源下载量和许可。语义路线优先评估，约 118 MB 的量化模型及 tokenizer 延迟加载；WebGPU 可选，WASM 能运行。
- [ ] 按 Task 0 固定的分文档保留集报告精确对齐组 precision/recall/F1 与空对应、多句对应错误。初始目标 F1 ≥ 0.90、字符覆盖 100%、锁定锚点违反 0；自动结果均待复核，分数不伪装为正确概率。对长句验证无静默 tokenizer 截断。
- [ ] Hunalign 若入选，修复实例复用时 printLog 未清空；中文分词和词典遵循同一规则，确认词典许可。其分数不显示为正确概率。
- [ ] 同一命令全部通过；浏览器断网缓存运行、资源下载失败重试、推理中取消、手动锚点及空侧调整均可演示。换序无法由单调算法处理时必须允许人工调整。
- [ ] 提交实际算法选择、质量指标和支持边界。

## Task 5：TMX → SDLTM 实验输出与独立兼容性验证

**Files:** 已接入 `src/services/corpus/sdltm.ts`、`sdltmSqlite.ts`、`sdltm.worker.ts`、`jobs.ts`、资源准备及共用导出/损失确认界面。具体证据见 [实施记录](../../corpus-tools.md)；原生兼容性另行验收。

**Interfaces:** 已有 `sdltmInput(project)`、`sdltmExportLosses(project)` 与 `exportSdltmInBrowser(project, signal, progress)`，以当前项目未排除记录的中英工作变体为输入，返回 `.sdltm` 字节和 `local_structural` 检查结果。共用项目中的 TMX/RTF/对齐内容已有出口；本轮真实样本证据来自 TMX 路径，不据此宣称所有输入路径的浏览器端到端或通用 SDLTM 互转已完成。

**实现与本地进度（勾选仅表示注明层级已完成）：**

- [x] 按“真实空模板 + SQLite 注入 + Segment XML”路线实现写出，每次复制官方零 TU 模板到新的内存数据库，事务写入当前内容、语言和计数；输出新文件。资源准备固定官方模板与 SQLite 哈希，不发布用户语料或个人字段。
- [x] 基于 245760 字节、13 表的官方空模板（SHA-256 `d0e367a1de5d1ed9f65d9cd031e8d9c551cb5fe4ecb1a5ec948f5a5e2db70eaf`）补齐样本新列、20 业务表和 25 显式普通 SQL 索引。输出表名/索引名集合与五份真实样本逐份相同；清除模板 2 个属性定义和 4 个 picklist 值，保持 `VERSION=8.06`，不伪称由 8.10 生成。
- [x] 固定 `@sqlite.org/sqlite-wasm@3.54.1-build1` 及引擎 SHA-256 `b8a92a19f441a90ff2339fe988fbe317c4adf3ed844096f12aee04aa72d58257`。实际浏览器胶水 `index.mjs` 与同一 WASM 已在 Node 中初始化和回读，OPFS 禁用（`opfs=false`）；生产代码为纯前端 Worker，不依赖 Node 服务。这项 Node 初始化不算浏览器端到端。
- [x] GUID 使用 .NET `Guid.ToByteArray()` / `bytes_le`，固定字节样例已核实。占位哈希为当前文本 UTF-8 的 SHA-256 前 8 字节按 signed big-endian int64 解释，BigInt 精确绑定和回读；不冒充原生哈希算法。
- [x] 未复制用户 token 数据，不重建专有分词、fuzzy 或其他语义派生数据。20 表和 25 个普通 SQL 索引不代表原生精确/模糊检索能力；未生成项列为实验边界。
- [x] 代码从当前工作变体 `text` 取值，保持顺序，不补译、不去重，排除记录不导出；五组样本的空侧/双空和正文完整保留已由下述本地回放核对。
- [x] 工作中英侧保护性 markup 的导出拒绝已回放。额外语种及未表示的 TU/TUV 属性、notes、用户/时间与应用状态已有损失清单，导出入口和确认区显示 **「不保证兼容 Trados」**。
- [x] Worker/共用导出界面已接入进度、取消、失败回收、旧任务防覆盖与待复核数量；TMX 导入方向和当前项目导出工作方向已有明确选项。此项记录代码接入，真实浏览器交互仍在 Task 6 待验。

**结构、原文和方向回放：**

- [x] SQLite WASM 写出及最终字节自回读通过；另用 Node 原生 SQLite 独立只读核验五个文件，`integrity_check=ok`、FK 违规均为 0。独立 DOM 提取各 Segment 的正文/语言后与 TMX 按工作方向逐字符相等，不先 trim、NFC 或换行归一化；结果记为本地结构/正文证据。
- [x] `.cache/corpus/sdltm-replay.log` 记录 9/10/19/20/25 组分别为 **42/49/30/20/42**，合计 **183**，每组 `exact=true`、`nativePreserved=true`，每个输出 499712–524288 字节。原始 TMX header 为 en-US，原生参考库为 zh-CN→en-US；本次对照显式采用原生库的 zh→en 方向，不声称输入文件天然同向。
- [x] 原生参考 180 条在统一 LF 并 trim 的比较口径下全部保留；额外三条为第 9 组第 42 条、第 20 组第 20 条双空，以及第 10 组第 20 条中文空、英文非空。后者英文 trim 后为 121 字符，这不是输出逐字符核对的裁剪规则或原始 TMX 字段长度。
- [x] 补充 3 条 en-US→zh-CN 反向记录，覆盖 CRLF、emoji、补充汉字、空侧和双空，使用实际 `index.mjs`/WASM 初始化及自回读通过；保护性 markup 拒绝也已回放。不据此声称原生标签兼容。
- [x] `.cache/corpus/direction-replay.log` 对第 19 组 30 条分别核对自动 header en→zh、显式 zh→en、显式 en→zh、手工反转 en→zh。四条路径均为 TMX exact、RTF exact、SDLTM 本地自回读通过，locale 保留；翻译结果 2 段转项目的范围覆盖回放通过。
- [x] 具体模板、引擎、执行环境、计数和比较口径已记录在 [实施记录](../../corpus-tools.md) 与 DEV；本地日志不包含在发布资源内。本地 WASM/Node 回放不替代页面 Worker、浏览器文件选择/下载或手机端端到端证据。
- [ ] 在真实浏览器核对损失确认、手选方向、取消/失败恢复及文件操作；补充实际编辑后文本、重复记录等场景的端到端结果。不得用上述本地回放替代这些条目。

**原生兼容性与质量边界：**

- [ ] 后续有原生环境时，独立核对 Trados 版本、打开、计数/语言、TMX 导出、精确/模糊检索、编辑保存、关闭再打开；记录具体结果。未验证或发现兼容缺口不阻断用户已授权的实验输出，继续明确其具体边界。
- [ ] 结构/回读成功只记为相应层级的证据，第三方 SDLTM → TMX 只记为第三方可读；没有原生证据时不宣称原生兼容。保留集专业 F1、浏览器/手机端端到端和性能关卡仍各自待验，不由实验输出替代，也不标记完整三格式互转交付。

## Task 6：静态交付验收

**Files:** 更新工具说明、依赖/许可清单、`DEV.md`；不打包用户样本。

- [x] 类型检查、lint 和 Vite 生产构建已通过。
- [ ] 核验最终发布资源及运行时无 `node:fs`、宿主机程序或外部转换服务依赖；本地 Node 核验脚本不计为成品运行依赖。
- [ ] 用静态预览核对 TMX↔RTF、双文档→人工复核→导出，并按 Task 5 验证 TMX→SDLTM 实验出口、损失/保护标签提示和「不保证兼容 Trados」文案。通用 SDLTM→TMX/RTF 读取按 Task 3 单列，不因实验写出而标为完成；原生兼容性独立记录。
- [ ] 浏览器 Network 证据表明文件正文不外传，模型/WASM 来自本站；首次下载后断网完成相同任务。
- [ ] 记录大文件耗时/内存、取消与失败恢复表现；对无法支持的文件给出可理解的诊断。
- [ ] 检查发布包单文件大小，并在 PC、实际 iOS/Android 上验收导入、人工校正、取消、导出；手机默认使用适合内存和计算能力的资源配置。
- [ ] 提交实施记录，明确已交付能力和实验能力。

## 已有证据如何使用

用户技术文档包含 30 TU 的第三方读取及 44 TU 的结构/回读经验，可以指导浏览器移植。它没有证明通用哈希、分词、模糊索引算法或任意新内容的 Trados 原生兼容性。真实样本确认五份数据库 schema 一致、180 条正文可对应，但 `alignment_data` 为空、模型/词表资源表为空，也没有内联标签；这些空值不能推定为所有 SDLTM 的通用规则。

本轮已有 SDLTM 实验实现、五组 183 条本地输出与独立核验、反向特殊字符和四条手选方向路径的实际证据，见 Task 5。原生参考库 180 条与输出的差异仅为空侧/双空三条；TMX header 与原生库方向不同，对照采用明确的工作方向。浏览器/手机端端到端、专业 F1 和 Trados 原生兼容仍未验收。历史研究/审查中关于正式兼容性的关卡继续用于其对应声明，不阻断用户已授权的实验输出。

研究来源、版本、许可和原始路径集中保存在 Spec 中；后续证据继续按代码接入、本地回放、浏览器端到端和原生兼容分层记录，已验证实现与待验目标分别维护。
