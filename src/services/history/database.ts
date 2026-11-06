import { HISTORY_LIMITS, type HistoryImportSummary, type HistoryRecord } from './types';
import { assertCollectionLimits, validateHistoryRecord } from './validation';

const DATABASE = 'silvite-translation-history';
const STORE = 'records';
let connection: Promise<IDBDatabase> | null = null;
let queue: Promise<unknown> = Promise.resolve();

// Reads, hydration and all mutations share this queue. A failed operation must
// not poison later operations. IDB readwrite transactions also serialize tabs.
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const task = queue.then(operation);
  queue = task.catch(() => undefined);
  return task;
}

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('此浏览器无法使用 IndexedDB，本地历史未保存。请使用允许网站存储数据的浏览器。'));
      return;
    }
    let settled = false;
    const request = indexedDB.open(DATABASE, 1);
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    const timer = setTimeout(() => fail(new Error('打开本地历史数据库超时。请关闭此网站的其他旧页面后重试。')), 15_000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onblocked = () => {
      clearTimeout(timer);
      fail(new Error('历史数据库被其他页面占用。请关闭此网站的其他旧页面后重试。'));
    };
    request.onerror = () => { clearTimeout(timer); fail(request.error || new Error('无法打开本地历史数据库。')); };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => { db.close(); connection = null; };
      db.onclose = () => { connection = null; };
      resolve(db);
    };
  });
  connection = pending;
  void pending.catch(() => { if (connection === pending) connection = null; });
  return pending;
}

export interface HistoryTransaction<T> { records: HistoryRecord[]; value: T }
type Change<T> = (records: HistoryRecord[], store: IDBObjectStore) => HistoryTransaction<T>;

function transaction<T>(mode: IDBTransactionMode, change: Change<T>): Promise<HistoryTransaction<T>> {
  return serialized(async () => {
    const db = await openDatabase();
    return new Promise<HistoryTransaction<T>>((resolve, reject) => {
      const tx = db.transaction(STORE, mode), store = tx.objectStore(STORE);
      let outcome: HistoryTransaction<T> | undefined;
      let failure: unknown;
      tx.oncomplete = () => outcome ? resolve(outcome) : reject(new Error('历史事务未返回结果，请重试。'));
      tx.onabort = () => reject(failure || tx.error || new DOMException('历史事务中止', 'AbortError'));
      tx.onerror = () => { failure ||= tx.error; };
      const read = store.getAll(undefined, HISTORY_LIMITS.records + 1);
      read.onsuccess = () => {
        // No awaits inside this callback: validation and all writes stay in the
        // same active transaction, with no partially applied import on failure.
        try {
          const records = read.result.map(validateHistoryRecord);
          assertCollectionLimits(records);
          outcome = change(records, store);
          outcome.records.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || a.id.localeCompare(b.id));
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  });
}

export function readHistory(): Promise<HistoryTransaction<undefined>> {
  return transaction('readonly', records => ({ records, value: undefined }));
}

export function writeHistory(record: HistoryRecord, create: boolean): Promise<HistoryTransaction<boolean>> {
  // Clone/whitelist before enqueueing so a caller cannot mutate a queued write.
  const safe = validateHistoryRecord(record);
  return transaction('readwrite', (records, store) => {
    const existing = records.find(item => item.id === safe.id);
    if (!existing && !create) return { records, value: false };
    if (existing && (existing.sourceText !== safe.sourceText || existing.result.translation !== safe.result.translation
      || existing.result.sourceLanguage !== safe.result.sourceLanguage || existing.result.targetLanguage !== safe.result.targetLanguage
      || existing.requestedAt !== safe.requestedAt || existing.completedAt !== safe.completedAt || JSON.stringify(existing.request) !== JSON.stringify(safe.request))) {
      throw new Error('历史 ID 与已有记录冲突，已保留已有记录；本次结果未覆盖写入。');
    }
    const next = [...records.filter(item => item.id !== safe.id), safe];
    assertCollectionLimits(next);
    store.put(safe);
    return { records: next, value: true };
  });
}

export function removeHistory(id: string): Promise<HistoryTransaction<undefined>> {
  return transaction('readwrite', (records, store) => {
    store.delete(id);
    return { records: records.filter(item => item.id !== id), value: undefined };
  });
}

export function mergeHistory(imported: HistoryRecord[]): Promise<HistoryTransaction<HistoryImportSummary>> {
  const safe = imported.map(validateHistoryRecord);
  return transaction('readwrite', (records, store) => {
    const ids = new Set(records.map(record => record.id));
    const additions = safe.filter(record => !ids.has(record.id));
    const next = [...records, ...additions];
    assertCollectionLimits(next);
    for (const record of additions) store.add(record);
    return { records: next, value: { added: additions.length, skipped: safe.length - additions.length } };
  });
}
