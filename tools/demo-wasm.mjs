// Adapts the WebAssembly build of LaihoE/demoparser (public/demoparser/, tools/demoparser-node/) to the same
// interface as the native parser, for tools/demo-core.mjs. The WebAssembly build returns key-value data as
// JavaScript Maps; the native one as plain objects.

/** Maps → plain objects, all the way down. */
const plain = x => (x instanceof Map ? Object.fromEntries([...x].map(([k, v]) => [k, plain(v)])) : Array.isArray(x) ? x.map(plain) : x);

export function wasmParserApi(w) {
  return {
    parseHeader: input => plain(w.parseHeader(input)),
    parseEvent: (input, name, playerProps = [], otherProps = []) => plain(w.parseEvent(input, name, playerProps, otherProps)),
    parseEvents: (input, names, playerProps = [], otherProps = []) => plain(w.parseEvents(input, names, playerProps, otherProps)),
    parseTicks: (input, props, ticks) => plain(w.parseTicks(input, props, ticks ? Int32Array.from(ticks) : undefined, false)),
    // Grenade flights (paths, bounces) come from builds that read the projectiles (hasProjectiles, added by
    // .github/workflows/demoparser-wasm.yml). Older builds return only player rows: skipped, which saves a full pass,
    // and grenades still show where and when they popped from the detonation events.
    parseGrenades: input => {
      if (typeof w.hasProjectiles !== 'function') return [];
      const out = [];
      for (const r of w.parseGrenades(input)) if ((r instanceof Map ? r.get('x') : r.x) != null) out.push(plain(r));
      return out;
    },
  };
}
