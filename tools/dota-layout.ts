// Where a patch put the map's buildings, camps, Twin Gates, Lotus Pools and rune spots, read from one of its matches'
// replays: for the site's matches that have no replay to read it from. Run once after a patch that moves things.
//
//   npx vite-node tools/dota-layout.ts <match id> [the replay, if already downloaded and unpacked]
import fs from 'node:fs';
import { layoutFrom } from '../src/dota2/data';
import { readReplay } from '../src/dota2/replay/parser';
import { unpackReplay } from '../src/dota2/replay/unpack';

const OUT = 'src/dota2/generated/mapLayouts.json', API = 'https://api.opendota.com/api';
const [id, file] = process.argv.slice(2);
if (!id) throw new Error('Give a match ID played on the patch.');
const match = await (await fetch(`${API}/matches/${id}`)).json() as { patch: number; start_time: number; replay_url?: string };
const patches = await (await fetch(`${API}/constants/patch`)).json() as { id: number; name: string; date: string }[];
const patch = patches.find(p => p.id === match.patch);
if (!patch) throw new Error(`OpenDota doesn't know patch ${match.patch}.`);

let raw: Uint8Array;
if (file) raw = new Uint8Array(fs.readFileSync(file));
else {
  if (!match.replay_url) throw new Error('This match has no replay.');
  console.log(`downloading ${match.replay_url}`);
  raw = unpackReplay(new Uint8Array(await (await fetch(match.replay_url)).arrayBuffer()));
}
const layout = layoutFrom(readReplay(raw).fixtures ?? []);
if (!layout) throw new Error("The replay didn't show enough of the map.");

const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) as { patches: Record<string, { name: string; from: number; layout: unknown }> } : { patches: {} };
all.patches[match.patch] = { name: patch.name, from: Math.round(Date.parse(patch.date) / 1000), layout };
fs.writeFileSync(OUT, `${JSON.stringify(all)}\n`);
console.log(`patch ${patch.name}: ${layout.camps.length} camps, ${layout.gates.length} gates, buildings ${Object.keys(layout.buildings[0]).length}+${Object.keys(layout.buildings[1]).length}`);
