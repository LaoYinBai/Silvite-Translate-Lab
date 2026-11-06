import { CORPUS_LIMITS, languageBase, type CorpusDocument, type CorpusImportOptions } from './types';
import { parseTmx } from './tmx';
import { corpusFromRtfAst, inspectRtf } from './rtf';
import { restoreRtfWhitespace } from './rtfWhitespace';
import { documentFromPandoc, pandocDocumentDiagnostics } from './pandocAst';
import { parseStructuredFile } from './jobs';
import { textDocument } from '../alignment/segment';
import { parseProject } from './persistence';
import type { ProgressReporter } from './assets';

const extension = (name: string) => name.toLowerCase().split('.').pop();
export async function importCorpusFile(file: File, signal: AbortSignal, progress: ProgressReporter, options: CorpusImportOptions = {}) {
  if (extension(file.name) === 'json') {
    if (file.size > CORPUS_LIMITS.projectBytes) throw new Error('项目文件超过 30 MiB 上限。');
    const result = parseProject(new Uint8Array(await file.arrayBuffer()));
    signal.throwIfAborted();
    return result;
  }
  if (!file.size || file.size > CORPUS_LIMITS.inputBytes) throw new Error('请选择非空文件，每个文件最大 10 MiB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  if (extension(file.name) === 'tmx') {
    progress('正在读取 TMX 语言变体和标签', 0.5);
    const result = parseTmx(bytes, { ...options, name: options.name || file.name.replace(/\.[^.]+$/, '') });
    signal.throwIfAborted();
    return result;
  }
  if (extension(file.name) !== 'rtf') throw new Error('格式转换请导入 TMX、双栏 RTF 或语料项目 JSON。');
  inspectRtf(bytes);
  const parsed = await parseStructuredFile(bytes, 'rtf', signal, progress);
  const project = restoreRtfWhitespace(bytes, corpusFromRtfAst(parsed.ast, { ...options, name: options.name || file.name.replace(/\.[^.]+$/, '') }));
  project.warnings.push(...parsed.warnings.map(message => ({ message: '解析器提示：' + message })));
  return project;
}

export async function importAlignmentDocument(file: File, language: string, signal: AbortSignal, progress: ProgressReporter): Promise<{ document: CorpusDocument; warnings: string[] }> {
  if (!['zh', 'en'].includes(languageBase(language))) throw new Error('文档对齐只支持中文与英文。');
  if (!file.size || file.size > CORPUS_LIMITS.inputBytes) throw new Error('每个对齐文档应为非空文件，最大 10 MiB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const kind = extension(file.name);
  if (kind === 'txt' || kind === 'md') {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('文本文件不是 UTF-8，请另存为 UTF-8 后导入。'); }
    return { document: textDocument(text.replace(/^\uFEFF/, ''), file.name, language), warnings: [] };
  }
  if (kind !== 'rtf' && kind !== 'docx') throw new Error('双文档对齐当前支持 TXT、Markdown、DOCX 和普通单语 RTF。');
  if (kind === 'rtf') inspectRtf(bytes);
  if (kind === 'docx' && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) throw new Error('DOCX 文件签名无效。');
  const parsed = await parseStructuredFile(bytes, kind, signal, progress);
  const document = documentFromPandoc(parsed.ast, file.name, language);
  return { document, warnings: [...pandocDocumentDiagnostics(document).map(warning => warning.message), ...parsed.warnings] };
}
