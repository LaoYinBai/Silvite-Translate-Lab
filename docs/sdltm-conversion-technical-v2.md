# SDLTM 逆向技术规格与导出实现规范（v2）

更新日期：2026-11-07
本文档取代《sdltm-conversion-technical.md》（v1）中所有关于文件格式与算法的描述，是 SDLTM 导出器的**实现依据**。v1 中与工程流程相关的内容（Worker 架构、资源校验、损失清单、UI 流程）继续有效，本文不重复。

证据标记：
- **[已验证]**：算法/格式从 Trados 官方二进制 CIL 级还原，并对真实 SDLTM 数据完成比对验证，给出验证数字。
- **[已确认]**：从二进制直接观察到的事实（SQL、字段、常量），未经数据对拍。
- **[部分破解]**：机制已知，精确公式或细节未完全还原。
- **[未解]**：仅有定位信息，留待后续逆向。

逆向对象：`%ProgramFiles(x86)%\SDL\SDL Trados Studio\Studio16\` 下 `Sdl.LanguagePlatform.Lingua.dll`（哈希与特征核心）、`Sdl.LanguagePlatform.TranslationMemoryImpl.dll`（TM 存储）、`Sdl.LanguagePlatform.Core.dll`（分词/Segment）。
对照样本：`local sample directory\` 下 5 个真实 SDLTM（`description = "Created by Glossary Converter"`，即由 RWS Glossary Converter 生成并被生态正常使用——这本身即第三方工具产出 SDLTM 可行的先例）。
分析工件：`local analysis artifacts\tm-analysis\`（提取的官方 DDL、验证脚本、IL 反汇编器、元数据全套，见附录 A）。

---

## 1. 总体结论

1. SDLTM 是**标准 SQLite 3 数据库**，无任何私有封装 [已验证]：5 个样本文件头均为 `SQLite format 3\x00`，系统 sqlite3 可直接打开读写。生成器不需要 Trados、不需要 SQL Server CE。
2. Schema 有**官方权威定义**：`Sdl.LanguagePlatform.TranslationMemoryImpl.dll` 内嵌 `CreateSchemaSQLite.sql`（含全部建表/索引/参数 INSERT），已完整提取并 SHA-256 校验 [已确认]。生成器的 schema 不再依赖"对样本结构的观察"。
3. 精确匹配哈希（`source_hash`/`target_hash`）算法**已完全还原并通过真实数据验证（81/82）** [已验证]，见 §6。v1 的 SHA-256 占位哈希作废。
4. 模糊索引（`fuzzy_data` 的 fi 列）主链路已还原 [已验证/部分破解]，见 §7。但走路线 A 时**生成器不需要生成任何索引数据**（见 §8、§9）。
5. `tokenization_sig_hash = NULL` 的确切后果已查明 [已确认]：整库进入"需重建索引"状态，Trados 引擎有完整批量 reindex 管线可自行补全全部派生数据。这是路线 A 的基石。
6. 原生 Segment XML **没有 `LastElement`** [已验证：41 条 TU 的 source/target 共 82 个 XML 中出现 0 次]。v1 写入器多写了该元素，应删除。

## 2. 容器格式

- 格式：SQLite 3（`SELECT sqlite_version()` 样本库为 3.x，页大小 4096）。扩展名 `.sdltm`。
- 写入方式与 v1 相同：SQLite WASM 内存库 → 校验 → VACUUM → 导出字节。此部分不变。
- 日期格式：`YYYY-MM-DD HH:MM:SS` 文本（SQLite TEXT 惯例），如 `2026-11-05 13:01:50`。
- BLOB：`guid` 为 16 字节 .NET Guid 字节序（前 4/2/2 字段 little-endian），与 v1 实现一致。

## 3. 权威 Schema

以提取的 `CreateSchemaSQLite.sql` 为准（附录 A 路径），要点：

- 核心表 20 张：`translation_memories`、`translation_units`、`fuzzy_data`、`translation_unit_fragments`、`translation_unit_contexts`、`translation_unit_idcontexts`、`attributes`、`string_attributes`、`numeric_attributes`、`date_attributes`、`picklist_values`、`picklist_attributes`、`resources`、`tm_resources`、`parameters`、`vocab_src`、`vocab_trg`、`vocabfilter`、`trans_model`、`trans_model_rev`。
- `parameters` 初始行 [已确认]：`VERSION=8.06`、`VERSION_CREATED=8.10`、`FREQUENCYTOP=1000`。真实样本还包含 `TokenDataVersion=1`、`AlignmentDataVersion=1`（v1 已写，继续）。
- 与 v1 模板差异提示：v1 模板来自 RWS 示例 `General En-Fr.sdltm`（VERSION_CREATED 为 8.06）。建议写入时将 `VERSION_CREATED` 更新为 `8.10`（与真实样本一致）。
- `translation_memories` 新版列：`flags`（默认 0）、`tucount`（TU 计数，必须维护）。

真实样本（Glossary Converter 产出）各表行数实测 [已验证]：

| 表 | 行数 | 说明 |
|---|---|---|
| translation_memories | 1 | |
| translation_units | 41 | 每句对一行 |
| fuzzy_data | 41 | 每 TU 一行（fi1..fi8 特征串） |
| translation_unit_fragments | 41 | 每 TU 一行（fragment_hash = i64） |
| attributes | 1 | 1 条属性声明（工具自带） |
| 其余全部 | 0 | contexts / idcontexts / 各属性值表 / vocab_* / trans_model* / resources |

**即：除 `translation_units`、`fuzzy_data`、`translation_unit_fragments` 外，其余表可以为空。**

## 4. Segment XML 规范

原生格式（唯一被观察到的形态）[已验证]：

```xml
<Segment xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><Elements><Text><Value>正文</Value></Text></Elements><CultureName>zh-CN</CultureName></Segment>
```

- **没有 `LastElement`**。v1 写入器把同一 Value 复制进 `LastElement` 的做法必须移除（该做法依赖 Trados 反序列化器的容错，且原生文件 0/82 出现）。
- 正文中的换行按原样保留在 `Value` 内（样本存在含 `\n` 的 Value，哈希按含 `\n` 的原文精确匹配 [已验证]）。
- XML 属性转义按标准；样本中出现过的实体形态即标准五种。
- `CultureName` = 该侧语言标签（`zh-CN` / `en-US`）。

## 5. `translation_memories` 与 `translation_units` 字段对照表

### translation_memories（真实样本实测值）[已验证]

| 列 | 原生值（样本） | 生成器写入建议 |
|---|---|---|
| id | 1 | 1 |
| guid | 16B | crypto.randomUUID 转 .NET 字节序（同 v1） |
| name | `26政府工作报告9` | 项目名 |
| source_language / target_language | `zh-CN` / `en-US` | 工作方向（现有实现保留） |
| copyright / description | 空 / `Created by Glossary Converter` | description 写清本工具标识，便于溯源 |
| settings | **63** | 63（v1 已正确） |
| creation_user | `WORKSTATION\user` | 任意（建议与 creation_date 一致的占位用户） |
| creation_date / expiration_date | 时间 / 空 | 当前时间 / NULL |
| fuzzy_indexes | **15** | 15（= 索引 1\|2\|4\|8 位集，v1 已正确） |
| last_recompute_date / last_recompute_size | NULL / NULL | NULL |
| flags | 0 | 0 |
| tucount | 41 | 精确 TU 数（v1 已写） |
| fga_support | 1 | 1 |
| data_version | 1 | 1 |
| text_context_match_type | 1 | 1 |
| id_context_match | 0 | 0 |

### translation_units（真实样本实测值）[已验证]

| 列 | 原生值 | 生成器写入建议 |
|---|---|---|
| id | 自增 1..N | 自增 |
| guid | 16B | 同 v1 |
| translation_memory_id | 1 | 1 |
| source_hash / target_hash | **GetStrictHash 结果（§6）** | **必须改为真算法** |
| source_segment / target_segment | §4 XML | 同 v1 但删除 LastElement |
| creation_date / change_date / last_used_date | 同一时刻 | 全部 = 导出时间 |
| creation_user / change_user / last_used_user | 同一用户 | 同一占位用户 |
| usage_counter | 0 | 0 |
| flags | **393473**（0x60101） | 建议 393473（TMX 导入路径的打包位：推测含 origin/confirmationLevel 等，具体位义未解，照抄观察值） |
| source_token_data / target_token_data | 有值（Token BLOB） | **NULL（路线 A）** |
| alignment_data / align_model_date | 空 / NULL | NULL |
| insert_date | 创建后 1 秒 | 导出时间 |
| tokenization_sig_hash | 9077876807420713840（设置签名常量） | **NULL（路线 A，见 §8）** |

## 6. 哈希算法规范 [已验证]

来源：`Sdl.LanguagePlatform.Lingua.Hash`（CIL 完整还原）。所有哈希在 **UTF-16 代码元**（code unit，即逐 `char`，含代理对拆分）上迭代，不是码点。

### 6.1 词级哈希（特征值的基础）

```
GetHashCodeLong(s):  h = 0 (int64);  for c in s: h = h*31 + (uint16)c   (int64 环绕)
GetHashCodeInt(s):   h = 0 (int32);  for c in s: h = h*31 + (uint16)c   (int32 环绕)
```
单字词的特征值即其码点（如 `的`=30340、`动`=21160 [已验证]）。

### 6.2 字节哈希

```
Fnv1a32(bytes):   h = 2166136261;      for b: h = (h ^ b) * 16777619   (uint32)
Jenkins32(bytes): h = 0;               for b: { h += b; h += h<<10; h ^= h>>>6 }
                  收尾:                { h += h<<3; h ^= h>>>11; h += h<<15 }  (uint32)
```

### 6.3 `GetStrictHash` —— `source_hash` / `target_hash` 的计算

```
identity = 存入 <Value> 的正文原文，先做 EscFn："\\" → "\\\\"（反斜杠翻倍）
           （含标签的句段另有 \uF100 系标记方案，纯文本场景用不到）
bytes   = UTF16LE(identity)
r       = Fnv1a32(bytes) + (Jenkins32(bytes) & 0xFFFF0000) + (identity.length & 0xFFFF)
          （三项均按 uint32 零扩展后做 uint64 加法；结果域 ≈ [0, 2^33)）
if r == 0 或 r == 2^64-1: r = -2
source_hash = (int64)r
```

要点：
- **无空白归一化**：换行、多空格按原样参与（已用含 `\n` 的句对验证）[已验证]。
- 无 XML 实体残留：哈希输入是转义前（解码后）的正文文本。
- 侧别无关：source 与 target 用同一函数，各自对自己侧的 identity 计算。

### 6.4 验证记录

- 对 `26政府工作报告9.sdltm` 全部 41 TU × 双侧 = 82 个哈希：**81 个精确命中** [已验证]。
- 唯一偏差：TU26 target 文本含 U+2011（非断行连字符）。raw/`-`/U+2010 变换均不命中，推测该行哈希对应历史编辑前的文本（工具自身残留），不影响算法结论。
- 参考实现：`tm-analysis/scripts/verify_hash.mjs`（Node/BigInt，含全部函数与 82 点对拍逻辑），可直接移植为 Worker 内实现。

## 7. 模糊索引机制（`fuzzy_data`）

> 路线 A 不需要生成本节任何数据；本节用于理解 Trados 行为与路线 B 评估。

结构 [已验证]：`fuzzy_data` 每 TU 一行，`fi1/fi2/fi4/fi8` 为 **`|` 分隔的整数特征串**（TU1 fi1 = `21160|30340|…|1149388` 共 17 个特征）。

生成机制 [已验证 + 部分破解]：

1. 句段分词（zh 走词典分词：样本中"评价联动"被切为 `评价`+`联`+`动`；`LanguageTools.TokenizesToWords(CultureInfo)` 判断语言是否支持词级分词，否则字符回退）。
2. token 流以 **`|` 连接**为一个串（如 `建立|健全|一体|推进|的|…|联|动`）。
3. 特征生成：
   - `fi1`：**逐词**特征 = `GetHashCodeLong(token.Fingerprint ?? text.ToLower())`（CIL：`AbstractAnnotatedSegment`/`LanguageTools.ComputeTokenFeatureVector`，输入优先取 token 指纹，回退小写化文本；跳过停用词，`includeStopwords` 参数控制）[已验证：TU1 17/17 词特征逐一对上；1 字符词的哈希恰好等于码点，如 `的`=30340]。
   - `fi2`：对 `|` 连接串的 **2 字符滑窗**逐一 `GetHashCodeLong` [已验证：45/47 命中；差 2 个疑似串首尾哨兵窗，未定论]。
   - `fi4` / `fi8`：**[部分破解]** —— 同哈希族，但实测既非 Int64 也非 Int32 的裸滑窗（fi4 值域被压到 3106–3963 且 113 个特征 > 窗口数 44；fi8 出现 int32 量级的负值）。精确归一化/组合式未还原。
4. 特征去重后升序排序，`|` 连接写入对应列。
5. 匹配侧参数 [已确认]：SQLCE 旧版 schema 的 `MINHAVING1=3 / MINHAVING2=5 / MINHAVING4=5 / MINHAVING8=3` 为各索引级"最小命中特征数"阈值；SQLite 路径该参数在引擎内。
6. 评分：`Lingua.Index` 命名空间（`DiceFeatureVectorOverlapComputer` 等）按特征重叠做 Dice 系数类评分 [已确认，未深入]。

## 8. `tokenization_sig_hash` 与 reindex 管线 [已确认]

- `tokenization_sig_hash` 是**分词器设置的签名**（分词器版本 + 语言资源 + 设置的组合哈希），全库所有 TU 同值（3 个样本实测一致：`9077876807420713840`），与句对内容无关。
- 引擎判定 SQL（`TranslationMemoryImpl` 内字面量）：

```sql
SELECT 1 FROM translation_units
WHERE (tokenization_sig_hash IS NULL OR tokenization_sig_hash <> @sig_hash)
```

即 **NULL 或不匹配 → 该 TU 被视为待重建索引**。
- 引擎含完整批量重建管线 [已确认]：按 `WHERE id > @start_after AND (tokenization_sig_hash IS NULL OR ...) ORDER BY id ASC LIMIT @limit` 分批取 TU，重分词、重算哈希与特征、回写 `tokenization_sig_hash` 与索引数据。Studio UI 侧存在 `ReindexTranslationMemory` 操作、`tm.reindextu` 权限点、语言资源页的 MustReindex 提示与导入向导的 "Reorganizing_Recomputing" 阶段。
- **对生成器的含义（路线 A）**：写入 `tokenization_sig_hash = NULL`、不写 token BLOB、不写 `fuzzy_data`/`fragments`，Trados 侧重建一次即可把全部派生数据补成完全原生形态。`translation_memories.last_recompute_date/size` 保持 NULL 与此状态自洽。

## 9. 生成器写入规范（路线 A 完整清单）

在一个事务内：

1. 打开模板（v1 流程不变），校验恰好 1 个 TM、0 TU、0 resource；清空模板预置属性及其值。
2. schema 按官方 DDL 对齐（§3）；`parameters` 写入 `VERSION=8.06`、`VERSION_CREATED=8.10`、`FREQUENCYTOP=1000`、`TokenDataVersion=1`、`AlignmentDataVersion=1`。
3. 更新唯一 TM 行：按 §5 表格逐列写入（`settings=63`、`fuzzy_indexes=15`、`tucount=N`、`data_version=1`、`text_context_match_type=1`、`fga_support=1`、其余 NULL/0）。
4. 每句对写一行 TU：
   - `source_hash` / `target_hash` = `GetStrictHash(§6.3)`（**替换 SHA-256 占位**）；
   - Segment XML 按 §4（**删除 LastElement**）；
   - `flags = 393473`；时间/用户三组按 §5；`usage_counter=0`；`insert_date` = 导出时间；
   - `source_token_data` / `target_token_data` / `alignment_data` / `align_model_date` / `tokenization_sig_hash` = **NULL**。
5. **不写** `fuzzy_data`、`translation_unit_fragments`、contexts、idcontexts、attributes、vocab、trans_model（全部留空——真实样本仅 attributes 有 1 行工具自带声明，可忽略）。
6. 校验（在 v1 的 integrity/foreign_key/逐行文本回读之上新增）：
   - **哈希对拍**：回读每行，用同一 `GetStrictHash` 实现重算并与库中值比对（自洽性）；
   - **黄金样例对拍**：对 `verify_hash.mjs` 内置的样本句对+哈希常量跑一次（防止实现回归）；
   - `tucount` 与行数一致；GUID 16 字节唯一；语言方向与请求一致。

## 10. 验证协议

### 10.1 本地（每次构建跑）
v1 的本地结构检查全集 + §9.6 新增项。通过级别标注 `local_structural+hash`。

### 10.2 Trados 动态验收（路线 A 的关键门槛，需在装有 Studio 的机器执行）
1. 双击/添加 `.sdltm` 能否正常打开，TM 详情（名称、方向、TU 数）正确；
2. 是否出现"需重建索引"类提示（预期出现，**这是设计行为而非缺陷**）；
3. 执行 reindex 后：精确搜索能命中已写入句对；模糊搜索（改几个词）能返回合理结果；concordance 搜索正常；
4. 添加/编辑/删除 TU 并保存，关闭重开数据完好；
5. 语言方向互换（en→zh）各跑一遍 1–4；
6. （加分）reindex 后用 sqlite3 回读，确认 Trados 已回填 `tokenization_sig_hash`、`fuzzy_data`、token BLOB——回填值即路线 B 的**黄金标准样本**。

任一步失败 → 功能保持实验性标注，并按失败点回修。

## 11. 与 v1 的差异清单

| 项 | v1 | v2 |
|---|---|---|
| `source_hash`/`target_hash` | SHA-256 前 8 字节占位 | `GetStrictHash`（§6），已 81/82 验证 |
| Segment XML | 含 `LastElement` | 删除（原生 0/82） |
| TU `flags` | 未写/0 | 393473 |
| `tokenization_sig_hash` | 未写（NULL） | 保持 NULL，但**语义已明确**＝待重建状态（§8） |
| `VERSION_CREATED` | 沿用模板 8.06 | 写 8.10 |
| schema 依据 | 样本观察 | 官方内嵌 DDL（§3） |
| 校验 | 结构检查 | + 哈希自洽对拍 + 黄金样例回归（§9.6） |
| 兼容性叙事 | "不保证 Trados 兼容" | 分层：格式与哈希已对齐原生（可验证）；检索级兼容待 §10.2 动态验收 |

## 12. 未解事项（路线 B 攻坚目标）

按价值排序，附已定位的入口（分析工具齐备：`ildasm.mjs` 可按方法名反汇编任意 CIL）：

1. **`TokenSerialization`/`TokenSerializer` BLOB 格式**（`source_token_data`）——类已在 `TranslationMemoryImpl`（token 0x02000024/0x96/0x97），样本 BLOB 头 `02 16 00 01 …` 已知。路线 B 必需。
2. **`fi4`/`fi8` 精确变换**——滑窗哈希族确认，归一化层未解；可先用路线 A 让 Trados reindex 后回读黄金数据反推。
3. **`tokenization_sig_hash` 组成**——入口 `GetCurrentTokenizationSignatureHash` / `TokenizerSignature`/`StemmerSignature`/`StoplistSignature`（Impl）。若固定设置下为常量，可直接复用样本值 `9077876807420713840` 规避重建（需先验证 Trados 接受"签名匹配但索引为空"的状态，风险未评估）。
4. **`translation_unit_fragments.fragment_hash` 公式**——41 行样本已有，可对拍反推（候选：整段身份串的另一哈希变体）。
5. **CJK 词典分词复刻**（仅路线 B 且要求生成器本地重算特征时才需要；样本分词结果可作为测试基准）。
6. TU `flags=393473` 的位义（推测 TMX 导入的 origin/confirmationLevel 打包位）。
7. fi2 的 2 个未命中窗（疑似首尾哨兵）。

## 附录 A：证据与工件索引

| 内容 | 路径 |
|---|---|
| 官方建库 SQL（SQLite，SHA-256 `864de7ac…`） | `local analysis artifacts\tm-analysis\out\CreateSchemaSQLite.sql` |
| 官方建库 SQL（SQLCE，含 MINHAVING 参数） | 同目录 `CreateSchemaSQL.sql` |
| 样本库 schema 导出 | 同目录 `sample9_schema.txt` |
| GetStrictHash 验证脚本（81/82） | `local analysis artifacts\tm-analysis\scripts\verify_hash.mjs` |
| fi 列机制验证脚本 | 同目录 `verify_fi.mjs` |
| 自研 .NET IL 反汇编器 | 同目录 `ildasm.mjs`（用法：`node ildasm.mjs <dll> <方法名正则>`，输出带类型/方法/字符串解析） |
| 元数据全套（typedefs / #Strings / #US） | 同目录 `out/typedefs_*.txt`、`strings_*.txt`、`us_*.txt` |
| 真实样本只读副本 | 同目录 `out/sample9.sdltm` |

样本关键常量速查：`tokenization_sig_hash = 9077876807420713840`；TU `flags = 393473`；`settings = 63`；`fuzzy_indexes = 15`；样本 TU1 `source_hash = 3238540131`（对应文本"建立健全一体推进的协调机制，强化规划衔接、政策协同、资源统筹、评价联动。"）。
