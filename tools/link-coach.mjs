// Links the coach's tools on this computer to the site, once: makes a random secret, keeps it in .env
// (STRATBOARD_SERVER_TOKEN, never committed) and gives it to the Worker (wrangler secret put SERVER_TOKEN), so the tools
// can fetch the moments you've ruled on. The secret is never printed. Run it again to make a new one.
// The demo bot uses the same secret (server/.env SERVER_TOKEN): copy it from .env when you set the bot up.
//
//   npm run link:coach
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const envFile = path.join(root, '.env');
const token = crypto.randomBytes(32).toString('hex');
const res = spawnSync('npx', ['wrangler', 'secret', 'put', 'SERVER_TOKEN'], { cwd: path.join(root, 'worker'), input: token, stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' });
if (res.status !== 0) { console.error('\nThe Worker didn\'t take it (logged in to Cloudflare? try npx wrangler login in the worker folder). Nothing changed here.'); process.exit(1); }
const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n').filter(l => !/^\s*STRATBOARD_SERVER_TOKEN\s*=/.test(l)) : [];
while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
fs.writeFileSync(envFile, [...lines, `STRATBOARD_SERVER_TOKEN=${token}`, ''].join('\n'), { mode: 0o600 });
console.log('\nLinked: the coach\'s tools on this computer can now fetch your checked moments (npm run pull:disputes).');
