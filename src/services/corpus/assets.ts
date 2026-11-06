export interface CorpusAsset { file: string; bytes: number; sha256: string; parts?: Array<{ file: string; bytes: number; sha256: string }> }
export interface CorpusAssetManifest { revision: string; modelRevision: string; files: CorpusAsset[] }
export type ProgressReporter = (message: string, fraction?: number) => void;

const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');

export async function corpusManifest(base: URL): Promise<CorpusAssetManifest> {
  const url = new URL('manifest.json', base);
  let cache: Cache | undefined;
  try { cache = await globalThis.caches?.open('translate-lab-corpus-manifests-v1'); } catch { /* optional cache */ }
  const validate = (data: CorpusAssetManifest) => {
    if (!data.revision || !Array.isArray(data.files)) throw new Error('语料工具资源清单无效。');
    return data;
  };
  try {
    const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('语料工具资源尚未就绪，请稍后重新加载。');
    const data = validate(await response.clone().json());
    try { await cache?.put(url, response); } catch { /* current manifest remains usable */ }
    return data;
  } catch (error) {
    const saved = await cache?.match(url).catch(() => undefined);
    if (saved) return validate(await saved.json());
    throw error;
  }
}

export function corpusResourceCache(base: URL, manifest: CorpusAssetManifest, onBytes: (count: number) => void = () => {}) {
  const files = new Map(manifest.files.map(file => [file.file, file]));
  const storage = globalThis.caches?.open('translate-lab-corpus-' + manifest.revision).catch(() => undefined);
  return {
    async match(key: string): Promise<Response | undefined> {
      const url = new URL(key, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return undefined;
      const file = files.get(url.pathname.slice(base.pathname.length));
      if (!file) return undefined;
      const parts = file.parts || [file];
      if (!Number.isSafeInteger(file.bytes) || file.bytes > 200_000_000 || file.bytes < 1
        || parts.reduce((sum, part) => sum + part.bytes, 0) !== file.bytes) throw new Error('语料资源分片清单无效。');
      const cache = await storage;
      let index = 0;
      const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
        async pull(controller) {
          if (index === parts.length) { controller.close(); return; }
          const part = parts[index++];
          const partUrl = new URL(part.file, base);
          if (partUrl.origin !== base.origin || !partUrl.pathname.startsWith(base.pathname)) throw new Error('语料资源路径无效。');
          partUrl.searchParams.set('v', part.sha256);
          let bytes: Uint8Array<ArrayBuffer> | undefined;
          try {
            const cached = await cache?.match(partUrl.href);
            if (cached) {
              const candidate = new Uint8Array(await cached.arrayBuffer());
              if (candidate.length === part.bytes && await digest(candidate) === part.sha256) bytes = candidate;
              else await cache?.delete(partUrl.href);
            }
          } catch { /* the current download can still proceed */ }
          if (!bytes) {
            const response = await fetch(partUrl, { signal: AbortSignal.timeout(180_000) });
            if (!response.ok) throw new Error('语料资源下载失败（' + response.status + '），请重试。');
            bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length !== part.bytes || await digest(bytes) !== part.sha256) throw new Error('语料资源校验失败，请重试。');
            try { await cache?.put(partUrl.href, new Response(bytes)); } catch { /* optional persistent cache */ }
          }
          onBytes(bytes.length);
          controller.enqueue(bytes);
        },
      });
      return new Response(stream, { headers: { 'Content-Type': file.file.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Content-Length': String(file.bytes) } });
    },
    async put(_key: string, _response: Response): Promise<void> { /* integrity-checked parts are already cached */ },
  };
}

export async function loadCorpusResource(base: URL, manifest: CorpusAssetManifest, file: string, onBytes?: (count: number) => void): Promise<ArrayBuffer> {
  const response = await corpusResourceCache(base, manifest, onBytes).match(new URL(file, base).href);
  if (!response) throw new Error('缺少语料工具资源：' + file);
  return response.arrayBuffer();
}
