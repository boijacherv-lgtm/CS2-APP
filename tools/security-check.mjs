// The website's security check: run it now and then to see where things stand.
//
//   npm run security            static checks + gentle live checks (about 40 requests to your own site and Worker)
//   npm run security -- --rate  also checks the Worker's rate limit (about 70 quick requests to the login check)
//   npm run security -- --offline   static checks only
//
// Writes a dated report to security/reports/ (git-ignored) and exits 1 when something fails.
// Only ever talks to the site's own addresses (SITE, WORKER, BOT below); never to Steam, deadlock-api or anyone else.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://tsakhstvo.xyz';
const WORKER = process.env.WORKER_URL || 'https://stratboard-api.stratboard.workers.dev';
const BOT = process.env.DL_BOT_URL || 'https://rageview-dl-bot.fly.dev';
const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline'), RATE = args.includes('--rate');

const results = [];
const add = (area, name, status, detail = '') => { results.push({ area, name, status, detail }); };
const pass = (a, n, d) => add(a, n, 'PASS', d), fail = (a, n, d) => add(a, n, 'FAIL', d), warn = (a, n, d) => add(a, n, 'WARN', d), info = (a, n, d) => add(a, n, 'INFO', d);
const sh = (cmd, cwd = ROOT) => { try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch (e) { return e.stdout?.toString() ?? ''; } };
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };

// ---- static: dependencies, secrets, the guards in the code --------------------------------------------------------
for (const [dir, label] of [['.', 'website'], ['worker', 'Worker'], ['server', 'bot server']]) {
  if (!fs.existsSync(path.join(ROOT, dir, 'node_modules'))) { warn('Dependencies', `${label}: npm audit`, 'node_modules missing: run npm install there first'); continue; }
  const out = sh('npm audit --omit=dev --json', path.join(ROOT, dir));
  try {
    const v = JSON.parse(out).metadata.vulnerabilities;
    const bad = v.critical + v.high, all = v.total;
    (bad ? fail : all ? warn : pass)('Dependencies', `${label}: known vulnerabilities`, all ? `${v.critical} critical, ${v.high} high, ${v.moderate} moderate, ${v.low} low (npm audit in ${dir})` : 'none');
  } catch { warn('Dependencies', `${label}: npm audit`, 'could not read npm audit output (offline?)'); }
}

const SECRET = /(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9]{32,}|xox[bap]-[A-Za-z0-9-]{10,}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|STEAM_API_KEY\s*=\s*[A-F0-9]{32}|SERVER_TOKEN\s*=\s*[A-Za-z0-9]{24,})/;
const tracked = sh('git ls-files').split('\n').filter(Boolean);
const secretFiles = tracked.filter(f => /(^|\/)\.env($|\.)|bot-token|\.pem$|id_(rsa|ed25519)$/.test(f));
secretFiles.length ? fail('Secrets', 'secret files committed', secretFiles.join(', ')) : pass('Secrets', 'no secret files committed', `${tracked.length} tracked files`);
const hits = sh(`git grep -nIE "${SECRET.source.replace(/"/g, '\\"')}" -- . ":!package-lock.json" ":!*/package-lock.json"`).trim();
hits ? fail('Secrets', 'keys in the code', hits.split('\n').slice(0, 5).join(' | ')) : pass('Secrets', 'no keys in the code');
const histHits = sh(`git log --all -p --no-color -G "${SECRET.source.replace(/"/g, '\\"')}"`).split('\n').filter(l => l.startsWith('+') && SECRET.test(l));
histHits.length ? fail('Secrets', 'keys in git history', `${histHits.length} added line(s), e.g. ${histHits[0].slice(0, 80)}`) : pass('Secrets', 'no keys in git history');

const guard = (name, ok, where) => (ok ? pass : fail)('Code guards', name, where);
guard('login CSRF check (login state)', /STATE_KEY/.test(read('src/ui/steamApi.ts')) && /q\.get\('state'\) !== want/.test(read('src/ui/steamApi.ts')), 'src/ui/steamApi.ts');
guard('content security policy in the build', /script-src 'self'/.test(read('vite.config.ts')) && /securityHeaders\(\)/.test(read('vite.config.ts')), 'vite.config.ts');
guard('frame guard (clickjacking)', /window\.top !== window\.self/.test(read('src/main.tsx')), 'src/main.tsx');
guard('Worker rate limits configured', /\[\[ratelimits\]\][\s\S]*RATE_PUBLIC[\s\S]*RATE_USER/.test(read('worker/wrangler.toml')), 'worker/wrangler.toml');
guard('Worker checks Steam logins with Steam', /check_authentication/.test(read('worker/src/index.ts')), 'worker/src/index.ts verifyLogin');
guard('server token compared in constant time', /function sameToken/.test(read('worker/src/index.ts')), 'worker/src/index.ts');
const sinks = sh('git grep -nE "dangerouslySetInnerHTML|\\.innerHTML\\s*=|document\\.write\\(|new Function\\(|[^.]eval\\(" -- src').trim();
sinks ? warn('Code guards', 'HTML / code injection sinks', sinks.split('\n').slice(0, 5).join(' | ')) : pass('Code guards', 'no HTML / code injection sinks in the website');

// ---- live: the website ------------------------------------------------------------------------------------------
async function req(url, init = {}) {
  try { const r = await fetch(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(15000) }); return { status: r.status, headers: r.headers, text: await r.text().catch(() => '') }; } catch (e) { return { status: 0, headers: new Headers(), text: String(e) }; }
}
if (!OFFLINE) {
  const home = await req(SITE + '/');
  home.status === 200 ? pass('Website', 'site answers over HTTPS', SITE) : fail('Website', 'site answers over HTTPS', `status ${home.status}`);
  const hsts = home.headers.get('strict-transport-security');
  hsts ? pass('Website', 'HSTS header', hsts) : fail('Website', 'HSTS header', 'missing');
  const plain = await req(SITE.replace('https:', 'http:') + '/');
  [301, 302, 307, 308].includes(plain.status) && /^https:/.test(plain.headers.get('location') ?? '') ? pass('Website', 'http redirects to https') : fail('Website', 'http redirects to https', `status ${plain.status}`);
  const csp = home.text.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  !csp ? fail('Website', 'content security policy', 'no CSP <meta> in the live page (not deployed yet?)')
    : /script-src[^;]*'unsafe-inline'|script-src[^;]*'unsafe-eval'/.test(csp) ? warn('Website', 'content security policy', `allows inline / eval scripts: ${csp}`)
      : pass('Website', 'content security policy', 'scripts only from the site');
  /name="referrer" content="(strict-origin|no-referrer|same-origin)/.test(home.text) ? pass('Website', 'referrer policy') : warn('Website', 'referrer policy', 'no referrer <meta>');
  const scripts = [...home.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]).filter(s => /^https?:/.test(s) && !s.startsWith(SITE));
  scripts.length ? warn('Website', 'third-party scripts', scripts.join(', ')) : pass('Website', 'no third-party scripts');

  // ---- live: the Worker ---------------------------------------------------------------------------------------------
  const W = WORKER;
  for (const [name, origin] of [['other website', 'https://evil.example'], ['null origin', 'null'], ['lookalike domain', 'https://tsakhstvo.xyz.evil.example']]) {
    const r = await req(`${W}/me`, { headers: { Origin: origin } });
    r.status === 403 && !r.headers.get('access-control-allow-origin') ? pass('Worker', `CORS refuses ${name}`) : fail('Worker', `CORS refuses ${name}`, `status ${r.status}, allow-origin ${r.headers.get('access-control-allow-origin')}`);
  }
  const ok = await req(`${W}/me`, { headers: { Origin: SITE } });
  ok.status === 200 && ok.headers.get('access-control-allow-origin') === SITE ? pass('Worker', 'CORS allows the website') : fail('Worker', 'CORS allows the website', `status ${ok.status}`);
  for (const p of ['/status', '/profile', '/admin/stats', '/admin/clips', '/resolve?q=x', '/demo/12345678901']) {
    const r = await req(W + p);
    r.status === 401 ? pass('Worker', `login required: ${p}`) : fail('Worker', `login required: ${p}`, `status ${r.status}`);
  }
  const fake = await req(`${W}/status`, { headers: { Authorization: `Bearer ${'a'.repeat(64)}` } });
  fake.status === 401 ? pass('Worker', 'made-up session token refused') : fail('Worker', 'made-up session token refused', `status ${fake.status}`);
  for (const [name, h] of [['no token', {}], ['wrong token', { Authorization: 'Bearer wrong-token-0000000000' }], ['empty token', { Authorization: 'Bearer ' }]]) {
    const r = await req(`${W}/internal/users`, { headers: h });
    r.status === 403 ? pass('Worker', `internal API refuses ${name}`) : fail('Worker', `internal API refuses ${name}`, `status ${r.status}`);
  }
  const id = 'https://steamcommunity.com/openid/id/76561197960287930';
  const forge = async (extra, expect) => {
    const params = { 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login', 'openid.return_to': `${SITE}/?back=%23%2F`, 'openid.claimed_id': id, 'openid.identity': id,
      'openid.response_nonce': `${new Date().toISOString().slice(0, 19)}Zsecurity-check-${Math.random().toString(36).slice(2)}`, 'openid.assoc_handle': '1234567890',
      'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=', ...extra };
    const r = await req(`${W}/openid/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SITE }, body: JSON.stringify({ params }) });
    return { refused: r.status >= 400 && !/"token"/.test(r.text) && expect.test(r.text), r };
  };
  for (const [name, extra, expect] of [
    ['forged signature', {}, /did not confirm/],
    ['answer from another provider', { 'openid.op_endpoint': 'https://evil.example/openid/login' }, /did not come from Steam/],
    ['answer meant for another site', { 'openid.return_to': 'https://tsakhstvo.xyz.evil.example/' }, /another site/],
    ['account ID swapped', { 'openid.identity': 'https://steamcommunity.com/openid/id/76561197960265729' }, /which account/],
  ]) {
    const { refused, r } = await forge(extra, expect);
    refused ? pass('Steam login', `refuses ${name}`) : fail('Steam login', `refuses ${name}`, `status ${r.status}: ${r.text.slice(0, 120)}`);
  }
  const big = await req(`${W}/openid/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'a'.repeat(30000) });
  big.status === 400 ? pass('Worker', 'oversized body refused') : fail('Worker', 'oversized body refused', `status ${big.status}`);
  const prof = await req(`${W}/profiles?ids=76561197960287930`);
  prof.status === 403 ? pass('Worker', "Steam-key look-ups only from the website", '/profiles without the site origin') : fail('Worker', "Steam-key look-ups only from the website", `/profiles from a script: status ${prof.status} (Worker fix not deployed?)`);
  const err = await req(`${W}/openid/verify`, { method: 'POST', body: '{"params":{"openid.mode":"id_res","openid.op_endpoint":"x"}}' });
  /\bat \S+:\d+|\.[tj]s:\d+|\b(TypeError|ReferenceError|SyntaxError)\b|"stack"/.test(err.text) ? warn('Worker', 'error messages', `look like internals: ${err.text.slice(0, 120)}`) : pass('Worker', 'error messages stay short', err.text.slice(0, 60));

  if (RATE) {
    let first429 = 0;
    for (let i = 1; i <= 75; i++) {
      const r = await req(`${W}/openid/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (r.status === 429) { first429 = i; break; }
    }
    first429 ? pass('Worker', 'rate limit on Steam calls', `429 after ${first429} quick requests`) : fail('Worker', 'rate limit on Steam calls', 'no 429 after 75 quick requests (Worker fix not deployed?)');
  } else info('Worker', 'rate limit', 'not tested (add --rate)');

  // ---- live: the Deadlock bot (only when it's running) ---------------------------------------------------------------
  const bot = await req(`${BOT}/health`);
  if (bot.status !== 200) info('Deadlock bot', 'not running', `${BOT} (nothing to check)`);
  else {
    const evil = await req(`${BOT}/dl/bot`, { headers: { Origin: 'https://evil.example' } });
    evil.headers.get('access-control-allow-origin') ? fail('Deadlock bot', 'CORS refuses other websites', evil.headers.get('access-control-allow-origin')) : pass('Deadlock bot', 'CORS refuses other websites');
    const refresh = await req(`${BOT}/dl/refresh/1`, { method: 'POST' });
    refresh.status === 403 ? pass('Deadlock bot', '"check now" only for its friends') : fail('Deadlock bot', '"check now" only for its friends', `status ${refresh.status}`);
  }
}

// ---- report ----------------------------------------------------------------------------------------------------
const count = s => results.filter(r => r.status === s).length;
const stamp = new Date().toISOString().replace(/:\d\d\.\d+Z$/, '').replace('T', ' ');
const icon = { PASS: 'ok  ', FAIL: 'FAIL', WARN: 'warn', INFO: 'info' };
let area = '';
for (const r of results) {
  if (r.area !== area) { area = r.area; console.log(`\n${area}`); }
  console.log(`  ${icon[r.status]}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('WARN')} warnings  ·  ${stamp} UTC`);
const dir = path.join(ROOT, 'security', 'reports');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${stamp.replace(/[: ]/g, '-')}.md`);
fs.writeFileSync(file, [
  `# Security check ${stamp} UTC`, '',
  `${count('PASS')} passed · ${count('FAIL')} failed · ${count('WARN')} warnings · ${OFFLINE ? 'static only' : `live: ${SITE}, ${WORKER}`}${RATE ? ', rate limit tested' : ''}`, '',
  '| Area | Check | Result | Detail |', '|---|---|---|---|',
  ...results.map(r => `| ${r.area} | ${r.name} | ${r.status} | ${r.detail.replace(/\|/g, '\\|')} |`), '',
].join('\n'));
console.log(`Report: ${path.relative(ROOT, file)}`);
process.exit(count('FAIL') ? 1 : 0);
