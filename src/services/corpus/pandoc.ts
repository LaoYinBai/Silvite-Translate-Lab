// Adapted from Pandoc 3.13 wasm/pandoc.js, copyright 2025 Tweag I/O Limited
// and John MacFarlane (MIT). The Pandoc WASM itself remains GPL-2.0-or-later.
import { WASI, File as WasiFile, OpenFile, ConsoleStdout, PreopenDirectory } from '@bjorn3/browser_wasi_shim';

interface PandocExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free?(pointer: number): void;
  __wasm_call_ctors(): void;
  hs_init_with_rtsopts(argc: number, argv: number): void;
  convert(options: number, size: number): void;
}

export async function createPandoc(bytes: ArrayBuffer) {
  const files = new Map<string, WasiFile>();
  const args = ['pandoc.wasm', '+RTS', '-H32m', '-M256m', '-RTS'];
  const wasi = new WASI(args, [], [
    new OpenFile(new WasiFile(new Uint8Array(), { readonly: true })),
    ConsoleStdout.lineBuffered(() => {}), ConsoleStdout.lineBuffered(() => {}),
    new PreopenDirectory('/', files),
  ], { debug: false });
  const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi.wasiImport });
  const api = instance.exports as unknown as PandocExports;
  wasi.initialize({ exports: { ...api, memory: api.memory } });
  api.__wasm_call_ctors();
  const encoder = new TextEncoder();
  const storeString = (text: string) => {
    const data = encoder.encode(text);
    const pointer = api.malloc(data.length + 1);
    new Uint8Array(api.memory.buffer, pointer, data.length + 1).set([...data, 0]);
    return { pointer, length: data.length };
  };
  const argc = api.malloc(4), argv = api.malloc(4 * (args.length + 1)), argvPointer = api.malloc(4);
  new DataView(api.memory.buffer).setUint32(argc, args.length, true);
  for (const [index, arg] of args.entries()) {
    const value = storeString(arg);
    new DataView(api.memory.buffer).setUint32(argv + index * 4, value.pointer, true);
  }
  new DataView(api.memory.buffer).setUint32(argv + args.length * 4, 0, true);
  new DataView(api.memory.buffer).setUint32(argvPointer, argv, true);
  api.hs_init_with_rtsopts(argc, argvPointer);
  return (input: Uint8Array, kind: 'rtf' | 'docx'): { ast: unknown; warnings: string[] } => {
    files.clear();
    const filename = 'input.' + kind;
    const stdout = new WasiFile(new Uint8Array(), { readonly: false });
    const stderr = new WasiFile(new Uint8Array(), { readonly: false });
    const warnings = new WasiFile(new Uint8Array(), { readonly: false });
    files.set(filename, new WasiFile(input, { readonly: true }));
    files.set('stdout', stdout); files.set('stderr', stderr); files.set('warnings', warnings);
    files.set('stdin', new WasiFile(new Uint8Array(), { readonly: true }));
    const options = storeString(JSON.stringify({ from: kind, to: 'json', 'input-files': [filename], standalone: true }));
    try {
      api.convert(options.pointer, options.length);
      const result = new TextDecoder('utf-8', { fatal: true }).decode(stdout.data);
      if (!result) throw new Error(new TextDecoder().decode(stderr.data) || '未能解析文档结构。');
      if (result.length > 8_000_000) throw new Error('展开后的文档结构过大，请拆分文件。');
      const warningText = new TextDecoder().decode(warnings.data);
      const list = warningText ? JSON.parse(warningText) as unknown[] : [];
      return { ast: JSON.parse(result), warnings: list.map(item => JSON.stringify(item)).slice(0, 30) };
    } finally {
      api.free?.(options.pointer);
      files.clear();
    }
  };
}
