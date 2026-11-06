interface ModelPart { file: string; bytes: number; sha256: string }
interface ModelFile extends ModelPart { parts?: ModelPart[] }
export interface WhisperManifest { revision: string; files: ModelFile[] }

/** Reassemble static model parts through Transformers' supported cache adapter.
 * This keeps every hosted file below Pages' file limit without a runtime server.
 */
export function createWhisperModelCache(
  assetBase: string,
  manifest: WhisperManifest,
  fetcher: typeof fetch = fetch,
  storage: Pick<CacheStorage, 'open'> | null | undefined = globalThis.caches,
) {
  const base = new URL('models/whisper-tiny/', assetBase);
  const files = new Map(manifest.files.map(file => [file.file, file]));
  const cache = storage?.open(`translate-lab-whisper-${manifest.revision}-parts-v1`).catch(() => null) ?? Promise.resolve(null);
  const localURL = (key: string) => {
    const url = new URL(key, base.origin);
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) ? url : null;
  };
  return {
    async match(key: string): Promise<Response | undefined> {
      const url = localURL(key);
      if (!url) return undefined;
      const file = files.get(url.pathname.slice(base.pathname.length));
      const browserCache = await cache;
      const cached = await browserCache?.match(url.href).catch(() => undefined);
      if (cached) return cached;
      if (!file?.parts) return undefined;
      const parts = file.parts;
      if (parts.reduce((total, part) => total + part.bytes, 0) !== file.bytes) throw new Error('语音模型分片清单无效。');
      let index = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (index === parts.length) { controller.close(); return; }
          const part = parts[index++];
          const partURL = new URL(part.file, base);
          if (partURL.origin !== base.origin || !partURL.pathname.startsWith(base.pathname)) throw new Error('语音模型分片地址无效。');
          const response = await fetcher(partURL.href);
          if (!response.ok) throw new Error(`语音模型分片加载失败（${response.status}）。`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
          if (bytes.length !== part.bytes || hash !== part.sha256) throw new Error('语音模型分片校验失败，请清理本站缓存后重试。');
          controller.enqueue(bytes);
        },
      });
      const response = new Response(stream, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.bytes) } });
      // Cache availability or quota must never prevent local inference.
      if (browserCache) void browserCache.put(url.href, response.clone()).catch(() => undefined);
      return response;
    },
    async put(key: string, response: Response) {
      const url = localURL(key);
      if (url) await (await cache)?.put(url.href, response).catch(() => undefined);
    },
  };
}
