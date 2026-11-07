import type { Database, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm';
import schema from './sdltmSchema.sql?raw';
import { sdltmGuid, sdltmSegment, type SdltmInput, type SdltmResult } from './sdltm';
import { sdltmSideIndex, type SdltmSideIndex } from './sdltmIndex';
import type { ProgressReporter } from './assets';

// This bundled DDL has only CREATE statements and line comments, with no SQL literals.
const schemaStatements = schema.replace(/--[^\r\n]*/g, '').split(';').map(statement => statement.trim()).filter(Boolean);

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
  if (rc !== capi.SQLITE_OK) { db.close(); throw new Error('无法重新读取生成的 SDLTM 数据库。'); }
  try { db.exec('PRAGMA foreign_keys=OFF'); db.exec('PRAGMA max_page_count=8192'); db.exec('PRAGMA temp_store=MEMORY'); }
  catch (error) { db.close(); throw error; }
  return db;
}

type UnitIndex = { source: SdltmSideIndex; target: SdltmSideIndex };

function sameBytes(actual: unknown, expected: Uint8Array): boolean {
  return actual instanceof Uint8Array && actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

function checkDatabase(db: Database, input: SdltmInput, indexes: UnitIndex[]): void {
  if (db.selectValues('PRAGMA integrity_check').join() !== 'ok' || db.selectObjects('PRAGMA foreign_key_check').length) {
    throw new Error('SDLTM 数据库完整性或外键检查失败，已停止导出。');
  }
  // v4 counts include sqlite_sequence and UNIQUE/PRIMARY KEY automatic indexes.
  if (db.selectValue("SELECT count(*) FROM sqlite_schema WHERE type='table'") !== 21
    || db.selectValue("SELECT count(*) FROM sqlite_schema WHERE type='index'") !== 31
    || db.selectValue('PRAGMA foreign_keys') !== 0) {
    throw new Error('SDLTM 数据库结构或外键设置与终版规范不一致，已停止导出。');
  }
  const memories = db.selectObjects('SELECT id,source_language,target_language,tucount,fuzzy_indexes,length(guid) AS guid_length FROM translation_memories');
  if (memories.length !== 1 || memories[0].source_language !== input.sourceLanguage || memories[0].target_language !== input.targetLanguage
    || memories[0].tucount !== input.pairs.length || memories[0].guid_length !== 16 || memories[0].fuzzy_indexes !== 15) throw new Error('SDLTM 语言方向或记忆库数量核对失败。');
  const tmId = memories[0].id;
  const parameters = db.selectObjects('SELECT translation_memory_id,name,value FROM parameters');
  const profile = [['VERSION', '8.06', null], ['VERSION_CREATED', '8.10', null], ['FREQUENCYTOP', '1000', null],
    ['TokenDataVersion', '1', tmId], ['AlignmentDataVersion', '1', tmId]];
  if (parameters.length !== profile.length || profile.some(([name, value, scope]) =>
    parameters.filter(row => row.name === name && row.value === value && row.translation_memory_id === scope).length !== 1)) {
    throw new Error('SDLTM 格式版本或语言处理参数核对失败。');
  }
  const rows = db.selectObjects(`SELECT id,translation_memory_id,source_segment,target_segment,CAST(source_hash AS TEXT) AS sh,
    CAST(target_hash AS TEXT) AS th,source_token_data,target_token_data,tokenization_sig_hash,flags,length(guid) AS guid_length
    FROM translation_units ORDER BY id`);
  const fuzzyRows = db.selectObjects('SELECT translation_memory_id,translation_unit_id,fi1,fi2,fi4,fi8 FROM fuzzy_data ORDER BY translation_unit_id');
  const fragments = db.selectObjects('SELECT translation_unit_id,CAST(fragment_hash AS TEXT) AS hash FROM translation_unit_fragments ORDER BY translation_unit_id');
  if (rows.length !== input.pairs.length) throw new Error('SDLTM 句段数量核对失败。');
  if (fuzzyRows.length !== rows.length || fragments.length !== rows.length) throw new Error('SDLTM 索引数量核对失败。');
  rows.forEach((row, index) => {
    const pair = input.pairs[index];
    const { source, target } = indexes[index];
    if (row.source_segment !== sdltmSegment(pair.source, input.sourceLanguage) || row.target_segment !== sdltmSegment(pair.target, input.targetLanguage)
      || row.sh !== String(source.hash) || row.th !== String(target.hash) || row.guid_length !== 16
      || row.id !== index + 1 || row.translation_memory_id !== tmId || row.flags !== 393473 || row.tokenization_sig_hash !== null) {
      throw new Error(`SDLTM 第 ${index + 1} 行文本或整数回读不一致，已停止导出。`);
    }
    const fuzzy = fuzzyRows[index];
    if (!sameBytes(row.source_token_data, source.tokenData) || !sameBytes(row.target_token_data, target.tokenData)
      || fuzzy.translation_memory_id !== tmId || fuzzy.translation_unit_id !== row.id || fuzzy.fi1 !== source.wordFeatures
      || fuzzy.fi2 !== source.charFeatures || fuzzy.fi4 !== target.charFeatures || fuzzy.fi8 !== target.wordFeatures
      || fragments[index].translation_unit_id !== row.id || fragments[index].hash !== String(source.hash)) {
      throw new Error(`SDLTM 第 ${index + 1} 行 Token 或模糊索引回读不一致，已停止导出。`);
    }
  });
  if (db.selectValue('SELECT count(DISTINCT hex(guid)) FROM translation_units') !== rows.length) throw new Error('SDLTM 句段标识重复。');
}

export async function writeSdltm(sqlite: Sqlite3Static, input: SdltmInput, progress: ProgressReporter): Promise<SdltmResult> {
  const db = new sqlite.oo1.DB(':memory:', 'c');
  const indexes: UnitIndex[] = [];
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    // foreign_keys must be configured before BEGIN; changing it inside a transaction has no effect.
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('PRAGMA page_size=4096');
    db.exec('PRAGMA max_page_count=8192');
    db.exec('PRAGMA temp_store=MEMORY');
    db.exec('BEGIN');
    progress('按终版规范逐条创建 SDLTM 表与索引', 0.15);
    for (const statement of schemaStatements) db.exec(statement);
    const tmId = 1;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.exec({ sql: `INSERT INTO translation_memories(id,guid,name,source_language,target_language,copyright,
      description,creation_user,creation_date,expiration_date,last_recompute_date,last_recompute_size,
      tucount,settings,fuzzy_indexes,flags,fga_support,data_version,text_context_match_type,id_context_match)
      VALUES(?,?,?,?,?,NULL,?,?,?,NULL,NULL,NULL,?,63,15,0,1,1,1,0)`,
      bind: [tmId, sdltmGuid(), input.name, input.sourceLanguage, input.targetLanguage,
        'Silvite experimental export. Trados compatibility is not guaranteed. Browser-generated strict hashes, word tokens and bilingual fuzzy indexes. Reindex in Trados to rebuild native language data.',
        'Silvite Translate Lab', now, input.pairs.length] });
    for (const [scope, name, value] of [[null, 'VERSION', '8.06'], [null, 'VERSION_CREATED', '8.10'],
      [null, 'FREQUENCYTOP', '1000'], [tmId, 'TokenDataVersion', '1'], [tmId, 'AlignmentDataVersion', '1']]) {
      db.exec({ sql: 'INSERT INTO parameters(translation_memory_id,name,value) VALUES(?,?,?)', bind: [scope, name, value] });
    }
    const insert = db.prepare(`INSERT INTO translation_units(id,guid,translation_memory_id,source_hash,source_segment,target_hash,target_segment,
      creation_date,creation_user,change_date,change_user,last_used_date,last_used_user,usage_counter,flags,insert_date,
      source_token_data,target_token_data,alignment_data,align_model_date,tokenization_sig_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)`);
    try {
      const fuzzyInsert = db.prepare('INSERT INTO fuzzy_data(translation_memory_id,translation_unit_id,fi1,fi2,fi4,fi8) VALUES(?,?,?,?,?,?)');
      try {
        const fragmentInsert = db.prepare('INSERT INTO translation_unit_fragments(translation_unit_id,fragment_hash) VALUES(?,?)');
        try {
          for (const [index, pair] of input.pairs.entries()) {
            const source = sdltmSideIndex(pair.source, input.sourceLanguage), target = sdltmSideIndex(pair.target, input.targetLanguage);
            indexes.push({ source, target });
            const values: SqlValue[] = [index + 1, sdltmGuid(), tmId, source.hash, sdltmSegment(pair.source, input.sourceLanguage), target.hash,
              sdltmSegment(pair.target, input.targetLanguage), now, 'Silvite Translate Lab', now, 'Silvite Translate Lab', now, 'Silvite Translate Lab',
              0, 393473, now, source.tokenData, target.tokenData];
            insert.bind(values).step(); insert.reset().clearBindings();
            fuzzyInsert.bind([tmId, index + 1, source.wordFeatures, source.charFeatures, target.charFeatures, target.wordFeatures]).step();
            fuzzyInsert.reset().clearBindings();
            // v4 explicitly uses source_hash here as a placeholder until native reindexing.
            fragmentInsert.bind([index + 1, source.hash]).step(); fragmentInsert.reset().clearBindings();
            if (index % 25 === 0 || index + 1 === input.pairs.length) progress('正在生成 SDLTM 句段与索引：' + (index + 1) + ' / ' + input.pairs.length, 0.2 + 0.6 * (index + 1) / input.pairs.length);
          }
        } finally { fragmentInsert.finalize(); }
      } finally { fuzzyInsert.finalize(); }
    } finally { insert.finalize(); }
    db.exec('COMMIT');
    progress('检查 SDLTM 结构、文本、哈希、Token 与模糊索引', 0.85);
    checkDatabase(db, input, indexes);
    // Export a compact, self-contained SQLite file from the in-memory schema.
    db.exec('VACUUM');
    bytes = sqlite.capi.sqlite3_js_db_export(db);
  } finally { db.close(); }
  const reread = openSdltm(sqlite, bytes, true);
  try { checkDatabase(reread, input, indexes); } finally { reread.close(); }
  progress('SDLTM 本地结构、文本与索引回读检查通过', 1);
  return { bytes, validation: { level: 'local_structural', units: input.pairs.length, skippedEmptyUnits: input.skippedEmptyUnits,
    sourceLanguage: input.sourceLanguage, targetLanguage: input.targetLanguage } };
}
