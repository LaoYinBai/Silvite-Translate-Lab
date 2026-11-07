import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { corpusManifest, loadCorpusResource } from './assets';
import { writeSdltm } from './sdltmSqlite';
import type { SdltmInput } from './sdltm';

self.onmessage = async ({ data }: MessageEvent<{ id: string; base: string; input: SdltmInput }>) => {
  const { id, input } = data;
  const progress = (message: string, fraction?: number) => self.postMessage({ id, type: 'progress', message, fraction });
  try {
    progress('加载浏览器内 SQLite', 0);
    const base = new URL(data.base);
    if (base.origin !== self.location.origin) throw new Error('SQLite 资源必须从本站加载。');
    const manifest = await corpusManifest(base);
    const wasm = await loadCorpusResource(base, manifest, 'sqlite/sqlite3.wasm');
    // Only a transient in-memory DB is needed. Disable optional OPFS initialization;
    // no SharedArrayBuffer, cross-origin isolation, file permissions or host service.
    Object.assign(globalThis, { sqlite3ApiConfig: { disable: { vfs: { opfs: true, 'opfs-vfs': true, 'opfs-sahpool': true, 'opfs-wl': true } } } });
    const initialize = sqlite3InitModule as unknown as (options: { wasmBinary: Uint8Array; print: () => void; printErr: () => void }) => Promise<Sqlite3Static>;
    const sqlite = await initialize({ wasmBinary: new Uint8Array(wasm), print: () => {}, printErr: () => {} });
    const result = await writeSdltm(sqlite, input, progress);
    self.postMessage({ id, type: 'result', result }, { transfer: [result.bytes.buffer] });
  } catch (error) { self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : 'SDLTM 导出失败。' }); }
};
