import { CORPUS_LIMITS } from './types';

export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
const MAX_XML_NODES = 200_000;
const MAX_XML_DEPTH = 96;

/** Reject characters XML 1.0 cannot represent, including lone UTF-16 surrogates. */
export function assertXmlCharacters(value: string): void {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code !== 9 && code !== 10 && code !== 13
      && !(code >= 0x20 && code <= 0xd7ff)
      && !(code >= 0xe000 && code <= 0xfffd)
      && !(code >= 0x10000 && code <= 0x10ffff)) {
      throw new Error('XML 包含无效字符或不完整的 Unicode 字符。');
    }
  }
}

function declarationEncoding(xml: string): string | undefined {
  if (!xml.startsWith('<?xml ') && !xml.startsWith('<?xml\t')
    && !xml.startsWith('<?xml\r') && !xml.startsWith('<?xml\n')) return undefined;
  const end = xml.indexOf('?>');
  if (end < 0 || end > 4096) throw new Error('XML 编码声明无效或过长。');
  return /\bencoding\s*=\s*(['"])([^'"]+)\1/.exec(xml.slice(0, end))?.[2];
}

function encodingName(label: string): string {
  const lower = label.trim().toLowerCase();
  if (['iso-8859-1', 'iso_8859-1', 'latin1', 'latin-1'].includes(lower)) return 'iso-8859-1';
  if (['us-ascii', 'ascii'].includes(lower)) return 'us-ascii';
  try {
    const name = new TextDecoder(lower, { fatal: true }).encoding;
    if (name === 'replacement') throw new Error();
    return name;
  } catch {
    throw new Error(`浏览器不支持 XML 声明的编码“${label}”。请转换为 UTF-8 后导入。`);
  }
}

/** Uses only browser codecs; never guesses a legacy encoding from text content. */
export function decodeXmlBytes(bytes: Uint8Array): { xml: string; warnings: string[] } {
  if (bytes.byteLength > CORPUS_LIMITS.inputBytes) throw new Error('TMX 文件超过 10 MiB 导入上限。');
  if (!bytes.byteLength) throw new Error('TMX 文件为空。');
  if ((bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
    || (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0)
    || (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0x3c)
    || (bytes[0] === 0x3c && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0)) {
    throw new Error('暂不支持 UTF-32 XML；请转换为 UTF-8 或 UTF-16。');
  }
  let offset = 0;
  let detected: string | undefined;
  let bom = false;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3; detected = 'utf-8'; bom = true;
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    offset = 2; detected = 'utf-16le'; bom = true;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    offset = 2; detected = 'utf-16be'; bom = true;
  } else if (bytes[0] === 0x3c && bytes[1] === 0) detected = 'utf-16le';
  else if (bytes[0] === 0 && bytes[1] === 0x3c) detected = 'utf-16be';

  // XML declarations use ASCII characters in every supported non-UTF-16 codec.
  const prefix = Array.from(bytes.subarray(0, 4097), byte => String.fromCharCode(byte)).join('');
  const declaredBeforeDecode = detected?.startsWith('utf-16') ? undefined : declarationEncoding(prefix);
  const encoding = detected || (declaredBeforeDecode ? encodingName(declaredBeforeDecode) : 'utf-8');
  let xml: string;
  try {
    if (encoding === 'iso-8859-1') {
      // WHATWG maps this label to Windows-1252; XML's ISO-8859-1 does not.
      const chunks: string[] = [];
      for (let start = offset; start < bytes.length; start += 8192) {
        chunks.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
      }
      xml = chunks.join('');
    } else {
      if (encoding === 'us-ascii' && bytes.some(byte => byte > 0x7f)) throw new Error();
      xml = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(offset));
    }
  } catch {
    throw new Error(`XML 字节不是有效的 ${encoding} 编码。`);
  }
  const declared = declarationEncoding(xml);
  if (declared) {
    const name = encodingName(declared);
    const genericUtf16 = /^utf-16$/i.test(declared);
    if (name !== encoding && !(genericUtf16 && encoding.startsWith('utf-16'))) {
      throw new Error(`XML 编码声明“${declared}”与实际字节编码 ${encoding} 冲突。`);
    }
  }
  const warnings: string[] = [];
  if (encoding !== 'utf-8') warnings.push(`已按 ${encoding} 解码；TMX 导出使用 UTF-8。`);
  if (encoding.startsWith('utf-16') && !bom) warnings.push('UTF-16 XML 缺少 BOM，已按字节顺序识别编码。');
  return { xml, warnings };
}

/** Strip only a standalone external TMX DTD declaration, before DOMParser sees it. */
function removeExternalDoctype(xml: string, allowed: boolean): { xml: string; removed: boolean; name?: string } {
  let position = 0;
  let removed = false;
  let name: string | undefined;
  let elementSeen = false;
  const parts: string[] = [];
  let copiedUntil = 0;
  while ((position = xml.indexOf('<', position)) !== -1) {
    const skip = (opening: string, closing: string): boolean => {
      if (!xml.startsWith(opening, position)) return false;
      const end = xml.indexOf(closing, position + opening.length);
      if (end < 0) throw new Error('XML 注释、CDATA 或处理指令未结束。');
      position = end + closing.length;
      return true;
    };
    if (skip('<!--', '-->') || skip('<![CDATA[', ']]>') || skip('<?', '?>')) continue;
    if (!xml.startsWith('<!', position)) {
      elementSeen = true;
      position++;
      continue;
    }
    if (!allowed || !xml.startsWith('<!DOCTYPE', position) || removed || elementSeen) {
      throw new Error('不允许 XML 实体、内部 DTD 或此位置的 DOCTYPE 声明。');
    }
    let quote = '';
    let end = position + 9;
    for (; end < xml.length; end++) {
      const character = xml[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '[') throw new Error('不允许内部 DTD 或 XML 实体声明。');
      else if (character === '>') break;
    }
    const declaration = xml.slice(position, end + 1);
    const literal = '(?:"[^"<]*"|\'[^\'<]*\')';
    const match = new RegExp(`^<!DOCTYPE\\s+([A-Za-z_][\\w.:-]*)\\s+(?:SYSTEM\\s+${literal}|PUBLIC\\s+${literal}\\s+${literal})\\s*>$`).exec(declaration);
    if (!match || end >= xml.length || match[1].split(':').pop() !== 'tmx') {
      throw new Error('只允许不含内部子集的 TMX 外部 DOCTYPE 声明。');
    }
    parts.push(xml.slice(copiedUntil, position));
    copiedUntil = end + 1;
    position = copiedUntil;
    name = match[1];
    removed = true;
  }
  if (!removed) return { xml, removed };
  parts.push(xml.slice(copiedUntil));
  return { xml: parts.join(''), removed, name };
}

/** Count decoded text and attribute values, not just serialized input bytes. */
export function checkXmlBudget(root: Node): number {
  let characters = 0;
  let nodes = 0;
  const stack: { node: Node; depth: number }[] = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++nodes > MAX_XML_NODES || depth > MAX_XML_DEPTH) throw new Error('XML 节点数或嵌套深度超过安全上限。');
    if (node.nodeType === 1) {
      for (const attribute of Array.from((node as Element).attributes)) characters += attribute.value.length;
    } else if (node.nodeValue) characters += node.nodeValue.length;
    if (characters > CORPUS_LIMITS.expandedCharacters) throw new Error('XML 展开后的文本超过 500,000 字符上限。');
    for (let index = node.childNodes.length - 1; index >= 0; index--) {
      stack.push({ node: node.childNodes[index], depth: depth + 1 });
    }
  }
  return characters;
}

export function parseSafeXml(xml: string, allowExternalDoctype = false): { document: XMLDocument; warnings: string[] } {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    throw new Error('TMX XML 解析必须在提供 DOMParser/XMLSerializer 的浏览器主线程执行。');
  }
  if (xml.length > CORPUS_LIMITS.inputBytes) throw new Error('XML 内容超过安全上限。');
  assertXmlCharacters(xml);
  const prepared = removeExternalDoctype(xml, allowExternalDoctype);
  const document = new DOMParser().parseFromString(prepared.xml, 'application/xml');
  const root = document.documentElement;
  if (!root || root.localName === 'parsererror'
    || document.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror').length) {
    throw new Error('XML 格式无效；请检查标签、属性和实体转义。');
  }
  if (document.doctype || (prepared.name && prepared.name !== root.nodeName)) throw new Error('XML 文档类型与根元素不匹配。');
  const version = /^<\?xml\s+version\s*=\s*(['"])([^'"]+)\1/.exec(prepared.xml)?.[2];
  if (version && version !== '1.0') throw new Error('仅支持 XML 1.0。');
  checkXmlBudget(document);
  return { document, warnings: prepared.removed ? ['已移除外部 TMX DOCTYPE；未加载任何外部 DTD 或实体。'] : [] };
}

export function serializeXml(node: Node): string {
  const serialized = new XMLSerializer().serializeToString(node);
  if (!serialized.includes('\r')) return serialized;
  // XMLSerializer may emit a literal CR in text nodes. XML parsing normalizes
  // that to LF, so use a character reference to retain the original character.
  const opaque = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  const parts: string[] = [];
  let start = 0;
  for (const match of serialized.matchAll(opaque)) {
    parts.push(serialized.slice(start, match.index).replace(/\r/g, '&#13;'));
    const token = match[0];
    parts.push(token.startsWith('<![CDATA[')
      ? token.replace(/\r/g, ']]>&#13;<![CDATA[') : token);
    start = match.index + token.length;
  }
  parts.push(serialized.slice(start).replace(/\r/g, '&#13;'));
  return parts.join('');
}

export function innerXml(element: Element): string {
  return Array.from(element.childNodes, node => serializeXml(node)).join('');
}
