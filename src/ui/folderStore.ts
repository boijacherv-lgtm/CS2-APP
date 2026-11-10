import { create } from 'zustand';

/** One demo in your CS2 folder (DemoFolder), as "Your matches" (SteamMatches) shows it in the one combined list. */
export interface FolderRow {
  name: string; modified: number;
  /** Valve matchmaking demos are named match730_<outcome id>_…: the same match the bot fetched */
  outcomeId: string | null;
  map: string | null; score: [number, number] | null; result: 'win' | 'loss' | 'tie' | null; kd: [number, number] | null; rounds: number | null;
  state: 'read' | 'reading' | 'failed' | 'unread'; error?: string;
  open(): void; read(): void;
}
/** `merged`: "Your matches" is on screen and lists these rows itself (the folder card then shows no table of its own). */
export const useFolder = create<{ rows: FolderRow[]; merged: boolean }>(() => ({ rows: [], merged: false }));
