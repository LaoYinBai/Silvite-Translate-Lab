import type { Database, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm';
import sampleSchema from '../../../docs/research/2026-11-06-sdltm-schema.sql?raw';
import { sdltmGuid, sdltmHash, sdltmSegment, type SdltmInput, type SdltmResult } from './sdltm';
import type { ProgressReporter } from './assets';

/** Allocate using sqlite3_malloc, never the Emscripten allocator: SQLite resizes/frees this buffer. */
export function openSdltm(sqlite: Sqlite3Static, bytes: Uint8Array, readOnly = false): Database {
  const db = new sqlite.oo1.DB(':memory:', 'c');
  const { capi, wasm } = sqlite;
  const capacity = bytes.length + 20;
  const pointer = capi.sqlite3_malloc(capacity);
  if (!pointer) { db.close(); throw new Error('SQLite 内存不足。'); }
  wasm.heap8u().set(bytes, pointer);
  wasm.heap8u().fill(0, pointer + bytes.length, pointer + capacity);
  const flags = capi.SQLITE_DESERIALIZE_FREEONCLOSE | (readOnly ? capi.SQLITE_DESERIALIZE_READONLY : capi.SQLITE_DESERIALIZE_RESIZEABLE);
  const rc = capi.sqlite3_deserialize(db, 'main', pointer, bytes.length, capacity, flags);
  // FREEONCLOSE transfers ownership even on failure: SQLite already frees it.
  if (rc !== capi.SQLITE_OK) { db.close(); throw new Error('无法读取 SDLTM 模板。'); }
  try { db.exec('PRAGMA foreign_keys=ON; PRAGMA max_page_count=8192; PRAGMA temp_store=MEMORY;'); }
  catch (error) { db.close(); throw error; }
  return db;
}

function supplementSampleSchema(db: Database): void {
  // Same 20 tables and 25 ordinary indexes as the supplied native samples.
  // No private rows, creators, tokens or fuzzy data are copied from them.
  for (const [table, columns] of Object.entries({
    translation_memories: ['fga_support INT NOT NULL DEFAULT 1', 'data_version INT NOT NULL DEFAULT 1',
      'text_context_match_type INT NOT NULL DEFAULT 1', 'id_context_match BIT NOT NULL DEFAULT 0'],
    translation_units: ['source_token_data BLOB', 'target_token_data BLOB', 'alignment_data BLOB',
      'align_model_date DATETIME', 'insert_date DATETIME', 'tokenization_sig_hash INTEGER'],
  })) {
    const present = new Set(db.selectObjects('PRAGMA table_info(' + table + ')').map(row => row.name));
    for (const column of columns) if (!present.has(column.split(' ')[0])) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column);
  }
  db.exec(sampleSchema.replaceAll(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ').replaceAll(/CREATE INDEX /g, 'CREATE INDEX IF NOT EXISTS '));
  // Keep the official 8.06 baseline; do not claim that a native 8.10 application created this file.
  db.exec("INSERT INTO parameters(translation_memory_id,name,value) VALUES(NULL,'TokenDataVersion','1'),(NULL,'AlignmentDataVersion','1');");
}

function checkDatabase(db: Database, input: SdltmInput, hashes: Array<[bigint, bigint]>): void {
  if (db.selectValues('PRAGMA integrity_check').join() !== 'ok' || db.selectObjects('PRAGMA foreign_key_check').length) {
    throw new Error('SDLTM 数据库完整性或外键检查失败，已停止导出。');
  }
  const memories = db.selectObjects('SELECT source_language,target_language,tucount,length(guid) AS guid_length FROM translation_memories');
  if (memories.length !== 1 || memories[0].source_language !== input.sourceLanguage || memories[0].target_language !== input.targetLanguage
    || memories[0].tucount !== input.pairs.length || memories[0].guid_length !== 16) throw new Error('SDLTM 语言方向或记忆库数量核对失败。');
  const rows = db.selectObjects('SELECT source_segment,target_segment,CAST(source_hash AS TEXT) AS sh,CAST(target_hash AS TEXT) AS th,length(guid) AS guid_length FROM translation_units ORDER BY id');
  if (rows.length !== input.pairs.length) throw new Error('SDLTM 句段数量核对失败。');
  rows.forEach((row, index) => {
    const pair = input.pairs[index];
    if (row.source_segment !== sdltmSegment(pair.source, input.sourceLanguage) || row.target_segment !== sdltmSegment(pair.target, input.targetLanguage)
      || row.sh !== String(hashes[index][0]) || row.th !== String(hashes[index][1]) || row.guid_length !== 16) {
      throw new Error(`SDLTM 第 ${index + 1} 行文本或整数回读不一致，已停止导出。`);
    }
  });
  if (db.selectValue('SELECT count(DISTINCT hex(guid)) FROM translation_units') !== rows.length) throw new Error('SDLTM 句段标识重复。');
}

export async function writeSdltm(sqlite: Sqlite3Static, input: SdltmInput, template: Uint8Array, progress: ProgressReporter): Promise<SdltmResult> {
  const db = openSdltm(sqlite, template);
  const hashes: Array<[bigint, bigint]> = [];
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    if (db.selectValue('SELECT count(*) FROM translation_memories') !== 1 || db.selectValue('SELECT count(*) FROM translation_units') !== 0
      || db.selectValue('SELECT count(*) FROM resources') !== 0) {
      throw new Error('SDLTM 空模板与预期不符，已停止导出。');
    }
    db.exec('BEGIN');
    db.exec('DELETE FROM picklist_attributes; DELETE FROM string_attributes; DELETE FROM numeric_attributes; DELETE FROM date_attributes; DELETE FROM picklist_values; DELETE FROM attributes;');
    supplementSampleSchema(db);
    const tmId = db.selectValue('SELECT id FROM translation_memories') as number;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.exec({ sql: `UPDATE translation_memories SET guid=?,name=?,source_language=?,target_language=?,copyright=NULL,
      description=?,creation_user=?,creation_date=?,expiration_date=?,last_recompute_date=NULL,last_recompute_size=NULL,
      tucount=?,settings=63,fuzzy_indexes=15,flags=0 WHERE id=?`,
      bind: [sdltmGuid(), input.name, input.sourceLanguage, input.targetLanguage,
        'Silvite experimental export. Trados compatibility is not guaranteed. Placeholder hashes; no native token/fuzzy indexes.',
        'Silvite Translate Lab', now, '9999-12-31 23:59:59', input.pairs.length, tmId] });
    const insert = db.prepare(`INSERT INTO translation_units(guid,translation_memory_id,source_hash,source_segment,target_hash,target_segment,
      creation_date,creation_user,change_date,change_user,last_used_date,last_used_user,usage_counter,flags,insert_date)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    try {
      for (const [index, pair] of input.pairs.entries()) {
        const [sourceHash, targetHash] = await Promise.all([sdltmHash(pair.source), sdltmHash(pair.target)]);
        hashes.push([sourceHash, targetHash]);
        const values: SqlValue[] = [sdltmGuid(), tmId, sourceHash, sdltmSegment(pair.source, input.sourceLanguage), targetHash,
          sdltmSegment(pair.target, input.targetLanguage), now, 'Silvite Translate Lab', now, 'Silvite Translate Lab', now, 'Silvite Translate Lab', 0, 0, now];
        insert.bind(values).step(); insert.reset().clearBindings();
        if (index % 25 === 0 || index + 1 === input.pairs.length) progress('正在写入 SDLTM：' + (index + 1) + ' / ' + input.pairs.length, 0.2 + 0.6 * (index + 1) / input.pairs.length);
      }
    } finally { insert.finalize(); }
    db.exec('COMMIT');
    progress('检查 SDLTM 完整性与逐行文本', 0.85);
    checkDatabase(db, input, hashes);
    // VACUUM removes historical template pages and produces a self-contained SQLite file.
    db.exec('VACUUM');
    bytes = sqlite.capi.sqlite3_js_db_export(db);
  } finally { db.close(); }
  const reread = openSdltm(sqlite, bytes, true);
  try { checkDatabase(reread, input, hashes); } finally { reread.close(); }
  progress('SDLTM 本地结构与文本回读检查通过', 1);
  return { bytes, validation: { level: 'local_structural', units: input.pairs.length,
    sourceLanguage: input.sourceLanguage, targetLanguage: input.targetLanguage } };
}
