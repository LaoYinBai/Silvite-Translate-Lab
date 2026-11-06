import { readPandocAst } from './pandocAst';
import { embedRtfWhitespace } from './rtfWhitespace';
import { CORPUS_LIMITS, corpusId, createCorpusProject, variantForBlock } from './types';
import type { CorpusDocument, CorpusImportOptions, CorpusProject, UnitVariant } from './types';

/** Inspect syntax before Pandoc can discard hidden text or unsupported objects.
 * This is a conservative guard, not an RTF-to-text parser. In particular, a
 * repeated \\trowd definition is legal and is not a second/nested table row. */
export function inspectRtf(bytes: Uint8Array): void {
  if (bytes.byteLength > CORPUS_LIMITS.inputBytes) throw new Error('RTF 文件超过导入大小限制。');
  const source = new TextDecoder('latin1').decode(bytes);
  const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  if (!/^\s*\{\\rtf1(?=[\\\s{}])/i.test(source.slice(offset))) {
    throw new Error('文件不是具有有效 {\\rtf1 签名的 RTF 文档。');
  }
  if (/\{0>|<0\}|<\}\d{0,3}\{>|tw4win/i.test(source)) {
    throw new Error('RTF：检测到旧版 Trados 分段标记或隐藏源文样式，暂不支持此格式。');
  }
  let depth = 0, unicodeSkip = 1, fallback = 0, tail = '', rootClosed = false;
  const skipStack: number[] = [];
  function fail(message: string): never { throw new Error(`RTF：${message}`); }
  const character = (value: string, unicode = false): void => {
    if (!unicode && fallback) { fallback--; return; }
    tail = (tail + value).slice(-80);
    if (/\{0>|<0\}|<\}\d{0,3}\{>|tw4win/i.test(tail)) {
      fail('检测到旧版 Trados 分段标记或隐藏源文样式，暂不支持此格式。');
    }
  };
  const unsupported = new Set([
    'pict', 'object', 'objdata', 'shp', 'shppict', 'nonshppict',
    'field', 'fldinst', 'fldrslt', 'footnote', 'endnote', 'annotation',
    'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
    'mmath', 'omath', 'bin', 'upr',
  ]);
  for (let index = offset; index < source.length;) {
    const ch = source[index++];
    if (rootClosed && !/\s/.test(ch)) fail('根分组后包含额外内容。');
    if (ch === '{') {
      fallback = 0;
      skipStack.push(unicodeSkip);
      if (++depth > 512) fail('分组嵌套过深。');
    } else if (ch === '}') {
      fallback = 0;
      if (!depth) fail('分组括号不匹配。');
      unicodeSkip = skipStack.pop()!;
      if (--depth === 0) rootClosed = true;
    } else if (ch === '\\') {
      if (index >= source.length) fail('文件以不完整的转义结尾。');
      const next = source[index++];
      if (next === '\\' || next === '{' || next === '}') character(next);
      else if (next === "'") {
        const hex = source.slice(index, index + 2);
        if (!/^[0-9a-f]{2}$/i.test(hex)) fail('无效的十六进制转义。');
        character(String.fromCharCode(Number.parseInt(hex, 16))); index += 2;
      } else if (/[a-z]/i.test(next)) {
        const start = index - 1;
        while (index < source.length && /[a-z]/i.test(source[index])) index++;
        const control = source.slice(start, index).toLowerCase();
        const parameterStart = index;
        if (source[index] === '-') index++;
        const digitsStart = index;
        while (index < source.length && /[0-9]/.test(source[index])) index++;
        const parameter = index > digitsStart ? Number(source.slice(parameterStart, index)) : undefined;
        if (parameterStart !== digitsStart && parameter === undefined) fail('控制字参数不完整。');
        if (source[index] === ' ') index++;
        if (unsupported.has(control)) fail(`不支持 \\${control} 内容，请先转换为普通正文表格。`);
        if ((control === 'v' || control === 'deleted' || control === 'revised') && parameter !== 0) {
          fail('检测到隐藏文字或修订内容，无法保证源文完整；旧版 Trados RTF 需先转换。');
        }
        if (['clmgf', 'clmrg', 'clvmgf', 'clvmrg', 'nestcell', 'nestrow', 'nesttableprops'].includes(control)
          || (control === 'itap' && parameter !== undefined && parameter > 1)) {
          fail('不支持嵌套表格或跨行、跨列合并单元格。');
        }
        if (control === 'uc') {
          if (parameter === undefined || !Number.isInteger(parameter) || parameter < 0 || parameter > 32767) {
            fail('无效的 Unicode 回退长度。');
          }
          unicodeSkip = parameter;
        } else if (control === 'u') {
          if (parameter === undefined || !Number.isInteger(parameter) || parameter < -32768 || parameter > 65535) {
            fail('无效的 Unicode 转义。');
          }
          character(String.fromCharCode(parameter & 0xffff), true); fallback = unicodeSkip;
        } else if (['par', 'line', 'row', 'cell', 'tab'].includes(control)) character('\n');
        else if (control === 'lbrace') character('{');
        else if (control === 'rbrace') character('}');
      } else if (next === '~') character('\u00a0');
      else if (next === '_') character('\u2011');
      else if (next === '-') character('\u00ad');
      // Other control symbols are non-textual; CR/LF are RTF source layout.
    } else if (ch !== '\r' && ch !== '\n') {
      if (!depth && !/\s/.test(ch)) fail('正文位于根分组以外。');
      character(ch);
    }
  }
  if (depth || !rootClosed) fail('分组括号不匹配或文档不完整。');
}

export function corpusFromRtfAst(ast: unknown, options: CorpusImportOptions = {}): CorpusProject {
  const content = readPandocAst(ast);
  const project = createCorpusProject(options.name || '双语 RTF', 'rtf', options);
  const source: CorpusDocument = { id: corpusId('document'), name: `${project.name} · 源文`, language: project.sourceLanguage, blocks: [] };
  const target: CorpusDocument = { id: corpusId('document'), name: `${project.name} · 译文`, language: project.targetLanguage, blocks: [] };
  project.documents.push(source, target);
  project.warnings.push(...content.diagnostics);
  let ignoredBlankParagraphs = 0;
  for (const table of content.blocks) {
    if (table.kind !== 'table') {
      // RTF writers commonly append an empty paragraph after the final table.
      if (table.kind === 'paragraph' && table.text === '') { ignoredBlankParagraphs++; continue; }
      throw new Error(`RTF ${table.path}：双语导入要求正文全部位于双列表格中；不能推断表格外文字的对应关系。`);
    }
    if (table.columns !== 2) throw new Error(`RTF ${table.path}：双语表格必须恰有两列。`);
    if (table.caption.length) throw new Error(`RTF ${table.path}：表格标题不能安全地映射到双语行，请先移入表格。`);
    for (const row of table.rows) {
      if (row.cells.length !== 2) throw new Error(`RTF ${row.path}：每行必须恰有两个独立文本单元格。`);
      if (project.units.length >= CORPUS_LIMITS.units) throw new Error('RTF 行数超过语料单元限制。');
      const variants = row.cells.map((cell, side) => {
        const document = side === 0 ? source : target;
        const block = { id: corpusId('block'), kind: 'cell' as const, text: cell.text, path: cell.path };
        document.blocks.push(block);
        return variantForBlock(document, block);
      });
      project.units.push({ id: corpusId('unit'), variants, review: 'unreviewed', locked: false,
        provenance: 'imported', metadata: {} });
    }
  }
  if (!project.units.length) throw new Error('RTF 中没有可导入的双列文本行；单语文档请使用文档对齐入口。');
  if (ignoredBlankParagraphs) project.warnings.push({ message: `已忽略表格外的 ${ignoredBlankParagraphs} 个空布局段落；表格内的空行和空单元格均已保留。` });
  project.warnings.push({ message: '按表格行顺序导入：左列为源语言、右列为目标语言；未根据文字内容猜测语言方向，所有行均待复核。' });
  return project;
}

function workingVariant(variants: UnitVariant[], language: string, unitId: string): UnitVariant | undefined {
  const matches = variants.filter(variant => variant.language === language);
  if (matches.length > 1) throw new Error(`单元 ${unitId} 含多个 ${language} 变体，无法确定当前工作文本。`);
  return matches[0];
}

/** Only the selected working pair is representable in the canonical table. */
export function rtfExportLosses(project: CorpusProject): string[] {
  const losses: string[] = [], working = new Set([project.sourceLanguage, project.targetLanguage]);
  const languages = new Set(project.languages.filter(language => !working.has(language)));
  let markup = 0, metadata = 0, review = 0, edited = 0, missing = 0;
  for (const unit of project.units) {
    const source = workingVariant(unit.variants, project.sourceLanguage, unit.id);
    const target = workingVariant(unit.variants, project.targetLanguage, unit.id);
    unit.variants.filter(variant => !working.has(variant.language)).forEach(variant => languages.add(variant.language));
    if (unit.variants.some(variant => variant.markup !== undefined)) markup++;
    if (Object.keys(unit.metadata).length || unit.tmxTu !== undefined) metadata++;
    if (unit.review !== 'unreviewed' || unit.locked || unit.score !== undefined || unit.provenance !== 'imported') review++;
    if ([source, target].some(variant => variant && variant.text !== variant.originalText)) edited++;
    if (!source || !target) missing++;
  }
  if (markup) losses.push(`${markup} 个单元的内联标签将转为当前纯文本，RTF 不保留标签结构。`);
  if (metadata || project.tmxHeader !== undefined) losses.push(`TMX/SDLTM 元数据、原始 XML 和文档头不会写入 RTF（涉及 ${metadata} 个单元）。`);
  if (languages.size) losses.push(`仅导出 ${project.sourceLanguage} 与 ${project.targetLanguage}；其他语言不会写入 RTF：${[...languages].join('、')}。`);
  if (review) losses.push(`${review} 个单元的复核状态、锁定、评分或来源信息不会写入 RTF。`);
  if (edited) losses.push(`${edited} 个单元仅导出当前编辑文本，不保留编辑前的 originalText 或修改历史。`);
  if (missing) losses.push(`${missing} 个单元缺少某个工作语言变体，对应列将输出为空单元格。`);
  losses.push('RTF 仅保存有序双列正文；项目 ID、语言标签、时间、警告及原文档块、来源范围和页面样式不会写入。');
  return losses;
}

function escapeRtf(text: string): string {
  const result: string[] = [];
  // Iterate UTF-16 code units, not code points: RTF represents supplementary
  // characters using two signed \\uN escapes, each with its own '?' fallback.
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index), ch = text[index];
    if (ch === '\\' || ch === '{' || ch === '}') result.push('\\' + ch);
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[index + 1] === '\n') index++;
      result.push('\\line ');
    } else if (ch === '\t') result.push('\\tab ');
    else if (code >= 0x20 && code <= 0x7e) result.push(ch);
    else result.push(`\\u${code > 32767 ? code - 65536 : code}?`);
  }
  return result.join('');
}

/** Export the current unit order and working text, including completely empty rows. */
export function exportRtf(project: CorpusProject): Uint8Array {
  if (project.sourceLanguage === project.targetLanguage) throw new Error('RTF 的源语言和目标语言必须不同。');
  if (project.units.length > CORPUS_LIMITS.units) throw new Error('RTF 导出单元数超过限制。');
  const result = ['{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n',
    '{\\fonttbl{\\f0\\fnil Arial;}}\n\\viewkind4\\f0\\fs20\n'];
  let characters = 0;
  for (const unit of project.units) {
    const source = workingVariant(unit.variants, project.sourceLanguage, unit.id)?.text || '';
    const target = workingVariant(unit.variants, project.targetLanguage, unit.id)?.text || '';
    characters += source.length + target.length;
    if (characters > CORPUS_LIMITS.expandedCharacters) throw new Error('RTF 导出文本超过字符限制。');
    result.push('\\trowd\\trgaph108\\trleft0\\cellx4500\\cellx9000\n',
      `\\pard\\intbl\\itap1 ${escapeRtf(source)}\\cell\n`,
      `\\pard\\intbl\\itap1 ${escapeRtf(target)}\\cell\\row\n`);
  }
  result.push('\\pard\\par\n}');
  return embedRtfWhitespace(new TextEncoder().encode(result.join('')), project);
}
