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
    // This build has no grenade projectile output (only player rows), so there are no flight paths: grenades still
    // show where and when they popped, from the detonation events. Skipping it also saves a full pass.
    parseGrenades: () => [],
  };
}
