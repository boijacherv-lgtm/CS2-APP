import type { DemoData } from '../src/engine/recap';
export interface SteamMatch {
  /** share code, or "<source>:<id>" for non-Valve matches (FACEIT…) */
  code: string;
  outcomeId: string | null;
  source: string; // matchmaking, faceit, …
  time: number | null;
  map: string | null;
  scores: [number, number] | null; // yours first
  result: 'win' | 'loss' | 'tie' | null;
  kd: [number, number] | null;
  /** steam:// link that makes CS2 download this match's demo (Valve matchmaking only) */
  download: string | null;
  /** the demo is imported and opens instantly */
  parsed: boolean;
}
export interface SteamStatus {
  configured: { steamId: boolean; apiKey: boolean; authCode: boolean; knownCode: boolean; replays: boolean };
  steamId: string | null;
  source: 'leetify' | 'valve' | null;
  note: string | null;
  syncing: boolean;
  /** CS2 replays folders being watched */
  replays: string[];
  importing: { file: string | null; error: string | null };
  matches: SteamMatch[];
}
export const SHARE_CODE: RegExp;
export function decodeShareCode(code: string): { matchId: string; outcomeId: string; token: number };
export function downloadLink(code: string): string;
export function outcomeFromFileName(name: string): string | null;
export function resolveProfile(input: string): Promise<string>;
export function findReplayDirs(): string[];
export function saveSettings(input: { profile?: string; apiKey?: string; authCode?: string; knownCode?: string; replaysDir?: string }): Promise<SteamStatus['configured']>;
export function forget(): void;
export function sync(): Promise<{ added: number; note: string | null; source: string | null }>;
export function rememberParsed(fileName: string | null, data: DemoData): void;
export function loadParsed(outcomeId: string): DemoData;
export function status(): SteamStatus;
