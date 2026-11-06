import {
  CORPUS_LIMITS, corpusId, createCorpusProject, languageBase, requireBilingualDirection,
} from './types';
import type {
  BilingualUnit, CorpusBlock, CorpusDocument, CorpusImportOptions, CorpusProject, UnitVariant,
} from './types';
import {
  XML_NAMESPACE, XMLNS_NAMESPACE, assertXmlCharacters, checkXmlBudget, decodeXmlBytes,
  innerXml, parseSafeXml, serializeXml,
} from './xml';

const TMX_NAMESPACE = 'http://www.lisa.org/tmx14';
const CODE_TAGS = new Set(['bpt', 'ept', 'ph', 'it', 'ut']);
const FLOW_TAGS = new Set(['hi', ...CODE_TAGS]);
const HEADER_DEFAULTS: Record<string, string> = {
  creationtool: 'Silvite Translate Lab', creationtoolversion: '1.0', segtype: 'sentence',
  'o-tmf': 'Silvite Translate Lab', adminlang: 'en', datatype: 'PlainText',
};

function languageKey(language: string): string {
  return language.trim().replace(/_/g, '-').toLowerCase();
}

function assertLanguage(language: string): void {
  if (!/^[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*$/.test(language)) {
    throw new Error(`无效的 xml:lang 语言标记“${language}”。`);
  }
}

function supportedNamespace(namespace: string | null): boolean {
  return !namespace || namespace === TMX_NAMESPACE;
}

function isElement(element: Element, name: string, namespace = element.namespaceURI): boolean {
  return element.localName === name && element.namespaceURI === namespace;
}

function children(element: Element, name: string): Element[] {
  return Array.from(element.children).filter(child => isElement(child, name, element.namespaceURI));
}

function onlyChild(element: Element, name: string): Element {
  const matches = children(element, name);
  if (matches.length !== 1) throw new Error(`<${element.localName}> 必须且只能包含一个 <${name}>。`);
  return matches[0];
}

function assertStructuralText(element: Element): void {
  for (const child of Array.from(element.childNodes)) {
    if ((child.nodeType === 3 || child.nodeType === 4) && child.nodeValue?.trim()) {
      throw new Error(`<${element.localName}> 中存在段落之外的文本。`);
    }
  }
}

/** xml:lang is inherited according to XML, never inferred from TUV position. */
function variantLanguage(tuv: Element): string {
  let element: Element | null = tuv;
  while (element) {
    if (element.hasAttributeNS(XML_NAMESPACE, 'lang')) {
      const language = element.getAttributeNS(XML_NAMESPACE, 'lang')!;
      assertLanguage(language);
      return language;
    }
    element = element.parentElement;
  }
  throw new Error('每个 TMX 语言变体都必须具有实际的 xml:lang（可继承）。');
}

interface InlineContent { text: string; markup: string; hasMarkup: boolean }

/** Native code data is excluded from text; hi/sub text remains in sequence. */
function inspectSegment(seg: Element): InlineContent {
  const seen = new Set<string>();
  const open = new Set<string>();
  const text: string[] = [];
  let hasMarkup = false;
  const walk = (parent: Element, codeData: boolean): void => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        if (!codeData) text.push(child.nodeValue || '');
        continue;
      }
      if (child.nodeType === 7 || child.nodeType === 8) { hasMarkup = true; continue; }
      if (child.nodeType !== 1) throw new Error('TMX seg 包含不支持的 XML 节点。');
      const element = child as Element;
      const name = element.localName;
      if (!supportedNamespace(element.namespaceURI)
        || (codeData ? name !== 'sub' : !FLOW_TAGS.has(name))) {
        throw new Error(`TMX 行内标记 <${element.tagName}> 不受支持或位于错误位置。`);
      }
      hasMarkup = true;
      if (name === 'bpt' || name === 'ept') {
        const id = element.getAttribute('i');
        if (!id || !/^\d+$/.test(id)) throw new Error(`<${name}> 必须具有数字配对属性 i。`);
        const key = id.replace(/^0+(?=\d)/, '');
        if (name === 'bpt') {
          if (seen.has(key)) throw new Error(`TMX 行内配对 i="${id}" 重复。`);
          seen.add(key); open.add(key);
        } else if (!open.delete(key)) {
          throw new Error(`TMX <ept i="${id}"> 没有之前对应的 <bpt>，或已被关闭。`);
        }
      }
      if (name === 'it' && !['begin', 'end'].includes(element.getAttribute('pos') || '')) {
        throw new Error('TMX <it> 的 pos 必须为 begin 或 end。');
      }
      // A Set deliberately permits crossing ranges: bpt1 bpt2 ept1 ept2.
      walk(element, CODE_TAGS.has(name));
    }
  };
  walk(seg, false);
  if (open.size) throw new Error(`TMX 行内标记缺少对应的 <ept>：${Array.from(open).join(', ')}。`);
  return { text: text.join(''), markup: innerXml(seg), hasMarkup };
}

function inlineFragment(markup: string): { seg: Element; content: InlineContent } {
  const { document } = parseSafeXml(`<seg>${markup}</seg>`);
  const seg = document.documentElement;
  // A closing wrapper plus another element must never be accepted as a fragment.
  if (!isElement(seg, 'seg') || seg.attributes.length) throw new Error('请输入 <seg> 内部的 TMX 混合内容。');
  return { seg, content: inspectSegment(seg) };
}

/** The UI must store both returned values after a deliberate markup edit. */
export function validateInlineMarkup(markup: string): { text: string; markup: string } {
  const { content } = inlineFragment(markup);
  return { text: content.text, markup: content.markup };
}

/** Metadata keys: @attribute, prop:type, and note (repeated values stay ordered). */
function readMetadata(tu: Element): Record<string, string[]> {
  const metadata: Record<string, string[]> = Object.create(null);
  const add = (key: string, value: string): void => { (metadata[key] ||= []).push(value); };
  for (const attribute of Array.from(tu.attributes)) {
    if (attribute.namespaceURI !== XMLNS_NAMESPACE) add(`@${attribute.name}`, attribute.value);
  }
  for (const child of Array.from(tu.children)) {
    if (isElement(child, 'prop', tu.namespaceURI)) add(`prop:${child.getAttribute('type') || ''}`, child.textContent || '');
    else if (isElement(child, 'note', tu.namespaceURI)) add('note', child.textContent || '');
  }
  return metadata;
}

/** Materialize inherited XML attributes so the preserved fragment is standalone. */
function standaloneClone(element: Element): Element {
  const clone = element.cloneNode(true) as Element;
  for (const attribute of ['lang', 'space', 'base']) {
    if (clone.hasAttributeNS(XML_NAMESPACE, attribute)) continue;
    let ancestor = element.parentElement;
    while (ancestor) {
      if (ancestor.hasAttributeNS(XML_NAMESPACE, attribute)) {
        clone.setAttributeNS(XML_NAMESPACE, `xml:${attribute}`, ancestor.getAttributeNS(XML_NAMESPACE, attribute)!);
        break;
      }
      ancestor = ancestor.parentElement;
    }
  }
  // Prefixes used by namespaced attributes/elements are serialized by XMLSerializer.
  // Keep additional declarations too, since metadata values may contain QNames.
  let ancestor: Element | null = element;
  while (ancestor) {
    for (const attribute of Array.from(ancestor.attributes)) {
      if (attribute.namespaceURI === XMLNS_NAMESPACE && !clone.hasAttributeNS(XMLNS_NAMESPACE, attribute.localName)) {
        clone.setAttributeNS(XMLNS_NAMESPACE, attribute.name, attribute.value);
      }
    }
    ancestor = ancestor.parentElement;
  }
  return clone;
}

function chooseDirection(
  languages: string[], headerSource: string, options: CorpusImportOptions,
): { sourceLanguage: string; targetLanguage: string; warnings: string[] } {
  const warnings: string[] = [];
  const requestedSource = options.sourceLanguage || (options.targetLanguage
    ? (languageBase(options.targetLanguage) === 'zh' ? 'en' : 'zh')
    : ['zh', 'en'].includes(languageBase(headerSource)) ? headerSource : 'zh');
  const requestedTarget = options.targetLanguage || (languageBase(requestedSource) === 'zh' ? 'en' : 'zh');
  requireBilingualDirection(requestedSource, requestedTarget);
  assertLanguage(requestedSource);
  assertLanguage(requestedTarget);
  const resolve = (requested: string, side: string): string => {
    const exact = languages.find(language => languageKey(language) === languageKey(requested));
    if (exact) return exact;
    const sameBase = languages.filter(language => languageBase(language) === languageBase(requested));
    if (sameBase.length) {
      const matchingHeader = sameBase.find(language => languageKey(language) === languageKey(headerSource));
      const actual = matchingHeader || sameBase[0];
      if (requested.includes('-') || requested.includes('_')) {
        warnings.push(`${side}语言 ${requested} 不在文件中，已选择实际 xml:lang ${actual}。`);
      }
      return actual;
    }
    const fallback = requested === 'zh' ? 'zh-CN' : requested === 'en' ? 'en-US' : requested;
    warnings.push(`文件中没有${side}语言 ${fallback} 的变体；保留空侧供校正。`);
    return fallback;
  };
  const sourceLanguage = resolve(requestedSource, '源');
  const targetLanguage = resolve(requestedTarget, '目标');
  requireBilingualDirection(sourceLanguage, targetLanguage);
  if (headerSource && headerSource !== '*all*' && languageKey(headerSource) !== languageKey(sourceLanguage)) {
    warnings.push(`文件头 srclang="${headerSource}" 与工作源语言 ${sourceLanguage} 冲突；按实际 xml:lang 读取，导出将使用工作方向。`);
  }
  const bases = [languageBase(sourceLanguage), languageBase(targetLanguage)];
  for (const base of bases) {
    if (languages.filter(language => languageBase(language) === base).length > 1) {
      warnings.push(`文件包含多个 ${base} 语言区域变体；当前工作语言已选定，其他变体仍完整保留。`);
    }
  }
  return { sourceLanguage, targetLanguage, warnings };
}

/** Browser main-thread import. No network APIs, workers, or third-party parsers. */
export function parseTmx(bytes: Uint8Array, options: CorpusImportOptions = {}): CorpusProject {
  const decoded = decodeXmlBytes(bytes);
  const parsed = parseSafeXml(decoded.xml, true);
  const root = parsed.document.documentElement;
  if (root.localName !== 'tmx' || !supportedNamespace(root.namespaceURI)) throw new Error('文件根元素必须是 TMX <tmx>。');
  const version = root.getAttribute('version');
  if (version !== '1.4' && version !== '1.4b') throw new Error('仅支持 TMX 1.4 / 1.4b 文件。');
  const header = onlyChild(root, 'header');
  const body = onlyChild(root, 'body');
  if (root.children[0] !== header || root.children[1] !== body) throw new Error('TMX header 必须位于 body 之前。');
  assertStructuralText(root);
  assertStructuralText(body);
  if (Array.from(root.children).some(child => child !== header && child !== body)) throw new Error('TMX 根元素中存在未知的结构元素。');
  if (Array.from(body.children).some(child => !isElement(child, 'tu', body.namespaceURI))) throw new Error('TMX body 只能包含 TU。');
  const tus = children(body, 'tu');
  if (tus.length > CORPUS_LIMITS.units) throw new Error('TMX 翻译单元超过 10,000 条上限。');

  const project = createCorpusProject(options.name || 'TMX 语料', 'tmx');
  const warn = (message: string, unitId?: string): void => { project.warnings.push({ message, ...(unitId ? { unitId } : {}) }); };
  for (const message of [...decoded.warnings, ...parsed.warnings]) warn(message);
  project.tmxHeader = serializeXml(standaloneClone(header));
  const languages = new Set<string>();
  const documents = new Map<string, CorpusDocument>();
  for (let tuIndex = 0; tuIndex < tus.length; tuIndex++) {
    const tu = tus[tuIndex];
    assertStructuralText(tu);
    const tuvs = children(tu, 'tuv');
    if (!tuvs.length) throw new Error(`第 ${tuIndex + 1} 个 TU 没有语言变体。`);
    const preserved = standaloneClone(tu);
    const preservedTuvs = children(preserved, 'tuv');
    const unit: BilingualUnit = {
      id: corpusId('tu'), variants: [], review: 'unreviewed', locked: false,
      provenance: 'imported', metadata: readMetadata(tu),
    };
    const unitLanguages = new Set<string>();
    for (let variantIndex = 0; variantIndex < tuvs.length; variantIndex++) {
      const tuv = tuvs[variantIndex];
      assertStructuralText(tuv);
      const language = variantLanguage(tuv);
      const seg = onlyChild(tuv, 'seg');
      let content: InlineContent;
      try { content = inspectSegment(seg); }
      catch (error) { throw new Error(`第 ${tuIndex + 1} 个 TU（${language}）：${(error as Error).message}`); }
      languages.add(language);
      if (unitLanguages.has(languageKey(language))) warn(`同一 TU 包含重复语言 ${language}，已按原始顺序完整保留。`, unit.id);
      unitLanguages.add(languageKey(language));
      preservedTuvs[variantIndex].setAttributeNS(XML_NAMESPACE, 'xml:lang', language);
      const preservedTuv = standaloneClone(tuv);
      preservedTuv.setAttributeNS(XML_NAMESPACE, 'xml:lang', language);
      let document = documents.get(language);
      if (!document) {
        document = { id: corpusId('document'), name: `${project.name} · ${language}`, language, blocks: [] };
        documents.set(language, document);
      }
      if (document.blocks.length >= CORPUS_LIMITS.blocks) throw new Error(`语言 ${language} 的原文块超过 10,000 个上限。`);
      const block: CorpusBlock = Object.freeze({
        id: corpusId('block'), text: content.text, kind: 'paragraph',
        path: `/tmx/body/tu[${tuIndex + 1}]/tuv[${variantIndex + 1}]/seg`,
      });
      document.blocks.push(block);
      const variant: UnitVariant = {
        language, text: content.text, originalText: content.text,
        tmxTuv: serializeXml(preservedTuv),
        refs: [{ documentId: document.id, blockId: block.id, start: 0, end: content.text.length }],
        ...(content.hasMarkup ? { markup: content.markup } : {}),
      };
      unit.variants.push(variant);
      if (Array.from(seg.getElementsByTagName('*')).some(element => element.localName === 'ut')) {
        warn('保留了已弃用的 TMX <ut> 行内代码；未转换为其他代码类型。', unit.id);
      }
    }
    unit.tmxTu = serializeXml(preserved);
    project.units.push(unit);
  }
  const direction = chooseDirection(Array.from(languages), header.getAttribute('srclang') || '', options);
  project.sourceLanguage = direction.sourceLanguage;
  project.targetLanguage = direction.targetLanguage;
  project.languages = Array.from(new Set([...languages, project.sourceLanguage, project.targetLanguage]));
  project.documents = Array.from(documents.values());
  for (const document of project.documents) { Object.freeze(document.blocks); Object.freeze(document); }
  for (const message of direction.warnings) warn(message);
  const hasExtraRootAttributes = Array.from(root.attributes).some(attribute => attribute.namespaceURI !== XMLNS_NAMESPACE
    && attribute.namespaceURI !== XML_NAMESPACE && attribute.name !== 'version');
  if (hasExtraRootAttributes || Array.from(body.attributes).some(attribute => attribute.namespaceURI !== XMLNS_NAMESPACE)) {
    warn('TMX 根元素或 body 的额外属性无法写入项目模型，导出不保留；header/TU/TUV 元数据仍保留。');
  }
  const outsideNodes = [...Array.from(parsed.document.childNodes), ...Array.from(root.childNodes), ...Array.from(body.childNodes)];
  if (outsideNodes.some(node => node.nodeType === 7 || node.nodeType === 8)) {
    warn('header/TU 外的 XML 注释和处理指令不保留；TU 内部内容仍保留。');
  }
  assertProjectBudget(project);
  return project;
}

function assertProjectBudget(project: CorpusProject): void {
  if (new TextEncoder().encode(JSON.stringify(project)).byteLength > CORPUS_LIMITS.projectBytes) {
    throw new Error('保留原始 XML 后的项目超过 30 MiB 上限。');
  }
}

function parsePreserved(xml: string, name: string): Element {
  const root = parseSafeXml(xml).document.documentElement;
  if (root.localName !== name || !supportedNamespace(root.namespaceURI)) throw new Error(`保存的 TMX <${name}> XML 无效。`);
  return root;
}

function makeElement(document: XMLDocument, context: Element, name: string): Element {
  return document.createElementNS(context.namespaceURI, context.prefix ? `${context.prefix}:${name}` : name);
}

/** Plain placeholders and moved sides may come from a different TMX namespace. */
function importTuv(document: XMLDocument, tu: Element, original: Element): Element {
  if (original.namespaceURI === tu.namespaceURI) return document.importNode(original, true);
  const copy = (node: Node): Node => {
    if (node.nodeType !== 1 || (node as Element).namespaceURI !== original.namespaceURI) {
      return document.importNode(node, true);
    }
    const element = node as Element;
    const clone = makeElement(document, tu, element.localName);
    for (const attribute of Array.from(element.attributes)) {
      // Let XMLSerializer declare the destination default namespace as needed.
      if (attribute.namespaceURI === XMLNS_NAMESPACE && attribute.name === 'xmlns') continue;
      clone.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    }
    for (const child of Array.from(element.childNodes)) clone.appendChild(copy(child));
    return clone;
  };
  return copy(original) as Element;
}

/** Metadata edits update text values while retaining attributes on existing props/notes. */
function applyMetadata(tu: Element, metadata: Record<string, string[]>): void {
  const document = tu.ownerDocument;
  for (const [key, values] of Object.entries(metadata)) {
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('TMX 元数据必须是字符串数组。');
    for (const value of values) assertXmlCharacters(value);
    if (key.startsWith('@')) {
      const name = key.slice(1);
      if (values.length > 1) throw new Error(`XML 属性 ${name} 不能有多个值。`);
      if (name === 'xmlns' || name.startsWith('xmlns:')) throw new Error('不能通过元数据编辑 XML 命名空间。');
      const previous = tu.getAttributeNode(name);
      const namespace = previous?.namespaceURI || (name.startsWith('xml:') ? XML_NAMESPACE : null);
      if (name.includes(':') && !namespace) throw new Error(`XML 属性 ${name} 缺少命名空间。`);
      if (!values.length) tu.removeAttribute(name);
      else if (namespace) tu.setAttributeNS(namespace, name, values[0]);
      else tu.setAttribute(name, values[0]);
      continue;
    }
    const isNote = key === 'note';
    const type = key.startsWith('prop:') ? key.slice(5) : key;
    if (!isNote && !type) throw new Error('TMX prop 必须具有非空 type。');
    assertXmlCharacters(type);
    const existing = children(tu, isNote ? 'note' : 'prop').filter(element => isNote || element.getAttribute('type') === type);
    for (let index = 0; index < Math.max(existing.length, values.length); index++) {
      if (index >= values.length) { existing[index].remove(); continue; }
      let element = existing[index];
      if (!element) {
        element = makeElement(document, tu, isNote ? 'note' : 'prop');
        if (!isNote) element.setAttribute('type', type);
        tu.insertBefore(element, children(tu, 'tuv')[0] || null);
      }
      if (element.textContent !== values[index]) element.textContent = values[index];
    }
  }
}

function replaceSegment(seg: Element, variant: UnitVariant, original: InlineContent | undefined): void {
  assertLanguage(variant.language);
  assertXmlCharacters(variant.text);
  if (variant.markup !== undefined) {
    const { seg: replacement, content } = inlineFragment(variant.markup);
    if (content.text !== variant.text) {
      throw new Error(`语言 ${variant.language} 的文本与行内 XML 不一致。请使用 validateInlineMarkup 同步更新 text 和 markup。`);
    }
    if (original?.markup === content.markup) return;
    seg.replaceChildren(...Array.from(replacement.childNodes, node => seg.ownerDocument.importNode(node, true)));
    return;
  }
  if (original?.hasMarkup) {
    if (original.text !== variant.text) {
      throw new Error(`语言 ${variant.language} 含 TMX 行内代码，不能仅修改纯文本；请编辑并验证 markup。`);
    }
    return;
  }
  if (original && original.text === variant.text) return;
  seg.textContent = variant.text;
}

function updateUnit(document: XMLDocument, body: Element, unit: BilingualUnit, sourceLanguage: string): Element {
  const original = unit.tmxTu ? parsePreserved(unit.tmxTu, 'tu') : undefined;
  const tu = original ? document.importNode(original, true) : makeElement(document, body, 'tu');
  assertStructuralText(tu);
  if (!original) { assertXmlCharacters(unit.id); tu.setAttribute('tuid', unit.id); }
  applyMetadata(tu, unit.metadata);
  if (tu.hasAttribute('srclang')) tu.setAttribute('srclang', sourceLanguage);
  const remaining = new Map<string, Element[]>();
  for (const tuv of children(tu, 'tuv')) {
    const key = languageKey(variantLanguage(tuv));
    const seg = onlyChild(tuv, 'seg');
    inspectSegment(seg); // Also validate untouched nonworking variants from stored XML.
    const group = remaining.get(key) || [];
    group.push(tuv); remaining.set(key, group);
  }
  for (const variant of unit.variants) {
    assertLanguage(variant.language);
    const key = languageKey(variant.language);
    const destination = remaining.get(key)?.shift();
    let tuv = destination;
    let content: InlineContent | undefined;
    let seg: Element;
    if (variant.tmxTuv !== undefined) {
      const savedTuv = parsePreserved(variant.tmxTuv, 'tuv');
      assertStructuralText(savedTuv);
      variantLanguage(savedTuv);
      onlyChild(savedTuv, 'seg');
      // Replace the whole side, so destination props/notes/attributes cannot leak
      // into a reassigned variant or an explicit empty placeholder.
      tuv = importTuv(document, tu, savedTuv);
      if (destination) tu.replaceChild(tuv, destination);
      else tu.appendChild(tuv);
    }
    if (tuv) { seg = onlyChild(tuv, 'seg'); content = inspectSegment(seg); }
    else {
      tuv = makeElement(document, tu, 'tuv');
      seg = makeElement(document, tuv, 'seg');
      tuv.appendChild(seg); tu.appendChild(tuv);
    }
    tuv.setAttributeNS(XML_NAMESPACE, 'xml:lang', variant.language);
    replaceSegment(seg, variant, content);
  }
  if (!children(tu, 'tuv').length) throw new Error(`翻译单元 ${unit.id} 没有可导出的语言变体。`);
  return tu;
}

/** Variant TUV metadata travels with its side; TU-only variants remain retained. */
export function exportTmx(project: CorpusProject): Uint8Array {
  requireBilingualDirection(project.sourceLanguage, project.targetLanguage);
  assertLanguage(project.sourceLanguage);
  assertLanguage(project.targetLanguage);
  if (project.units.length > CORPUS_LIMITS.units) throw new Error('TMX 翻译单元超过 10,000 条上限。');
  assertProjectBudget(project);
  const savedHeader = project.tmxHeader ? parsePreserved(project.tmxHeader, 'header') : undefined;
  // An empty document is created via DOMParser so there is no browser-global document dependency.
  const document = parseSafeXml('<tmx version="1.4"/>').document;
  if (savedHeader?.namespaceURI) {
    const replacement = document.createElementNS(savedHeader.namespaceURI, savedHeader.prefix ? `${savedHeader.prefix}:tmx` : 'tmx');
    replacement.setAttribute('version', '1.4');
    document.replaceChild(replacement, document.documentElement);
  }
  const root = document.documentElement;
  const header = savedHeader ? document.importNode(savedHeader, true) : makeElement(document, root, 'header');
  for (const [name, value] of Object.entries(HEADER_DEFAULTS)) if (!header.hasAttribute(name)) header.setAttribute(name, value);
  header.setAttribute('srclang', project.sourceLanguage);
  root.appendChild(header);
  const body = makeElement(document, root, 'body');
  root.appendChild(body);
  let characters = checkXmlBudget(header);
  for (const unit of project.units) {
    try {
      const tu = updateUnit(document, body, unit, project.sourceLanguage);
      characters += checkXmlBudget(tu);
      if (characters > CORPUS_LIMITS.expandedCharacters) throw new Error('TMX 展开后的文本超过 500,000 字符上限。');
      body.appendChild(tu);
    } catch (error) {
      throw new Error(`翻译单元 ${unit.id}：${(error as Error).message}`);
    }
  }
  checkXmlBudget(document);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${serializeXml(root)}`;
  const bytes = new TextEncoder().encode(xml);
  if (bytes.byteLength > CORPUS_LIMITS.inputBytes) throw new Error('导出的 TMX 超过 10 MiB 文件上限。');
  return bytes;
}

/** App-only state is intentionally kept in the project, not represented as TMX. */
export function exportTmxLosses(project: CorpusProject): string[] {
  const losses = project.warnings.filter(warning => /不保留|无法写入项目模型|移除外部.*DOCTYPE/.test(warning.message))
    .map(warning => warning.message);
  if (project.documents.length || project.units.some(unit => unit.variants.some(variant => variant.refs.length))) {
    losses.push('TMX 不包含项目源文档块、原文引用或 originalText 编辑前快照；请另存项目以保留这些信息。');
  }
  if (project.units.some(unit => unit.review !== 'unreviewed' || unit.locked || unit.score !== undefined || unit.provenance !== 'imported')) {
    losses.push('TMX 不包含应用内复核状态、锁定状态、对齐评分和来源标记；请另存项目以保留。');
  }
  return Array.from(new Set(losses));
}
