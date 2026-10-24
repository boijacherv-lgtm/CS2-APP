/// <reference lib="webworker" />
/**
 * Reads a .dem in the browser (website), off the main thread: the WebAssembly build of LaihoE/demoparser
 * (public/demoparser/, built by .github/workflows/demoparser-wasm.yml) + the same demo logic the desktop
 * app and the server use (tools/demo-core.mjs). Nothing is uploaded.
 */
import { buildDemoData } from '../../tools/demo-core.mjs';
import { wasmParserApi } from '../../tools/demo-wasm.mjs';
import { BUILD } from '../env';

export type DemoWorkerIn = { file: File };
export type DemoWorkerOut = { progress: number } | { data: unknown } | { error: string };

type WasmModule = Record<string, unknown> & { default: (wasmUrl: string) => Promise<unknown> };
let loaded: Promise<WasmModule> | null = null;
function loadParser(): Promise<WasmModule> {
  loaded ??= (async () => {
    const base = `${self.location.origin}/demoparser/`;
    // the build's commit on the URL: a browser that cached an older parser (e.g. one without grenade flights) gets
    // the new one after every deploy
    const v = `?v=${BUILD.commit}`;
    const mod = (await import(/* @vite-ignore */ `${base}demoparser2.js${v}`)) as WasmModule;
    await mod.default(`${base}demoparser2_bg.wasm${v}`);
    return mod;
  })();
  return loaded;
}

self.onmessage = async (e: MessageEvent<DemoWorkerIn>) => {
  const post = (m: DemoWorkerOut) => (self as unknown as Worker).postMessage(m);
  try {
    const bytes = new Uint8Array(await e.data.file.arrayBuffer());
    const api = wasmParserApi(await loadParser());
    const data = buildDemoData(api, bytes, pass => post({ progress: pass }));
    post({ data });
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) });
  }
};
