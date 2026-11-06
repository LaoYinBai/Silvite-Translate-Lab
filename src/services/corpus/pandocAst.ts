import { CORPUS_LIMITS, corpusId } from './types';
import type { CorpusBlock, CorpusDocument, CorpusWarning } from './types';

/** Paths refer to the original AST, including the table section and cell. */
export interface PandocTextBlock {
  kind: 'paragraph' | 'heading' | 'list';
  text: string;
  path: string;
}
export interface PandocTableCell { text: string; path: string }
export interface PandocTableRow { cells: PandocTableCell[]; path: string }
export interface PandocTableBlock {
  kind: 'table';
  path: string;
  columns: number;
  caption: PandocTextBlock[];
  rows: PandocTableRow[];
}
export interface PandocContent {
  blocks: (PandocTextBlock | PandocTableBlock)[];
  diagnostics: CorpusWarning[];
}

type RecordValue = Record<string, unknown>;
interface Context { diagnostics: CorpusWarning[]; notices: Set<string> }

function invalid(path: string, message: string): never {
  throw new Error(`Pandoc ${path}：${message}`);
}
function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, '无效的 AST 对象。');
  return value as RecordValue;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, '应为 AST 数组。');
  return value;
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, '应为文本。');
  return value;
}
function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(path, '应为安全整数。');
  return value;
}
function tag(value: unknown, path: string): string {
  return string(record(value, path).t, `${path}/t`);
}
function tuple(value: unknown, name: string, size: number, path: string): unknown[] {
  // Pandoc's single-constructor types normally encode as tuples. Accept their
  // explicitly tagged representation too, without accepting older Table layouts.
  const result = array(Array.isArray(value) ? value : record(value, path).t === name
    ? record(value, path).c : invalid(path, `应为 ${name}。`), path);
  if (result.length !== size) invalid(path, `${name} 的字段数应为 ${size}。`);
  return result;
}
function attr(value: unknown, path: string): void {
  const result = tuple(value, 'Attr', 3, path);
  string(result[0], path);
  array(result[1], path).forEach(item => string(item, path));
  array(result[2], path).forEach(item => tuple(item, 'Attribute', 2, path).forEach(part => string(part, path)));
}
function notice(context: Context, key: string, path: string, message: string): void {
  if (context.notices.has(key)) return;
  context.notices.add(key);
  context.diagnostics.push({ message: `${message}（首处：${path}）` });
}

/** Bound recursion and expansion before traversing an untrusted JSON-like AST. */
function inspectAst(ast: unknown): void {
  const ancestors = new WeakSet<object>();
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value: ast, depth: 0 }];
  let nodes = 0, characters = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.exit) { ancestors.delete(entry.value as object); continue; }
    if (++nodes > 1_000_000 || entry.depth > 128) invalid('/', 'AST 结构过大或嵌套过深。');
    if (typeof entry.value === 'string') {
      characters += entry.value.length;
      if (characters > CORPUS_LIMITS.expandedCharacters * 4) invalid('/', 'AST 展开内容超过限制。');
    } else if (entry.value && typeof entry.value === 'object') {
      if (ancestors.has(entry.value)) invalid('/', 'AST 包含循环引用。');
      ancestors.add(entry.value);
      stack.push({ ...entry, exit: true });
      const children = Array.isArray(entry.value) ? entry.value : Object.values(entry.value);
      if (stack.length + children.length > 1_000_000) invalid('/', 'AST 结构过大。');
      for (let index = children.length - 1; index >= 0; index--) {
        stack.push({ value: children[index], depth: entry.depth + 1 });
      }
    }
  }
}

function inlines(value: unknown, path: string, context: Context): string {
  const parts = array(value, path).map((value, index) => {
    const location = `${path}/${index}`, node = record(value, location);
    const type = tag(node, location);
    switch (type) {
      case 'Str': return string(node.c, location);
      case 'Space': return ' ';
      case 'SoftBreak': case 'LineBreak': return '\n';
      case 'Emph': case 'Strong': case 'Underline': case 'Strikeout':
      case 'Superscript': case 'Subscript': case 'SmallCaps':
        notice(context, 'inline-format', location, '内联样式以纯文本导入，未保留字体装饰或上下标格式。');
        return inlines(node.c, `${location}/c`, context);
      case 'Span': {
        const content = tuple(node.c, type, 2, location);
        attr(content[0], location);
        if (JSON.stringify(content[0]) !== '["",[],[]]') {
          notice(context, 'span-attributes', location, '内联容器的属性未保留，正文已保留。');
        }
        return inlines(content[1], `${location}/c/1`, context);
      }
      case 'Code': {
        const content = tuple(node.c, type, 2, location);
        attr(content[0], location);
        notice(context, 'code-format', location, '代码以原始文本导入，未保留代码样式。');
        return string(content[1], location);
      }
      case 'Quoted': {
        const content = tuple(node.c, type, 2, location), quote = tag(content[0], location);
        if (!['SingleQuote', 'DoubleQuote'].includes(quote)) invalid(location, '不支持的引号类型。');
        const text = inlines(content[1], `${location}/c/1`, context);
        return quote === 'SingleQuote' ? `‘${text}’` : `“${text}”`;
      }
      case 'Link': {
        const content = tuple(node.c, type, 3, location);
        attr(content[0], location);
        tuple(content[2], 'Target', 2, location).forEach(part => string(part, location));
        notice(context, 'link-target', location, '超链接的显示文本已保留，链接地址和标题未保留。');
        return inlines(content[1], `${location}/c/1`, context);
      }
      case 'Cite': {
        const content = tuple(node.c, type, 2, location);
        array(content[0], location);
        notice(context, 'citation-metadata', location, '引用的显示文本已保留，文献元数据未保留。');
        return inlines(content[1], `${location}/c/1`, context);
      }
      // Alt text, TeX, raw markup, and footnotes are not interchangeable with
      // their displayed prose. Fail instead of silently deleting their content.
      case 'Math': case 'Image': case 'Note': case 'RawInline':
        return invalid(location, `不支持 ${type} 内容；请先转换为明确的正文文本。`);
      default: return invalid(location, `不支持的内联节点 ${type}。`);
    }
  });
  return parts.join('');
}

function roman(value: number): string {
  if (value <= 0 || value > 3999) invalid('/OrderedList', '罗马数字编号超出支持范围。');
  let result = '';
  for (const [amount, symbol] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'],
    [5, 'V'], [4, 'IV'], [1, 'I']] as const) {
    while (value >= amount) { result += symbol; value -= amount; }
  }
  return result;
}
function listMarker(value: number, style: string, delimiter: string, path: string): string {
  let label: string;
  switch (style) {
    case 'DefaultStyle': case 'Decimal': label = String(value); break;
    case 'Example': label = `@${value}`; break;
    case 'UpperRoman': case 'LowerRoman':
      label = roman(value);
      if (style === 'LowerRoman') label = label.toLowerCase();
      break;
    case 'UpperAlpha': case 'LowerAlpha': {
      if (value <= 0) invalid(path, '字母编号必须为正数。');
      label = '';
      for (let remaining = value; remaining > 0; remaining = Math.floor((remaining - 1) / 26)) {
        label = String.fromCharCode(65 + (remaining - 1) % 26) + label;
      }
      if (style === 'LowerAlpha') label = label.toLowerCase();
      break;
    }
    default: return invalid(path, `不支持的列表编号样式 ${style}。`);
  }
  switch (delimiter) {
    case 'DefaultDelim': case 'Period': return `${label}. `;
    case 'OneParen': return `${label}) `;
    case 'TwoParens': return `(${label}) `;
    default: return invalid(path, `不支持的列表分隔符 ${delimiter}。`);
  }
}

function textBlocks(value: unknown, path: string, context: Context): PandocTextBlock[] {
  return blocks(value, path, context, false) as PandocTextBlock[];
}
function textOf(value: unknown, path: string, context: Context): string {
  // Empty paragraphs are deliberately retained: ['a', '', 'b'] -> 'a\n\nb'.
  return textBlocks(value, path, context).map(block => block.text).join('\n');
}

function table(node: RecordValue, path: string, context: Context): PandocTableBlock {
  const content = tuple(node.c, 'Table', 6, path);
  attr(content[0], `${path}/attr`);
  const specs = array(content[2], `${path}/columns`);
  specs.forEach((spec, index) => {
    const pair = tuple(spec, 'ColSpec', 2, `${path}/columns/${index}`);
    if (!['AlignLeft', 'AlignRight', 'AlignCenter', 'AlignDefault'].includes(tag(pair[0], path))) {
      invalid(path, '不支持的列对齐方式。');
    }
  });
  const captionValue = tuple(content[1], 'Caption', 2, `${path}/caption`);
  let caption = textBlocks(captionValue[1], `${path}/caption/long`, context);
  if (captionValue[0] !== null) {
    const shortText = inlines(captionValue[0], `${path}/caption/short`, context);
    if (!caption.length) caption = [{ kind: 'paragraph', text: shortText, path: `${path}/caption/short` }];
    else notice(context, 'short-caption', path, '表格短标题未单独保留，完整标题已保留。');
  }
  const rows: PandocTableRow[] = [];
  function appendRows(value: unknown, section: string): void {
    array(value, section).forEach((row, index) => {
      const rowPath = `${section}/${index}`, rowValue = tuple(row, 'Row', 2, rowPath);
      attr(rowValue[0], `${rowPath}/attr`);
      const cells = array(rowValue[1], `${rowPath}/cells`).map((cell, cellIndex) => {
        const cellPath = `${rowPath}/cells/${cellIndex}`, cellValue = tuple(cell, 'Cell', 5, cellPath);
        attr(cellValue[0], `${cellPath}/attr`);
        if (integer(cellValue[2], cellPath) !== 1 || integer(cellValue[3], cellPath) !== 1) {
          invalid(cellPath, '不支持跨行或跨列的合并单元格。');
        }
        return { text: textOf(cellValue[4], `${cellPath}/blocks`, context), path: cellPath };
      });
      if (cells.length && cells.length !== specs.length) invalid(rowPath, '单元格数与表格列数不一致。');
      rows.push({ cells, path: rowPath });
    });
  }
  const head = tuple(content[3], 'TableHead', 2, `${path}/head`);
  attr(head[0], `${path}/head/attr`);
  appendRows(head[1], `${path}/head/rows`);
  array(content[4], `${path}/bodies`).forEach((body, index) => {
    const bodyPath = `${path}/bodies/${index}`, bodyValue = tuple(body, 'TableBody', 4, bodyPath);
    attr(bodyValue[0], `${bodyPath}/attr`);
    const rowHeaders = integer(bodyValue[1], `${bodyPath}/rowHeadColumns`);
    if (rowHeaders < 0 || rowHeaders > specs.length) invalid(bodyPath, '行标题列数无效。');
    appendRows(bodyValue[2], `${bodyPath}/head/rows`);
    appendRows(bodyValue[3], `${bodyPath}/body/rows`);
  });
  const foot = tuple(content[5], 'TableFoot', 2, `${path}/foot`);
  attr(foot[0], `${path}/foot/attr`);
  appendRows(foot[1], `${path}/foot/rows`);
  if (!rows.length) notice(context, 'empty-table', path, '空表格没有单元格正文，表格位置以空块保留。');
  return { kind: 'table', path, columns: specs.length, caption, rows };
}

function blocks(value: unknown, path: string, context: Context, allowTables: boolean): (PandocTextBlock | PandocTableBlock)[] {
  return array(value, path).flatMap((value, index): (PandocTextBlock | PandocTableBlock)[] => {
    const location = `${path}/${index}`, node = record(value, location), type = tag(node, location);
    switch (type) {
      case 'Plain': case 'Para':
        return [{ kind: 'paragraph', text: inlines(node.c, `${location}/inlines`, context), path: location }];
      case 'Header': {
        const content = tuple(node.c, type, 3, location);
        if (integer(content[0], location) < 1) invalid(location, '标题级别无效。');
        attr(content[1], location);
        return [{ kind: 'heading', text: inlines(content[2], `${location}/inlines`, context), path: location }];
      }
      case 'BlockQuote':
        notice(context, 'block-quote', location, '引文正文及结构路径已保留，未保留引用缩进样式。');
        return blocks(node.c, `${location}/quote`, context, allowTables);
      case 'Div': {
        const content = tuple(node.c, type, 2, location);
        attr(content[0], location);
        notice(context, 'div-attributes', location, '块容器以有序正文导入，未保留容器属性。');
        return blocks(content[1], `${location}/div`, context, allowTables);
      }
      case 'BulletList': case 'OrderedList': {
        let items: unknown[], start = 1, style = 'Decimal', delimiter = 'Period';
        if (type === 'OrderedList') {
          const content = tuple(node.c, type, 2, location), attributes = tuple(content[0], 'ListAttributes', 3, location);
          start = integer(attributes[0], location);
          style = tag(attributes[1], location); delimiter = tag(attributes[2], location);
          items = array(content[1], location);
        } else items = array(node.c, location);
        return items.map((item, itemIndex) => {
          const itemPath = `${location}/items/${itemIndex}`;
          const marker = type === 'BulletList' ? '• ' : listMarker(start + itemIndex, style, delimiter, itemPath);
          const text = textOf(item, itemPath, context);
          return { kind: 'list', text: marker + text.replace(/\n/g, '\n' + ' '.repeat(marker.length)), path: itemPath };
        });
      }
      case 'LineBlock':
        return [{ kind: 'paragraph', text: array(node.c, location)
          .map((line, lineIndex) => inlines(line, `${location}/lines/${lineIndex}`, context)).join('\n'), path: location }];
      case 'CodeBlock': {
        const content = tuple(node.c, type, 2, location);
        attr(content[0], location);
        notice(context, 'code-format', location, '代码以原始文本导入，未保留代码样式。');
        return [{ kind: 'paragraph', text: string(content[1], location), path: location }];
      }
      case 'Table':
        if (!allowTables) invalid(location, '不支持嵌套表格或列表、标题内的表格。');
        return [table(node, `${location}/table`, context)];
      default: return invalid(location, `不支持的块节点 ${type}，未忽略其内容。`);
    }
  });
}

/** Structured intermediate representation shared by the document and RTF adapters. */
export function readPandocAst(ast: unknown): PandocContent {
  inspectAst(ast);
  const root = record(ast, '/');
  const context: Context = { diagnostics: [], notices: new Set() };
  notice(context, 'plain-structure', '/', '已导入文本及段落、列表、表格位置；页面布局、字体及原始文档样式不在语料模型中。');
  if (root.meta !== undefined && Object.keys(record(root.meta, '/meta')).length) {
    notice(context, 'document-meta', '/meta', '文档标题、作者等元数据未作为正文或语料属性导入。');
  }
  const result = blocks(root.blocks, '/blocks', context, true);
  let count = 0, characters = 0;
  const account = (text: string): void => {
    count++; characters += text.length;
    if (count > CORPUS_LIMITS.blocks || characters > CORPUS_LIMITS.expandedCharacters) {
      invalid('/', '正文块数或展开字符数超过语料限制。');
    }
  };
  for (const block of result) {
    if (block.kind !== 'table') account(block.text);
    else {
      block.caption.forEach(item => account(item.text));
      if (!block.rows.length) account('');
      for (const row of block.rows) {
        if (!row.cells.length) account('');
        row.cells.forEach(cell => account(cell.text));
      }
    }
  }
  return { blocks: result, diagnostics: context.diagnostics };
}

/** Extra diagnostics stay enumerable when a document is saved as project JSON. */
export function pandocDocumentDiagnostics(document: CorpusDocument): CorpusWarning[] {
  return [...((document as CorpusDocument & { diagnostics?: CorpusWarning[] }).diagnostics || [])];
}

export function documentFromPandoc(ast: unknown, name: string, language: string): CorpusDocument {
  const content = readPandocAst(ast), result: CorpusBlock[] = [];
  const add = (text: string, kind: CorpusBlock['kind'], path: string): void => {
    result.push({ id: corpusId('block'), text, kind, path });
  };
  for (const block of content.blocks) {
    if (block.kind !== 'table') add(block.text, block.kind, block.path);
    else {
      block.caption.forEach(caption => add(caption.text, caption.kind, caption.path));
      if (!block.rows.length) add('', 'cell', block.path);
      for (const row of block.rows) {
        if (!row.cells.length) add('', 'cell', row.path);
        row.cells.forEach(cell => add(cell.text, 'cell', cell.path));
      }
    }
  }
  return Object.assign({ id: corpusId('document'), name, language, blocks: result }, { diagnostics: content.diagnostics });
}
