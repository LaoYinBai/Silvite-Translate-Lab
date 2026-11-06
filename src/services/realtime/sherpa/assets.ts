interface AssetPart { file: string; bytes: number; sha256: string }
interface Asset extends AssetPart { parts?: AssetPart[] }
export interface ASRManifest { revision: string; model: string; files: Asset[] }

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  value => value.toString(16).padStart(2, '0'),
).join('');

export async function loadASRAsset(
  base: URL, manifest: ASRManifest, name: string, progress: (bytes: number) => void,
): Promise<ArrayBuffer> {
  const file = manifest.files.find(item => item.file === name);
  if (!file || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 100_000_000) throw new Error('语音资源清单无效。');
  const parts = file.parts || [file];
  if (parts.reduce((sum, part) => sum + part.bytes, 0) !== file.bytes) throw new Error('语音资源分片清单无效。');
  let cache: Cache | undefined;
  try { cache = await globalThis.caches?.open('translate-lab-asr-' + manifest.revision); } catch { /* optional cache */ }
  const output = new Uint8Array(file.bytes);
  let offset = 0;
  for (const part of parts) {
    const url = new URL(part.file, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('语音资源地址无效。');
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      const saved = await cache?.match(url.href);
      if (saved) {
        const candidate = new Uint8Array(await saved.arrayBuffer());
        if (candidate.length === part.bytes && await sha256(candidate) === part.sha256) bytes = candidate;
        else await cache?.delete(url.href);
      }
    } catch { /* use the current network response */ }
    if (!bytes) {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error('语音模型下载失败（' + response.status + '）。');
      bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== part.bytes || await sha256(bytes) !== part.sha256) throw new Error('语音资源校验失败，请重新加载模型。');
      try { await cache?.put(url.href, new Response(bytes)); } catch { /* quota must not prevent recognition */ }
    }
    output.set(bytes, offset);
    offset += bytes.length;
    progress(bytes.length);
  }
  return output.buffer;
}
