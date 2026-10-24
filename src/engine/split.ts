/**
 * Is this match held out for testing? A fixed 1 in `every` matches (by a hash of its id, so the same matches every
 * run and on every computer): models never learn from them, so they can be scored honestly. `slot` picks another
 * group the same size (e.g. 1 in 10 of the rest to decide when training stops).
 */
export function isTest(id: string, every = 5, slot = 0): boolean {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % every === slot;
}
