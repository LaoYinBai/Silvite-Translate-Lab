# SDLTM 逆向技术规格（终稿 v3）

日期：2026-11-07
本文档为 SDLTM 导出/导入实现的**最终技术依据**，整合 v2 之后新完成的运行时验证（Trados 官方引擎 Direct Load Oracle）与真实样本对拍结果。证据标记沿用 v2：[已验证]（引擎/数据双重验证）、[已确认]（二进制直接观察）、[部分破解]、[未解]。

## 0. 最重要的方法论升级：引擎神谕（Oracle）

本机 Trados 安装的官方程序集可以在 **32 位 PowerShell** 中直接加载并调用（UTF-8 带 BOM 脚本；需预加载 `icuuc59.dll` 等原生库；`Sdl.LanguagePlatform.*` 均为 anycpu/.NET 4.5）：

```powershell
# 必须 32 位：C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe
[Reflection.Assembly]::LoadFrom("$dir\Sdl.LanguagePlatform.Core.dll")
[Reflection.Assembly]::LoadFrom("$dir\Sdl.Core.LanguageProcessing.dll")      # ICU 分词依赖
[Reflection.Assembly]::LoadFrom("$dir\Sdl.LanguagePlatform.Lingua.dll")      # Hash/LanguageTools
[Reflection.Assembly]::LoadFrom("$dir\Sdl.LanguagePlatform.TranslationMemoryImpl.dll")  # TokenSerialization
# 预 LoadLibrary icuuc59.dll / icuin59.dll 后再分词
```

可用的决定性 API [已验证]：
- `[Sdl.LanguagePlatform.Lingua.Hash]::GetStrictHash(string)` / `GetHashCodeLong` / `GetHashCodeInt` / `ComputeStrictIdentityString(Segment, LanguageTools)`
- `LanguageTools(LanguageResources(culture), BuiltinRecognizers, TokenizerFlags)` + `EnsureTokenizedSegment(seg)` → 分词、`ComputeTokenFeatureVector`、`ComputeCharFeatureVector(FeatureVectorType, seg, n, bool, out)`
- `TokenSerialization::SaveTokens(Segment) → byte[]` / `LoadTokens(byte[], Segment)`（嵌套类 `+TokenSerializer`/`+TokenDeserializer`）
- `LanguageTools.TokenizerSignature / StoplistSignature / StemmerSignature`
- `Storage.SqliteStorage(string path)`、`StorageFactory`（可引擎直写库，用于生成黄金数据）

**一切格式疑问的最终裁判 = 神谕脚本**，已固化在 `D:\Trados-SDLTM\tm-analysis\scripts\`（probe5/oracle2~8、export_tokens、parity3）。

## 1. 已完全验证的规格（可放心实现）

### 1.1 容器与 Schema
同 v2：SQLite 3；schema 以内嵌 `CreateSchemaSQLite.sql` 为准；`parameters` 五行（VERSION=8.06、VERSION_CREATED=8.10、FREQUENCYTOP=1000、TokenDataVersion=1、AlignmentDataVersion=1）。

### 1.2 精确匹配哈希 GetStrictHash [已验证]
```
identity = ComputeStrictIdentityString(分词后 Segment)   // 通常 == 原文（见 1.3）
bytes    = UTF16LE(identity)
h = Fnv1a32(bytes) + (Jenkins32(bytes) & 0xFFFF0000) + (len & 0xFFFF)   // uint64 加法
h ∈ {0, 2^64-1} → h = -2；存为 signed i64
```
**多文件实测**（JS 实现直接对拍原生库）：sample9 41/41+40/41、s10 47/48+44/48、s20 9/19+9/19。
唯一系统性偏差 = **Glossary Converter 数字区间类 TU 的写入不一致**（见 1.4），非本算法缺陷；Trados reindex 会用自身分词器重算全部哈希，此类偏差会被修复。

### 1.3 身份串（严格模式）[已验证]
- 基于**分词后 token**逐个取 `EscFn(token.Text)` 拼接；EscFn 仅做 `\ → \\`。
- 常见文本（无数字/特殊连字符）恒等于原文。
- **识别器相关例外** [已验证]：`BuiltinRecognizers` 含日期/时间/数字/度量/破折号识别时，相应 token 的 Text 使用归一化形式（例：`state‑capital` 在 RecognizeAll 下身份串 ≠ 原文，引擎可精确复现样本哈希 1778485313）。浏览器端复刻需实现对应归一化规则或使用神谕预生成。
- 空白 token（type=Whitespace）参与拼接（样本英文句全部按原文哈希命中）。

### 1.4 Glossary Converter 写入不一致（解释历史疑点）[已验证]
文件 20 的数字统计句（"4.5%－5%"、"5.5%" 等）与其英文译文：存储 hash ≠ 引擎在**任何**识别器/标志/culture 组合下对该 segment 文本的计算值；其 token BLOB 也无法通过 `LoadTokens` 的文本对齐校验。结论：GC 对这类 TU 的哈希/token 来自与最终存储文本不一致的中间态（GC 自身缺陷或私有归一化）。**影响**：这类 TU 在 Trados 精确搜索中本来就不可达（fuzzy 可经由特征命中），reindex 后恢复正常。样本 9/10/19/25 合计 178/180 哈希可由引擎复现（≥98.9%）。

### 1.5 模糊索引 `fuzzy_data`（完整语义，最终版）[已验证]
每 TU 一行，四列 = **双侧 × 两级特征**，特征计算输入 = **分词 token 流**：

| 列 | 侧 | 内容 | 计算 |
|---|---|---|---|
| fi1 | 源 | 词特征 | `GetHashCodeInt(token.Fingerprint ?? stem/lower(text))`，仅词类 token，去重升序 |
| fi2 | 源 | 字符二元组 | 对源 token 流上**字符级 2-gram**哈希（`GetHashCodeLong` 系） |
| fi4 | 目标 | 字符二元组 | 同 fi2，作用于目标 token 流（英文 ASCII 对 → 3106–3963 值域） |
| fi8 | 目标 | 词特征 | 同 fi1 作用于目标 token 流（int32 环绕 → 长词呈负值） |

引擎神谕逐点验证：fi1 = `ComputeTokenFeatureVector` 输出（sample9 41/41、s10 47/48）；fi2 = `ComputeCharFeatureVector(ForTM, n=2)` 去重（TU1 47/47）；fi4 113/113（TU1）。序列化 = 特征升序去重后 `|` 连接。

- **词干化** [已验证]：英文词特征基于词干（`StemmerSignature=RuleBased1`）。经验规则：plans→plan、policies→polici、resources→resourc、promote→promot、development→develop、integrated→integr、coordination→coordin、education→educ、mechanisms→mechan、science→scienc、technology→technolog、institute→institut；停用词（we/will/of/and/on/this/to）不词干化。完整规则表在 `Sdl.Core.LanguageProcessing.Stemmers.dll`，可用神谕批量导出。
- **JS 复刻现状**：fi1 完全复刻 ✓；fi2/fi4 的流边界（`|` 包边假设部分命中 14/41）与词干表尚未完全复刻——**路线 B 实现时应以神谕批量导出（文本 → 四列特征）作为黄金向量驱动 JS 实现，不要继续黑盒猜**。
- 引擎还提供 `GetHashCodeLong(TokenizerSignature)`（分词配置签名）——`tokenization_sig_hash` 即 TM 分词设置签名的哈希，配置相关；样本值 9077876807420713840 对应 GC 的默认设置。

### 1.6 Token BLOB（`source_token_data`）[已验证]
`TokenSerialization.SaveTokens(segment)` 的输出与原生样本**逐字节一致**（TU1：`0216000100000002 81 02 …`，42 字节）。结构：版本字节（2=Version1Compact）、token 数、头部、逐 token 记录（class|flags 字节 + 编码文本/跨度）；`LoadTokens` 可解任意原生 BLOB（41 文件 82 侧全解成功）。**路线 B 的最短实现 = 用神谕批量生成 BLOB 提取字节规则，或（若允许宿主组件）直接调用该 API**。

### 1.7 `translation_unit_fragments.fragment_hash` [未解]
41 行样本已有；候选（原文/译文身份串/features 串的 GetHashCodeLong）均未命中。攻关入口：`SqlStorage::AddFuzzyIndexData`/`insert_tu_fragments` 写入端 IL + 神谕（用 SqliteStorage 引擎直写一个受控 TU 后回读）。优先级低（reindex 会重写）。

## 2. 路线规格

### 2.1 路线 A（推荐首发）：待索引库
与 v2 §9 一致（正确 GetStrictHash、原生 XML、flags=393473、`tokenization_sig_hash=NULL`、不写派生表），新增两点：
1. 哈希按 §1.2/1.3 实现；身份串在无分词器的浏览器端以"原文 + 反斜杠转义"为默认，对含 `‑`（U+2011）/全角连字符/数字区间的 TU，可选调用神谕预生成或直接接受 reindex 修复（**哈希只影响 reindex 前的精确命中，不阻塞文件接受与重建**）。
2. 空侧记录：参照管线（GC）会丢弃空侧 TU（TMX 183 → SDLTM 180）；导出默认**排除双空记录**，单侧空列入损失清单由用户决定。

### 2.2 路线 B（完全自生成索引）
实现顺序（以神谕为验收）：
1. 导出目标语言对的词干规则表 + 分词词典行为（神谕批量：文本→tokens）；
2. JS 复刻分词 → 特征四列（§1.5）→ 与神谕黄金向量逐 TU 对拍至 100%；
3. Token BLOB 序列化复刻（§1.6，从 SaveTokens 输出提取字节规则）；
4. `tokenization_sig_hash`：固定设置下复算 `GetHashCodeLong(TokenizerSignature)`，或直接复用神谕导出常量；
5. fragment_hash（§1.7）与 `MINHAVING` 搜索阈值从引擎 SQL/常量提取。

## 3. 真实测验记录（2026-11-07，样本 = 用户 5 组素材）

| 测试 | 结果 |
|---|---|
| 引擎神谕复现原生哈希（sample9） | 81/82（唯一偏差=GC 数字类缺陷 TU26 族） |
| JS GetStrictHash vs sample9 | 源 41/41、目标 40/41（同上偏差） |
| JS GetStrictHash vs s10 / s20 | 47/48+44/48、9/19+9/19（s20 偏差集中于数字统计句=GC 缺陷类） |
| JS fi1（词特征数学） | sample9 41/41、s10 47/48 |
| 引擎 fi2/fi4 对照原生列 | TU1 47/47、113/113（语义与公式确证） |
| Token BLOB 逐字节 | SaveTokens 输出 == 原生 BLOB |
| LoadTokens 解码 | sample9 82/82 侧全解 |
| 分词器配置扫描 | RecognizeAll 复现 U+2011 类；数字区间类任何配置不可复现（GC 缺陷） |

## 4. 复现与工件
- 引擎神谕脚本：`D:\Trados-SDLTM\tm-analysis\scripts\`（32 位 PS 运行）
- 官方 DDL/元数据/样本库/对拍脚本：同目录 `out\`
- 引擎程序集版本：Lingua 1.12.9.0 (`eedeefcb…`)、TranslationMemoryImpl 1.13.73.0 (`48365f78…`)、Core 1.12.9.0 (`ea83aaa1…`)，Studio16 目录，来自本机 `C:\Program Files (x86)\SDL`
- 对照样本：`D:\桌面\文档\中英对齐素材\`（Glossary Converter 6.0 生成；其 SDLTM 通道按官方文档依赖本机 Studio，不构成"脱离 Trados 生成"的先例——本项目的可行性依据是 SQLite 容器 + 上述已验证算法 + 引擎神谕可离线产出黄金数据）

## 5. 与 v2 的差异
1. GetStrictHash 从"高置信候选"升级为 [已验证]（引擎直证 + 三文件对拍）；"历史编辑残留"假设撤回，TU26 类归因于分词识别器（引擎可复现）与 GC 数字类缺陷（引擎不可复现、reindex 自愈）。
2. "Glossary Converter 证明第三方可行"撤回（其依赖宿主 Studio）；可行性论证改为格式开放性 + 算法验证 + 神谕。
3. fi 四列语义最终澄清：双侧 × 词/字符两级（v2 误述为同侧 1/2/4/8-gram）。
4. Token BLOB 从 [未解] 升级为 [已验证]（SaveTokens 逐字节一致）。
5. 新增引擎神谕方法论与真实测验记录。
