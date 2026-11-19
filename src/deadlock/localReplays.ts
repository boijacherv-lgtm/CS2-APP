/**
 * Replay files (.dem) found on this PC this visit (the Steam folder's replays, or one opened directly), by match ID:
 * when deadlock-api has no demo for a match, it's read from here instead (localDemo.ts). Kept only while the page is
 * open: the files stay on your PC and nothing is uploaded.
 */
const files = new Map<number, Blob>();

export const addLocalReplay = (id: number, file: Blob) => { files.set(id, file); };
export const localReplay = (id: number): Blob | null => files.get(id) ?? null;
/** A replay file's match ID: Deadlock names them `<match>.dem` (any long number in the name is taken). */
export const replayId = (name: string) => (/\.dem$/i.test(name) ? Number(name.match(/(\d{6,})/)?.[1]) || 0 : 0);
