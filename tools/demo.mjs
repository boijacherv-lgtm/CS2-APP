// Turns a CS2 .dem into compact per-round data for the review screen, with the native parser.
// Runs in Node (the Vite dev server, the demo-bot server). The logic lives in demo-core.mjs; the website runs
// the same logic with the parser built for the browser.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseEvent, parseEvents, parseGrenades, parseHeader, parseTicks } from '@laihoe/demoparser2';
import { buildDemoData } from './demo-core.mjs';
import { wasmParserApi } from './demo-wasm.mjs';

const native = { parseEvent, parseEvents, parseGrenades, parseHeader, parseTicks };
const require = createRequire(import.meta.url);

export function parseDemo(path) {
  try {
    return buildDemoData(native, path);
  } catch (e) {
    // the npm build can lag behind CS2 updates (newer demos fail with "MalformedMessage"); the WebAssembly build
    // in tools/demoparser-node is built from a newer parser source (.github/workflows/demoparser-wasm.yml), so
    // those demos are read with it instead (no grenade flight paths there, everything else the same)
    if (!/MalformedMessage/.test(String(e?.message ?? e))) throw e;
    const wasm = require('./demoparser-node/demoparser2.js');
    return buildDemoData(wasmParserApi(wasm), fs.readFileSync(path));
  }
}
