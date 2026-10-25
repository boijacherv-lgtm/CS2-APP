// Fetches the disputed moments you've ruled on (Dev → Disputes) from the Worker, each with its round, into the
// my-demos folder as disputes-live.json: the coach's tests (verdicts-lib.ts) read it like a downloaded file. The link
// is the shared secret in .env (STRATBOARD_SERVER_TOKEN, set up once with npm run link:coach).
import fs from 'node:fs';
import path from 'node:path';

const WORKER = 'https://stratboard-api.stratboard.workers.dev';
function envOf(): Record<string, string> {
  const p = path.resolve(import.meta.dirname, '../.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/** Writes <dir>/disputes-live.json; says what it did (or why it couldn't) and never throws. */
export async function pullDisputes(dir: string): Promise<string> {
  const env = { ...envOf(), ...process.env };
  const token = env.STRATBOARD_SERVER_TOKEN;
  if (!token) return 'Checked moments: not linked to the site yet (npm run link:coach), using the files in the folder.';
  const url = env.STRATBOARD_WORKER_URL ?? WORKER;
  const get = (p: string) => fetch(url + p, { headers: { Authorization: `Bearer ${token}` } });
  try {
    const res = await get('/internal/disputes');
    if (!res.ok) return `Checked moments: the site said ${res.status}${res.status === 403 ? ' (the link doesn\'t match: run npm run link:coach again)' : ''}; using the files in the folder.`;
    const { clips } = (await res.json()) as { clips: { id: string; verdict: unknown; card: unknown; ruling: unknown }[] };
    const moments = [];
    for (const c of clips) {
      const r = await get(`/internal/clip/${c.id}`);
      if (r.ok) moments.push({ verdict: c.verdict, card: c.card, ruling: c.ruling, demo: await r.json() });
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'disputes-live.json'), JSON.stringify({ at: new Date().toISOString(), moments }));
    return `Checked moments: ${moments.length} fetched from the site.`;
  } catch (e) {
    return `Checked moments: couldn't reach the site (${e instanceof Error ? e.message : String(e)}); using the files in the folder.`;
  }
}
