import { create } from 'zustand';
import { mergeHistory, readHistory, removeHistory, writeHistory } from '../services/history/database';
import { HISTORY_LIMITS, historyErrorMessage, type HistoryImportSummary, type HistoryRecord } from '../services/history/types';
import { parseHistoryBackup, serializeHistoryBackup } from '../services/history/validation';

interface HistoryState {
  records: HistoryRecord[];
  hydrated: boolean;
  saving: 'loading' | 'saving' | 'saved' | 'error';
  error: string | null;
  pendingCount: number;
  unsavedCount: number;
}

export const useHistoryStore = create<HistoryState>(() => ({
  records: [], hydrated: false, saving: 'loading', error: null, pendingCount: 0, unsavedCount: 0,
}));

// This queue includes the state update after commit. A late hydrate can never
// replace newer committed state. Tracking begins synchronously while it loads.
let queue: Promise<unknown> = Promise.resolve();
let hydrate: Promise<void> | null = null;
let outstanding = 0;
let lastError: string | null = null;
interface PendingWrite { record: HistoryRecord; create: boolean; error: string | null }
const unsaved = new Map<string, PendingWrite>();
// Mark deletion immediately, before waiting for queued IDB writes. Late
// background alignment must never recreate a record the user has removed.
const deleted = new Set<string>();
const deleting = new Set<string>();

function status(): void {
  const failed = [...unsaved.values()].find(item => item.error)?.error;
  const error = failed || lastError;
  useHistoryStore.setState({
    pendingCount: outstanding, unsavedCount: unsaved.size, error,
    saving: error ? 'error' : outstanding ? 'saving' : useHistoryStore.getState().hydrated ? 'saved' : 'loading',
  });
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  outstanding += 1;
  status();
  const task = queue.then(async () => {
    try { return await operation(); }
    catch (error) { lastError = historyErrorMessage(error); throw error; }
    finally { outstanding -= 1; status(); }
  });
  queue = task.catch(() => undefined);
  return task;
}

export function hydrateHistory(force = false): Promise<void> {
  if (hydrate && !force) return hydrate;
  const task = enqueue(async () => {
    const { records } = await readHistory();
    lastError = null;
    useHistoryStore.setState({ records, hydrated: true });
  });
  hydrate = task;
  void task.catch(() => { if (hydrate === task) hydrate = null; });
  return task;
}

export function saveHistoryRecord(record: HistoryRecord, create: boolean): Promise<void> {
  if (deleted.has(record.id)) {
    // Keep the latest result while deletion is unresolved. On failure it must
    // not lose an AI alignment which completed during the database request.
    if (deleting.has(record.id)) { unsaved.set(record.id, { record, create: false, error: null }); status(); }
    return Promise.resolve();
  }
  const previous = unsaved.get(record.id);
  // A failed first write retains permission to create on explicit retry or the
  // next alignment update; once committed all updates require an existing row.
  const pending: PendingWrite = { record, create: previous?.create || create, error: null };
  unsaved.set(record.id, pending);
  return enqueue(async () => {
    if (deleted.has(record.id)) {
      if (unsaved.get(record.id) === pending) unsaved.delete(record.id);
      return;
    }
    try {
      const outcome = await writeHistory(record, pending.create);
      if (unsaved.get(record.id) === pending) unsaved.delete(record.id);
      // Newer pending alignment snapshots do not gain permission to resurrect
      // an already committed row removed in another tab.
      const latest = unsaved.get(record.id);
      if (latest && outcome.value) latest.create = false;
      lastError = null;
      useHistoryStore.setState({ records: outcome.records, hydrated: true });
    } catch (error) {
      if (unsaved.get(record.id) === pending) pending.error = historyErrorMessage(error);
      throw error;
    }
  });
}

export function reportHistoryError(error: unknown): void {
  lastError = historyErrorMessage(error);
  status();
}

export function deleteHistoryRecord(id: string): Promise<void> {
  const previouslyDeleted = deleted.has(id), pending = unsaved.get(id);
  deleted.add(id);
  deleting.add(id);
  unsaved.delete(id);
  return enqueue(async () => {
    try {
      const { records } = await removeHistory(id);
      unsaved.delete(id);
      lastError = null;
      useHistoryStore.setState({ records, hydrated: true });
    } catch (error) {
      if (pending && !unsaved.has(id)) unsaved.set(id, pending);
      // Database operations have their own queue. Recover here, before the
      // store queue advances, so a newer queued update cannot be overwritten.
      while (!previouslyDeleted && unsaved.has(id)) {
        const latest = unsaved.get(id)!;
        try {
          const outcome = await writeHistory(latest.record, false);
          if (unsaved.get(id) === latest) unsaved.delete(id);
          useHistoryStore.setState({ records: outcome.records, hydrated: true });
        } catch (saveError) {
          const current = unsaved.get(id);
          if (current) current.error = historyErrorMessage(saveError);
          break;
        }
      }
      if (!previouslyDeleted) deleted.delete(id);
      throw error;
    } finally { deleting.delete(id); }
  });
}

export async function importHistoryFile(file: File): Promise<HistoryImportSummary> {
  // Parse every record before any DB work. The merge transaction validates the
  // combined collection again against records committed while parsing.
  if (file.size > HISTORY_LIMITS.backupBytes) throw new Error('历史备份文件不能超过 30 MiB。');
  const imported = parseHistoryBackup(await file.text());
  return enqueue(async () => {
    const outcome = await mergeHistory(imported);
    const existing = new Set(outcome.records.map(record => record.id));
    for (const record of imported) if (existing.has(record.id)) deleted.delete(record.id);
    lastError = null;
    useHistoryStore.setState({ records: outcome.records, hydrated: true });
    return outcome.value;
  });
}

export function exportHistoryJson(): Promise<string> {
  return enqueue(async () => {
    const { records } = await readHistory();
    const text = serializeHistoryBackup(records);
    useHistoryStore.setState({ records, hydrated: true });
    lastError = null;
    return text;
  });
}

export async function retryHistory(): Promise<void> {
  const pending = [...unsaved.values()];
  // Await all attempts without losing later pending requests after one failure.
  const attempts = await Promise.allSettled(pending.map(item => saveHistoryRecord(item.record, item.create)));
  await hydrateHistory(true);
  const failure = attempts.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
