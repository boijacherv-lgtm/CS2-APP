import type { DemoData } from '../src/engine/recap';
export interface SteamMatch {
  /** share code, or "<source>:<id>" for non-Valve matches (FACEIT…) */
  code: string;
  outcomeId: string | null;
  source: string; // matchmaking, faceit, …
  time: number | null;
  /** for demos only known from being loaded: when they were imported */
  loadedAt: number | null;
  /** Valve's API gives no match date: when the app first saw this match */
  foundAt: number | null;
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
  source: 'valve' | null;
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
export function extractFromText(text: string): { authCode: string | null; apiKey: string | null; codes: string[] };
export function saveSettings(input: { profile?: string; apiKey?: string; authCode?: string; knownCode?: string; replaysDir?: string; paste?: string }): Promise<SteamStatus['configured'] & { found?: { authCode: boolean; apiKey: boolean; codes: number } }>;
export function forget(): void;
export function sync(): Promise<{ added: number; note: string | null; source: string | null }>;
export function rememberParsed(fileName: string | null, data: DemoData): void;
export function loadParsed(outcomeId: string): DemoData;
export function status(): SteamStatus;
export function openIdStartUrl(origin: string, back?: string): string;
export function safeBack(back: string | undefined): string;
export function signOut(): void;
export function me(): Promise<{ steamId: string; name: string | null; avatar: string | null } | null>;
export function openIdVerify(origin: string, query: string): Promise<string>;
