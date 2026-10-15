import type { DemoData } from '../src/engine/recap';
export interface SteamMatch {
  id: string;
  mode: string;
  map: string | null;
  mapName: string | null;
  time: number | null;
  duration: string | null;
  scores: number[];
  result: 'win' | 'loss' | 'tie' | null;
  hasDemo: boolean;
  demo: 'ready' | 'expired' | null;
  error: string | null;
}
export interface SteamStatus {
  account: { steamId: string; name: string | null } | null;
  login: {
    state: 'idle' | 'qr' | 'scanned' | 'guard' | 'error';
    qr: string | null; // data: URL of the QR image
    guard: { code: string | null; approve: boolean } | null;
    error: string | null;
  };
  syncing: boolean;
  matches: SteamMatch[];
}
export function status(): SteamStatus;
export function sync(): Promise<{ found: number; diag: string[]; matches: SteamMatch[] }>;
export function startQr(): Promise<void>;
export function startPassword(user: string, pass: string): Promise<void>;
export function submitGuard(code: string): Promise<void>;
export function cancelLogin(): void;
export function signOut(): void;
export function loadMatch(id: string): Promise<DemoData>;
export function parseMatches(html: string, mode: string, steamId: string): Omit<SteamMatch, 'hasDemo' | 'demo' | 'error'>[] & { url: string | null }[];
