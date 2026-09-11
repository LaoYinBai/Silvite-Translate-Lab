// Shared test helpers for the /api/translate SSE handler tests.

// Builds a fake MiMo SSE response carrying the given content as stream
// deltas. Optional per-call behavior for retry scenarios.
export function mimoSseResponse(content, { finishReason = 'stop' } = {}) {
  const parts = [];
  if (content) {
    parts.push(JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] }));
  }
  parts.push(JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] }));
  parts.push('[DONE]');
  const text = parts.map((p) => `data: ${p}\n\n`).join('');
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// Parses the SSE response body into application events (data: JSON lines).
export async function readSseEvents(response) {
  const text = await response.text();
  const events = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload) continue;
    events.push(JSON.parse(payload));
  }
  return events;
}

export function finalEventOf(events) {
  return events.find((e) => e.type === 'final')?.result;
}

// Each request gets its own source IP so the module-level rate limiter
// cannot leak between tests (retries multiply the call count).
let requestIpCounter = 0;

export function makeRequest(body, extraHeaders = {}) {
  const ip = extraHeaders['x-forwarded-for'] || `test-ip-${++requestIpCounter}`;
  return new Request('http://localhost:3001/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

// --- Office fixtures ---------------------------------------------------------
// Real .doc / .pptx / .xlsx samples are personal documents and cannot be
// committed, so minimal OOXML packages are built here as stored
// (uncompressed) ZIP archives. The .pptx part set is verified to parse with
// office-oxide-wasm; legacy .doc is OLE-based and cannot be synthesised this
// way, so tests cover its signature validation instead.

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function storedZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((total, buffer) => total + buffer.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function minimalPptx(title = 'First slide heading', body = 'Bullet text here') {
  return storedZip([
    ['[Content_Types].xml', `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`],
    ['_rels/.rels', `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`],
    ['ppt/presentation.xml', `${XML_HEADER}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`],
    ['ppt/slides/slide1.xml', `${XML_HEADER}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${title}</a:t></a:r></a:p><a:p><a:r><a:rPr lang="en-US"/><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`],
  ]);
}

export function minimalXlsx(rows = [['角色名', '说明'], ['Silvite', '翻译工具']]) {
  const sheetRows = rows
    .map((cells, rowIndex) => `<row r="${rowIndex + 1}">${cells
      .map((value, columnIndex) => `<c r="${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${value}</t></is></c>`)
      .join('')}</row>`)
    .join('');
  return storedZip([
    ['[Content_Types].xml', `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML_HEADER}<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', `${XML_HEADER}<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`],
  ]);
}

// The WebAssembly module needs bytes under Node (it cannot fetch a file URL),
// and real browsers initialise it from the emitted asset. Initialisation is
// idempotent, so priming it here lets the app's own init call be a no-op.
export async function initOfficeWasm() {
  const { readFile } = await import('node:fs/promises');
  const { default: init } = await import('office-oxide-wasm/web');
  const wasmPath = new URL('../node_modules/office-oxide-wasm/web/office_oxide_bg.wasm', import.meta.url);
  await init({ module_or_path: await readFile(wasmPath) });
}

