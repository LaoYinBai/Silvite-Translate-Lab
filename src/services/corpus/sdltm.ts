import { validateCorpusProject } from './persistence';
import { requireBilingualDirection, variantOf, type CorpusProject } from './types';
import { assertXmlCharacters } from './xml';

export interface SdltmInput {
  name: string;
  sourceLanguage: string;
  targetLanguage: string;
  pairs: Array<{ source: string; target: string }>;
}
export interface SdltmResult {
  bytes: Uint8Array<ArrayBuffer>;
  validation: { level: 'local_structural'; units: number; sourceLanguage: string; targetLanguage: string };
}

export function sdltmInput(project: CorpusProject): SdltmInput {
  validateCorpusProject(project);
  requireBilingualDirection(project.sourceLanguage, project.targetLanguage);
  if (!project.units.length) throw new Error('没有可导出的语料。');
  const culture = (language: string) => {
    const canonical = Intl.getCanonicalLocales(language.replaceAll('_', '-'))[0];
    return canonical === 'zh' ? 'zh-CN' : canonical === 'en' ? 'en-US' : canonical;
  };
  const pairs = project.units.map((unit, index) => {
    const side = (language: string) => {
      const key = (value: string) => value.trim().replaceAll('_', '-').toLowerCase();
      const matches = unit.variants.filter(variant => key(variant.language) === key(language));
      if (matches.length > 1) throw new Error(`第 ${index + 1} 行含重复的 ${language} 变体，无法唯一确定 SDLTM 对应文本。请保留 TMX 并先整理重复语言记录。`);
      return matches[0] || variantOf(unit, language);
    };
    const source = side(project.sourceLanguage), target = side(project.targetLanguage);
    if (source.markup !== undefined || target.markup !== undefined) {
      throw new Error(`第 ${index + 1} 行含 TMX 保护标签，暂不能导出 SDLTM。请保留 TMX，或在编辑器中明确转换为纯文本后再试。`);
    }
    assertXmlCharacters(source.text); assertXmlCharacters(target.text);
    return { source: source.text, target: target.text };
  });
  return { name: project.name, sourceLanguage: culture(project.sourceLanguage), targetLanguage: culture(project.targetLanguage), pairs };
}

export function sdltmExportLosses(project: CorpusProject): string[] {
  const input = sdltmInput(project);
  const losses = [
    '不保证兼容 Trados。此功能为实验性 SDLTM 导出，会在浏览器内生成句段哈希、Token 数据和双向模糊索引，并核对数据库结构与逐行回读结果。',
    '按逆向终稿生成 SDLTM，并保留待重建的分词签名。打开后如提示重建索引，请按提示操作，这是本方案的设计行为；Trados 会按自身配置补全语言处理、上下文、片段和词级对齐数据。',
    '仅导出当前中英工作对的纯文本。TMX 属性、备注、作者、时间、额外语言、复核记录等不写入 SDLTM；完整资料请同时保存项目 JSON 或 TMX。',
  ];
  const empty = input.pairs.filter(pair => !pair.source.trim() || !pair.target.trim()).length;
  if (empty) losses.push(`保留 ${empty} 行含空侧的记录，部分 CAT 工具可能忽略这些记录。`);
  if (project.excludedUnits?.length) losses.push(`已排除的 ${project.excludedUnits.length} 行不导出。`);
  return losses;
}

/** Plain-text Segment profile from the implementation guide; one Text element. */
export function sdltmSegment(text: string, language: string): string {
  assertXmlCharacters(text); assertXmlCharacters(language);
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('\r', '&#13;');
  const value = '<Value>' + escape(text) + '</Value>';
  return '<Segment xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">'
    + '<Elements><Text>' + value + '</Text></Elements><CultureName>' + escape(language) + '</CultureName></Segment>';
}

/** .NET Guid.ToByteArray(): the first 4/2/2-byte groups use little endian. */
export function sdltmGuid(uuid = crypto.randomUUID()): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(uuid.replaceAll('-', '').match(/../g)!, pair => Number.parseInt(pair, 16));
  return Uint8Array.from([3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15], index => bytes[index]);
}

function jenkins32(bytes: Uint8Array): number {
  let hash = 0;
  for (const byte of bytes) {
    hash = (hash + byte) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  return (hash + (hash << 15)) >>> 0;
}

function fnv1a32(bytes: Uint8Array): number {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul((hash ^ byte) >>> 0, 16777619) >>> 0;
  return hash;
}

/** GetStrictHash over the plain-text identity; recognizer normalization still requires reindexing. */
export function sdltmHash(text: string): bigint {
  const identity = text.replaceAll('\\', '\\\\');
  // Explicit little endian, independent of the browser's native typed-array byte order.
  const bytes = new Uint8Array(identity.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < identity.length; index++) view.setUint16(index * 2, identity.charCodeAt(index), true);
  // JavaScript bitwise AND is signed; the engine adds the high word as uint32.
  const high = (jenkins32(bytes) & 0xffff0000) >>> 0;
  const hash = BigInt.asIntN(64, BigInt(fnv1a32(bytes)) + BigInt(high) + BigInt(identity.length & 0xffff));
  return hash === 0n || hash === -1n ? -2n : hash;
}
