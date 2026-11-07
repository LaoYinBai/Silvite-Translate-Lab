-- SDLTM v4 profile from docs/sdltm-implementation-final.md, section 8.
-- 20 application tables + sqlite_sequence; 24 explicit indexes + 7 constraint indexes.
-- Execute each CREATE statement individually; initialize version parameters separately.

-- ===== 核心表 =====
CREATE TABLE resources(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, guid BLOB NOT NULL, type INT NOT NULL, language TEXT, data BLOB NOT NULL);
CREATE INDEX idx_Resources1 ON resources(type, language);
CREATE INDEX idx_Resources2 ON resources(id);

CREATE TABLE tm_resources(tm_id INT NOT NULL REFERENCES translation_memories(id) ON DELETE CASCADE, resource_id INT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, CONSTRAINT PK_tr PRIMARY KEY(tm_id, resource_id));

CREATE TABLE translation_memories(
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  guid BLOB NOT NULL,
  name TEXT NOT NULL UNIQUE,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  copyright TEXT, description TEXT,
  settings INT NOT NULL,
  creation_user TEXT NOT NULL,
  creation_date DATETIME NOT NULL,
  expiration_date DATETIME,
  fuzzy_indexes INT NOT NULL,
  last_recompute_date DATETIME,
  last_recompute_size INT,
  flags INT NOT NULL DEFAULT 0,
  tucount INT NOT NULL DEFAULT 0,
  fga_support INT NOT NULL,
  data_version INT NOT NULL,
  text_context_match_type INT NOT NULL,
  id_context_match BIT NOT NULL
);

CREATE TABLE parameters(translation_memory_id INT NULL REFERENCES translation_memories ON DELETE CASCADE, name TEXT NOT NULL, value TEXT NOT NULL);
CREATE INDEX p_main ON parameters(translation_memory_id, name);

CREATE TABLE translation_units(
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  guid BLOB NOT NULL,
  translation_memory_id INT NOT NULL REFERENCES translation_memories(id) ON DELETE CASCADE,
  source_hash INTEGER NOT NULL,
  source_segment TEXT,
  target_hash INTEGER NOT NULL,
  target_segment TEXT,
  creation_date DATETIME NOT NULL,
  creation_user TEXT NOT NULL,
  change_date DATETIME NOT NULL,
  change_user TEXT NOT NULL,
  last_used_date DATETIME NOT NULL,
  last_used_user TEXT NOT NULL,
  usage_counter INT NOT NULL,
  flags INT,
  source_token_data BLOB,
  target_token_data BLOB,
  alignment_data BLOB,
  align_model_date DATETIME,
  insert_date DATETIME,
  tokenization_sig_hash INTEGER
);

-- ⚠️ 以下索引全部必须创建（Trados 查询依赖）
CREATE INDEX idx_tus_hashes ON translation_units(translation_memory_id, source_hash, target_hash);
CREATE INDEX idx_tus_insert_dates ON translation_units(insert_date);
CREATE INDEX idx_tus_toksighash ON translation_units(tokenization_sig_hash);

CREATE TABLE translation_unit_contexts(translation_unit_id INT NOT NULL REFERENCES translation_units(id) ON DELETE CASCADE, left_source_context INTEGER NOT NULL, left_target_context INTEGER NOT NULL, CONSTRAINT PK_tuc PRIMARY KEY(translation_unit_id, left_source_context, left_target_context));
CREATE INDEX idx_ctx1 ON translation_unit_contexts(left_source_context);
CREATE INDEX idx_ctx2 ON translation_unit_contexts(left_target_context);

CREATE TABLE translation_unit_idcontexts(translation_unit_id INT NOT NULL REFERENCES translation_units(id) ON DELETE CASCADE, idcontext TEXT NOT NULL, CONSTRAINT PK_tuidc PRIMARY KEY(translation_unit_id, idcontext));
CREATE INDEX idx_tus_idcontexts ON translation_unit_idcontexts(translation_unit_id, idcontext);

CREATE TABLE translation_unit_fragments(translation_unit_id INT NOT NULL REFERENCES translation_units(id) ON DELETE CASCADE, fragment_hash INTEGER NOT NULL, CONSTRAINT tuf_a UNIQUE(translation_unit_id, fragment_hash));
CREATE INDEX idx_tufragments_ids ON translation_unit_fragments(translation_unit_id);
CREATE INDEX idx_tufragments_hashes ON translation_unit_fragments(fragment_hash);

CREATE TABLE attributes(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, guid BLOB NOT NULL, name TEXT NOT NULL, type INT NOT NULL, tm_id INT NOT NULL, CONSTRAINT CK_a UNIQUE(name, tm_id));
CREATE INDEX idx_attributes1 ON attributes(tm_id);
CREATE INDEX idx_attributes2 ON attributes(name, type);

CREATE TABLE string_attributes(translation_unit_id INT NOT NULL REFERENCES translation_units(id) ON DELETE CASCADE, attribute_id INT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE, value TEXT NOT NULL);
CREATE INDEX idx_string_attributes ON string_attributes(translation_unit_id, attribute_id);

CREATE TABLE numeric_attributes(translation_unit_id INT NOT NULL REFERENCES translation_units(id) ON DELETE CASCADE, attribute_id INT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE, value INT NOT NULL);
CREATE INDEX idx_numeric_attributes ON numeric_attributes(translation_unit_id, attribute_id);

CREATE TABLE date_attributes(translation_unit_id INT NOT NULL REFERENCES translation_units(id) ON DELETE CASCADE, attribute_id INT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE, value DATETIME NOT NULL);
CREATE INDEX idx_date_attributes ON date_attributes(translation_unit_id, attribute_id);

CREATE TABLE picklist_values(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, guid BLOB NOT NULL, attribute_id INT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE, value TEXT NOT NULL);
CREATE TABLE picklist_attributes(translation_unit_id INT NOT NULL REFERENCES translation_units(id) ON DELETE CASCADE, picklist_value_id INT NOT NULL REFERENCES picklist_values(id) ON DELETE CASCADE);
CREATE INDEX idx_picklist_attributes ON picklist_attributes(translation_unit_id);

CREATE TABLE fuzzy_data(translation_memory_id INT NOT NULL REFERENCES translation_memories(id) ON DELETE CASCADE, translation_unit_id INT NOT NULL, fi1 TEXT, fi2 TEXT, fi4 TEXT, fi8 TEXT, CONSTRAINT PK_fi1 PRIMARY KEY(translation_memory_id, translation_unit_id));

CREATE TABLE vocab_src(id INT NOT NULL, vocab TEXT NOT NULL, freq INT NOT NULL);
CREATE INDEX idx_vocab_src ON vocab_src(vocab);
CREATE TABLE vocab_trg(id INT NOT NULL, vocab TEXT NOT NULL, freq INT NOT NULL);
CREATE INDEX idx_vocab_trg ON vocab_trg(vocab);
CREATE TABLE vocabfilter(token TEXT NOT NULL);
CREATE INDEX idx_vocabfilter ON vocabfilter(token);
CREATE TABLE trans_model(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, sourcekey INTEGER NOT NULL, targetkey INTEGER NOT NULL, floatval REAL NOT NULL);
CREATE TABLE trans_model_rev(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, sourcekey INTEGER NOT NULL, targetkey INTEGER NOT NULL, floatval REAL NOT NULL);
CREATE INDEX idx_trans_model_sourcekey ON trans_model(sourcekey);
CREATE INDEX idx_trans_model_targetkey ON trans_model(targetkey);
CREATE INDEX idx_trans_model_rev_sourcekey ON trans_model_rev(sourcekey);
CREATE INDEX idx_trans_model_rev_targetkey ON trans_model_rev(targetkey);
