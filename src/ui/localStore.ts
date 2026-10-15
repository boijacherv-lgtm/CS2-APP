/**
 * Small key-value store in this browser (IndexedDB): the CS2 replays folder you connected and the demos read from it
 * (gzipped JSON, ~0.6 MB a match). Nothing leaves the browser. Every call fails soft (private mode, blocked storage).
 */
const DB = 'stratboard';
const STORE = 'kv';

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(d => new Promise<T>((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }));
}

export const getItem = <T>(key: string) => run<T | undefined>('readonly', s => s.get(key)).catch(() => undefined);
export const setItem = (key: string, value: unknown) => run('readwrite', s => s.put(value, key)).catch(() => undefined);
export const delItem = (key: string) => run('readwrite', s => s.delete(key)).catch(() => undefined);

/** JSON → gzipped Blob (browser CompressionStream). */
export async function gzipJson(value: unknown): Promise<Blob> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}
export async function gunzipJson<T>(blob: Blob): Promise<T> {
  return JSON.parse(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
