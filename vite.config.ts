/// <reference types="vitest" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { dotaDataUrl } from './src/dota2/dataFeed';

/** POST a .dem to /api/demo → parsed rounds as JSON. Local only; the file never leaves this machine. */
function demoApi(): Plugin {
  return {
    name: 'demo-api',
    configureServer(server) {
      server.middlewares.use('/api/demo', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        const fileName = new URL(req.url ?? '/', 'http://x').searchParams.get('name');
        const tmp = path.join(os.tmpdir(), `cs2-demo-${Date.now()}.dem`);
        const out = fs.createWriteStream(tmp);
        req.pipe(out);
        out.on('finish', async () => {
          try {
            const { parseDemo } = await import('./tools/demo.mjs');
            const t0 = Date.now();
            const data = parseDemo(tmp);
            server.config.logger.info(`[demo] ${data.map}: ${data.rounds.length} rounds parsed in ${Date.now() - t0} ms`);
            // a Valve matchmaking demo (match730_<outcome id>_…) is kept so the Steam match list can reopen it
            (await import('./tools/steam.mjs')).rememberParsed(fileName, data);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          } finally {
            fs.rm(tmp, { force: true }, () => {});
          }
        });
      });
    },
  };
}

/** Your matches (tools/steam.mjs): Log in with Steam (OpenID) + Valve's match-history API; the app never signs in to Steam. */
function steamApi(): Plugin {
  const send = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const readJson = (req: import('node:http').IncomingMessage) => new Promise<Record<string, unknown>>(resolve => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
  const isLocal = (req: import('node:http').IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
  return {
    name: 'steam-api',
    configureServer(server) {
      server.middlewares.use('/api/steam', async (req, res) => {
        try {
          const steam = await import('./tools/steam.mjs');
          const route = (req.url ?? '/').split('?')[0];
          if (req.method === 'GET' && route === '/status') return send(res, 200, steam.status());
          if (req.method === 'GET' && route === '/me') return send(res, 200, { me: await steam.me() });
          if (req.method === 'GET' && route === '/profiles') return send(res, 200, { profiles: await steam.profiles(new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('ids')) });
          // "Sign in through Steam" (OpenID): Steam's own login page, back here with a signed SteamID
          if (req.method === 'GET' && route.startsWith('/openid/')) {
            const host = req.headers.host ?? '';
            if (!/^[\w.-]+(:\d+)?$|^\[[\da-f:]+\](:\d+)?$/i.test(host)) return send(res, 400, { error: 'bad host' });
            const origin = `http://${host}`;
            const redirect = (to: string) => { res.statusCode = 302; res.setHeader('Location', to); res.end(); };
            const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
            const back = steam.safeBack(query.get('back') ?? undefined);
            if (route === '/openid/start') return redirect(steam.openIdStartUrl(origin, back));
            if (route === '/openid/return') {
              try { await steam.openIdVerify(origin, (req.url ?? '').split('?')[1] ?? ''); return redirect(`/${back}`); }
              catch (e) { return redirect(`/#/cs2/review?steam_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`); }
            }
          }
          if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
          const body = await readJson(req);
          if (route === '/settings') {
            // a profile link isn't secret; the Web API key, auth code and folder are only accepted from this
            // computer (they'd cross the LAN as plain HTTP)
            const secret = ['apiKey', 'authCode', 'knownCode', 'replaysDir', 'paste'].some(k => body[k]);
            if (secret && !isLocal(req)) return send(res, 403, { error: 'These settings can only be changed on the computer running the app.' });
            return send(res, 200, await steam.saveSettings(body));
          }
          if (route === '/forget') { if (!isLocal(req)) return send(res, 403, { error: 'Only on this computer.' }); steam.forget(); return send(res, 200, { ok: true }); }
          if (route === '/signout') { steam.signOut(); return send(res, 200, { ok: true }); }
          if (route === '/sync') return send(res, 200, await steam.sync());
          if (route === '/load') return send(res, 200, steam.loadParsed(String(body.outcomeId ?? '')));
          return send(res, 404, { error: 'unknown endpoint' });
        } catch (e) {
          return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}

/**
 * The website's security policy (online builds only: dev needs inline scripts and its own websocket). GitHub Pages
 * can't send headers, so it goes in <meta> tags: scripts only from the site itself (plus WebAssembly for the demo
 * reader), no plugins, no <base> tricks, forms only to the site or Steam's login, and links don't leak the page
 * address to other sites. Framing is stopped in main.tsx (a <meta> policy can't do that).
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://steamcommunity.com",
].join('; ');
function securityHeaders(): Plugin {
  return {
    name: 'security-headers',
    apply: 'build',
    transformIndexHtml(html) {
      if (process.env.VITE_ONLINE !== '1') return html;
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />`);
    },
  };
}

/** A Dota 2 replay from Valve's server, which doesn't let web pages read it. Valve's replay addresses only. */
function dotaReplayProxy(): Plugin {
  return {
    name: 'dota-replay-proxy',
    configureServer(server) {
      server.middlewares.use('/api/dota-replay', async (req, res) => {
        const target = new URL(req.url ?? '/', 'http://x').searchParams.get('url') ?? '';
        // China's clusters have their own domains
        if (!/^http:\/\/replay\d+\.(valve\.net|dota2\.com\.cn|wmsj\.cn)\/570\/\d+_\d+\.dem\.bz2$/.test(target)) { res.statusCode = 400; return res.end('Not a Dota 2 replay address.'); }
        try {
          // the same file is on Valve's domain too; a server that fails now and then gets a second chance there
          const up = await fetch(target).then(r => (r.ok ? r : Promise.reject(new Error(String(r.status)))))
            .catch(() => fetch(target.replace(/\.(dota2\.com\.cn|wmsj\.cn)\//, '.valve.net/')));
          res.statusCode = up.status;
          const size = up.headers.get('Content-Length');
          if (size) res.setHeader('Content-Length', size);
          if (!up.ok || !up.body) return res.end();
          for await (const part of up.body as unknown as AsyncIterable<Uint8Array>) res.write(part);
          res.end();
        } catch (e) {
          res.statusCode = 502;
          res.end(e instanceof Error ? e.message : String(e));
        }
      });
    },
  };
}

/** The game's live data from Valve (gameData.ts), cached here a few minutes. */
function dotaDataProxy(): Plugin {
  const kept = new Map<string, { at: number; body: string }>();
  return {
    name: 'dota-data-proxy',
    configureServer(server) {
      server.middlewares.use('/api/dota-data', async (req, res) => {
        const target = dotaDataUrl(new URL(req.url ?? '/', 'http://x').searchParams);
        if (!target) { res.statusCode = 400; return res.end('Not one of the game data lists.'); }
        try {
          let hit = kept.get(target);
          if (!hit || Date.now() - hit.at > 600_000) {
            const up = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!up.ok) { res.statusCode = up.status; return res.end(); }
            hit = { at: Date.now(), body: await up.text() };
            kept.set(target, hit);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(hit.body);
        } catch (e) {
          res.statusCode = 502;
          res.end(e instanceof Error ? e.message : String(e));
        }
      });
    },
  };
}

/** Which code a build is (the dev page shows it): the commit and when it was built. */
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();

export default defineConfig({
  plugins: [react(), demoApi(), steamApi(), securityHeaders(), dotaReplayProxy(), dotaDataProxy()],
  define: { __BUILD__: JSON.stringify({ commit, time: new Date().toISOString() }) },
  // the workers are module workers already; ES output lets them load data per map with import() instead of carrying it all
  worker: { format: 'es' },
  // the Steam cache (match list, downloaded demos) changes while the server runs; don't watch it
  server: { port: 5173, open: false, watch: { ignored: ['**/.steam-cache/**'] } },
  // engine tests load the coach's models (several MB) and replay rounds through the two-move search: GitHub's
  // runners are slower than a Mac, so 5 s per test was too tight there
  test: { testTimeout: 30_000 },
});
