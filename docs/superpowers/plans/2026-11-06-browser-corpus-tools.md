# 浏览器语料转换与中英对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给翻译专业学生提供在静态网页中运行的 TMX、RTF、SDLTM 转换和中英双文档对齐工具。

**Architecture:** 格式适配器读写统一双语单元，转换和对齐共用预览及人工校正界面。SQLite、WASM 和模型推理在 Worker 内运行，资源随静态站点发布、按需加载；SDLTM 原生兼容性独立验收。

**Tech Stack:** 现有 React / TypeScript / Vite / Zustand；SQLite WASM；RTF 结构解析器；可选 Transformers.js / ONNX 或 Hunalign WASM。后两类组件须完成下述评估再固定依赖。

**Spec:** [2026-11-06 调研与真实样本分析](../../research/2026-11-06-static-conversion-and-alignment.md)。样本摘要见 [inventory](../../research/2026-11-06-sample-inventory.json)，实际数据库结构见 [schema](../../research/2026-11-06-sdltm-schema.sql)。

**状态（2026-11-06）：** 开发方案，尚未实现。用户提供的技术文档及真实样本已分析；第三方读取成功不等于 Trados 原生功能验收通过。

## Global Constraints

- 转换与对齐只在浏览器内计算；运行时不依赖宿主机软件、Trados DLL、Python、Node 服务或转换 API。现有在线翻译/STT 服务与本工具的运行条件分别记录。
- WASM、模型、分词器和词典自托管；资源首次下载后可缓存，不能将“首次需要下载资源”混同于“文档需要上传”。
- 兼顾手机与 PC：窄屏可导入、复核和导出，触控操作不依赖 hover；在实际 iOS/Android 上核验文件选择、下载与内存，模拟器通过不能代替真机验收。
- 资源符合现有 EdgeOne Pages 的 25 MB 单文件上限；大模型/词典使用静态分片并在浏览器内校验重组，发布包不能夹带超限原始资源。
- 优先满足个人学习使用；第一阶段不增加班级、教师、作业或账号系统。
- 中英方向由单元的实际语言和用户确认决定，不能只信 TMX header。空源文、空译文和双空行均保留并提示。
- 不覆盖原文件；导出为新文件。大文件可取消、显示进度；主线程保持可操作。
- 原文、段落/单元格位置、标签、自定义属性与人工调整可追溯；无法支持的结构须明确提示。
- SQLite int64 全程精确处理，不能经由 JS Number；模板结构不能代替内容相关的哈希、分词和模糊检索数据。
- SDLTM 完成标准包括原生打开、导出、精确/模糊检索、编辑、重新打开；不能要求每次转换后都借助桌面软件修复。
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
| `src/stores/useCorpusStore.ts` | 导入状态、双语行、人工校正和会话保存 |
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

## Task 1：统一模型、编辑器和任务生命周期

**Files:** 新建 `types.ts`、`corpus.worker.ts`、`useCorpusStore.ts`、`CorpusTools.tsx`；修改 App 和 Sidebar；验证文件 `tests/corpusModel.test.mjs`。

**Interfaces:** 产出上述 Corpus / StructuredDocument / JobOptions；编辑动作按 unitId 操作，支持拆分、合并、修改、两侧留空及撤销；会话 JSON 保存模型版本。

- [ ] 为 `空源文/空译文/双空保留`、`编辑后撤销恢复原文及 segmentIds`、`取消后旧 jobId 结果被忽略` 编写验证用例。
- [ ] 运行 `node --test tests/corpusModel.test.mjs`，确认新模块缺失或行为未实现时失败。
- [ ] 实现模型、编辑动作、Worker 协议和两个流程的界面，导入后必须先预览再导出。
- [ ] 同一命令全部通过；浏览器检查重复导入、取消、会话恢复。重计算中仍可点击取消。
- [ ] 提交这一可独立演示的增量。

## Task 2：TMX 与常见 RTF 双向转换

**Files:** 新建 `tmx.ts`、`rtf.ts`、`tests/corpusFormats.test.mjs`；接入任务 1。

**Interfaces:** 实现 `parseCorpus('tmx' | 'rtf', bytes, options)` 与 `exportCorpus('tmx' | 'rtf', corpus, options)`。RTF 导入允许用户选择原文/译文列；普通单语 RTF 转入双文档对齐流程。

- [ ] 验证 TMX 的 `xml:lang` 优先于冲突 header、实体与 `bpt/ept/ph`、多语言选择、空侧、元数据和往返一致性。
- [ ] 验证 RTF `\uN` 有符号 UTF-16、`\ucN` 回退跳过、同一行重复 `\trowd`、单元格换行及中文导出再导入。
- [ ] 运行 `node --test tests/corpusFormats.test.mjs`，先确认缺失能力失败。
- [ ] 实现 TMX 适配器、样本式双栏 RTF 读写；评估 Pandoc WASM 表格 AST 并锁定版本及许可。旧 Trados 隐藏源文/分段标记单独检测和解析，不能先丢弃隐藏文字；复杂合并表格超出支持范围时显示提示。
- [ ] 同一命令全部通过；在本机用私有五组样本核对 RTF/TMX 共 183 行，导出保留空侧。
- [ ] 提交支持范围及实测限制。

## Task 3：浏览器 SDLTM 读取

**Files:** 新建 `sdltm.ts`、SQLite Worker 适配层、`tests/sdltmRead.test.mjs`；资源路径在实现时固定并随构建发布。

**Interfaces:** 实现 `parseCorpus('sdltm', bytes, options)`；读取 schema 后选取支持的列，输出相同 Corpus。以 Maxprograms TMReader 为结构参考，移除 Node 文件系统/SQLite 依赖。

- [ ] 验证合成 13 表与 20 表结构、`9077876807420713840n` 精确往返、Text/Tag、Elements 与 LastElement 去重、自定义字段和不支持版本提示。
- [ ] 运行 `node --test tests/sdltmRead.test.mjs`，确认缺失能力失败。
- [ ] 以官方 SQLite WASM 内存数据库导入 Uint8Array，按实际表列读取；不强制 OPFS。保留可解释的日期、用户、属性、标签及原始字段。
- [ ] 同一命令全部通过；本机五份 SDLTM 共 180 TU，与对应 TMX 正文按既定换行规则核对。
- [ ] 记录三条数量差异：9、20 组各缺一双空行，10 组缺一空中文/非空英文行。导入输出不伪造这些不存在的 TU。
- [ ] 提交读取支持及结构诊断。

## Task 4：中英双文档对齐与人工复核

**Files:** 新建 `segment.ts`、`align.ts`、`tests/alignment.test.mjs`；扩展结构解析及共用编辑器。

**Interfaces:** `alignDocuments(source: StructuredDocument, target: StructuredDocument, anchors: { sourceId: string; targetId: string }[], options: JobOptions): Promise<Corpus>`；返回 1:1、1:N、N:1、1:0、0:1，保留原句范围和算法原始分数。

- [ ] 建立人工标注的公开合成夹具，覆盖缩写/数字、错分句、漏译、多句对应、人工锚点、换序、重复句及连续运行两次无前次结果。
- [ ] 运行 `node --test tests/alignment.test.mjs`，确认缺失能力失败。
- [ ] 给文档解析增加段落/表格结构输出；现有纯文本结果和翻译请求 chunker 不作为对齐关系。
- [ ] 比较多语 MiniLM + JS 动态规划与 Hunalign WASM：固定夹具上的对齐准确性、耗时、峰值内存、资源下载量和许可。语义路线优先评估，约 118 MB 的量化模型及 tokenizer 延迟加载；WebGPU 可选，WASM 能运行。
- [ ] Hunalign 若入选，修复实例复用时 printLog 未清空；中文分词和词典遵循同一规则，确认词典许可。其分数不显示为正确概率。
- [ ] 同一命令全部通过；浏览器断网缓存运行、资源下载失败重试、推理中取消、手动锚点及空侧调整均可演示。换序无法由单调算法处理时必须允许人工调整。
- [ ] 提交实际算法选择、质量指标和支持边界。

## Task 5：SDLTM 写出候选与原生兼容性关卡

**Files:** 扩展 `sdltm.ts`；新建 `tests/sdltmWrite.test.mjs`、`docs/research/sdltm-native-compatibility.md`。

**Interfaces:** `exportCorpus('sdltm', corpus, options)` 先作为实验能力；只有原生关卡通过的结构/内容组合进入正式支持矩阵。

- [ ] 为合成 TU 建立结构、int64、Segment XML、语言方向、计数和反向读取验证，运行 `node --test tests/sdltmWrite.test.mjs` 并确认未实现时失败。
- [ ] 按用户已验证的“真实空模板 + SQLite 注入”路线建立候选，结合五份真实样本的 20 表、25 显式索引和新增字段适配；审查模板许可及静态发布内容。
- [ ] 逐项确认 source/target hash、token BLOB、tokenization 签名、fuzzy_data 和片段数据的生成/合法重建条件。不能将 SQLite CREATE INDEX 当作 Trados 语义索引重建；不能把样本旧 TU 的派生值复制给新句子。
- [ ] 同一命令通过只记为结构/回读成功；第三方 SDLTM→TMX 记为第三方可读。
- [ ] 使用全新中文、英文、标点、重复段、空侧和内联标签内容，在已装 Trados 2021 中逐项验证：打开、计数/语言、TMX 导出、精确检索、模糊检索、编辑保存、关闭再打开。保存应用版本、步骤及结果。
- [ ] 原生关卡未通过时保留“实验”标识及具体缺口，正式工具仍可导出 TMX/RTF；不宣称三格式互转已经完整交付。
- [ ] 提交兼容性矩阵及复现材料。

## Task 6：静态交付验收

**Files:** 更新工具说明、依赖/许可清单、`DEV.md`；不打包用户样本。

- [ ] `npm run build` 成功；构建资源无 `node:fs`、宿主机程序或外部转换服务运行依赖。
- [ ] 用静态预览完成 TMX↔RTF、SDLTM→TMX/RTF、双文档→人工复核→导出；写出 SDLTM 按任务 5 支持矩阵验收。
- [ ] 浏览器 Network 证据表明文件正文不外传，模型/WASM 来自本站；首次下载后断网完成相同任务。
- [ ] 记录大文件耗时/内存、取消与失败恢复表现；对无法支持的文件给出可理解的诊断。
- [ ] 检查发布包单文件大小，并在 PC、实际 iOS/Android 上验收导入、人工校正、取消、导出；手机默认使用适合内存和计算能力的资源配置。
- [ ] 提交实施记录，明确已交付能力和实验能力。

## 已有证据如何使用

用户技术文档包含 30 TU 的第三方读取及 44 TU 的结构/回读经验，可以指导浏览器移植。它没有证明通用哈希、分词、模糊索引算法或任意新内容的 Trados 原生兼容性。真实样本确认五份数据库 schema 一致、180 条正文可对应，但 `alignment_data` 为空、模型/词表资源表为空，也没有内联标签；这些空值不能推定为所有 SDLTM 的通用规则。

研究来源、版本、许可和原始路径集中保存在 Spec 中；后续实现发现新证据时同步更新，不将这份方案写成已经完成的实现说明。
