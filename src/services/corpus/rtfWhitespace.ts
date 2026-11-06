import { CORPUS_LIMITS, variantOf, type CorpusProject } from './types';

// This is a stale-data checksum, not an authentication or security primitive.
function checksum(text: string): string {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return (value >>> 0).toString(16);
}
interface Edge { before: string; after: string; core: string }
interface Recovery { version: 1; body: string; rows: Array<[Edge, Edge]> }
const MARKER = /\{\\\*\\silvitewhitespace ([A-Za-z0-9+/=]+)\}/g;
const edge = (text: string): Edge => {
  const before = text.match(/^\s*/u)![0], remaining = text.slice(before.length), after = remaining.match(/\s*$/u)![0];
  return { before, after, core: checksum(text.trim()) };
};
export function embedRtfWhitespace(bytes: Uint8Array, project: CorpusProject): Uint8Array {
  const rows: Recovery['rows'] = project.units.map(unit => [edge(variantOf(unit, project.sourceLanguage).text), edge(variantOf(unit, project.targetLanguage).text)]);
  if (!rows.some(row => row.some(cell => cell.before || cell.after))) return bytes;
  const body = new TextDecoder('ascii').decode(bytes);
  const recovery: Recovery = { version: 1, body: checksum(body), rows };
  const json = new TextEncoder().encode(JSON.stringify(recovery));
  let binary = '';
  for (let start = 0; start < json.length; start += 8192) binary += String.fromCharCode(...json.subarray(start, start + 8192));
  const marker = '{\\*\\silvitewhitespace ' + btoa(binary) + '}';
  const position = body.indexOf('\n') + 1;
  return new TextEncoder().encode(body.slice(0, position) + marker + body.slice(position));
}

/** Pandoc normalizes boundary whitespace. Our own exports retain just those
 * edges in a legal ignorable RTF destination, bound to the exact visible body.
 * Rewritten external RTF never blindly inherits an old recovery record. */
export function restoreRtfWhitespace(bytes: Uint8Array, project: CorpusProject): CorpusProject {
  const text = new TextDecoder('ascii').decode(bytes);
  const markers = [...text.matchAll(MARKER)];
  if (!markers.length) return project;
  const warn = () => ({ ...project, warnings: [...project.warnings, { message: 'RTF 的边界空白恢复记录与正文不一致，已保留当前可见正文；请核对空白或改用原 TMX / 项目文件。' }] });
  try {
    if (markers.length !== 1 || markers[0][1].length > CORPUS_LIMITS.inputBytes) return warn();
    const encoded = Uint8Array.from(atob(markers[0][1]), char => char.charCodeAt(0));
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encoded)) as Recovery;
    const body = text.slice(0, markers[0].index) + text.slice(markers[0].index! + markers[0][0].length);
    if (value.version !== 1 || value.body !== checksum(body) || !Array.isArray(value.rows) || value.rows.length !== project.units.length) return warn();
    const updates = new Map<string, string>();
    let changed = 0, edgeCharacters = 0;
    const units = project.units.map((unit, row) => ({ ...unit, variants: unit.variants.map((variant, column) => {
      const info = value.rows[row]?.[column];
      if (!info || typeof info.before !== 'string' || typeof info.after !== 'string' || typeof info.core !== 'string'
        || /\S/u.test(info.before) || /\S/u.test(info.after) || info.core !== checksum(variant.text.trim())) throw new Error('Invalid whitespace record');
      edgeCharacters += info.before.length + info.after.length;
      if (edgeCharacters > CORPUS_LIMITS.expandedCharacters) throw new Error('Whitespace record is too large');
      const text = info.before + variant.text.trim() + info.after;
      if (text !== variant.text) changed++;
      for (const ref of variant.refs) updates.set(ref.documentId + '/' + ref.blockId, text);
      return { ...variant, text, originalText: text, refs: variant.refs.map(ref => ({ ...ref, start: 0, end: text.length })) };
    }) }));
    return { ...project, units, documents: project.documents.map(document => ({ ...document,
      blocks: document.blocks.map(block => ({ ...block, text: updates.get(document.id + '/' + block.id) ?? block.text })) })),
    warnings: [...project.warnings, ...(changed ? [{ message: '已依据与当前 RTF 正文一致的恢复记录保留 ' + changed + ' 个单元格的边界空白。' }] : [])] };
  } catch { return warn(); }
}
