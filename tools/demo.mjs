// Turns a CS2 .dem into compact per-round data for the review screen, with the native parser.
// Runs in Node (the Vite dev server, the demo-bot server). The logic lives in demo-core.mjs; the website runs
// the same logic with the parser built for the browser.
import { parseEvent, parseEvents, parseGrenades, parseHeader, parseTicks } from '@laihoe/demoparser2';
import { buildDemoData } from './demo-core.mjs';

const native = { parseEvent, parseEvents, parseGrenades, parseHeader, parseTicks };

export function parseDemo(path) {
  return buildDemoData(native, path);
}
