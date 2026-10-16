import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({
  plugins: [react(), demoApi(), steamApi()],
  // the Steam cache (match list, downloaded demos) changes while the server runs; don't watch it
  server: { port: 5173, open: false, watch: { ignored: ['**/.steam-cache/**'] } },
});
