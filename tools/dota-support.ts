// Learns what pro supports normally do, so the site's support grades compare with them rather than with guessed numbers:
// reads recent parsed pro matches from OpenDota and writes 21 quantiles of each number to generated/supportNorms.json.
// It's the Dota counterpart of CS2's `npm run train:coach`, without needing any replay files. More matches, steadier norms.
//
//   npx vite-node tools/dota-support.ts [matches=150]
import fs from 'node:fs';
import { matchFromOpenDota, type RawMatch } from '../src/dota2/match';
import { supportNumbers, supportsOf, type SupportKey } from '../src/dota2/support';

const OUT = 'src/dota2/generated/supportNorms.json', API = 'https://api.opendota.com/api', PAUSE = 1100;
const WANTED = Number(process.argv[2] ?? 150), MIN_MINUTES = 20;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const get = async <T>(path: string): Promise<T | null> => {
  for (let tries = 0; tries < 4; tries++) {
    const res = await fetch(`${API}${path}`).catch(() => null);
    if (res?.ok) return await res.json() as T;
    await wait(res?.status === 429 ? 30000 : 3000);
  }
  return null;
};

const samples = new Map<SupportKey, number[]>();
let used = 0, supports = 0, before: number | undefined;
while (used < WANTED) {
  const list = await get<{ match_id: number }[]>(`/proMatches${before ? `?less_than_match_id=${before}` : ''}`);
  if (!list?.length) break;
  for (const { match_id: id } of list) {
    if (used >= WANTED) break;
    before = id;
    await wait(PAUSE);
    const raw = await get<RawMatch>(`/matches/${id}`);
    if (!raw) continue;
    const m = matchFromOpenDota(raw);
    if (!m.parsed || m.duration < MIN_MINUTES * 60 || !m.wards.length) continue;
    used++;
    for (const team of [0, 1] as const) for (const slot of supportsOf(m, team)) {
      supports++;
      for (const [k, v] of Object.entries(supportNumbers(m, slot))) {
        const key = k as SupportKey;
        if (!samples.has(key)) samples.set(key, []);
        samples.get(key)!.push(v);
      }
    }
    if (used % 25 === 0) console.log(`${used} matches`);
  }
}
const round = (v: number) => Math.round(v * 1000) / 1000;
const norms = Object.fromEntries([...samples].map(([k, all]) => {
  const s = [...all].sort((a, b) => a - b);
  return [k, Array.from({ length: 21 }, (_, i) => round(s[Math.min(s.length - 1, Math.floor((i / 20) * s.length))]))];
}));
fs.writeFileSync(OUT, `${JSON.stringify({ matches: used, supports, norms })}\n`);
console.log(`${used} matches, ${supports} supports`);
for (const [k, q] of Object.entries(norms)) console.log(k.padEnd(14), 'p10', q[2], 'median', q[10], 'p90', q[18]);
