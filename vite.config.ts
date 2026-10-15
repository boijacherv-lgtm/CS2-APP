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
        const tmp = path.join(os.tmpdir(), `cs2-demo-${Date.now()}.dem`);
        const out = fs.createWriteStream(tmp);
        req.pipe(out);
        out.on('finish', async () => {
          try {
            const { parseDemo } = await import('./tools/demo.mjs');
            const t0 = Date.now();
            const data = parseDemo(tmp);
            server.config.logger.info(`[demo] ${data.map}: ${data.rounds.length} rounds parsed in ${Date.now() - t0} ms`);
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

/** Your matches from Steam (tools/steam.mjs): sign-in (QR / password + Steam Guard), match history, load a match. */
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
          if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
          const body = await readJson(req);
          if (route === '/sync') return send(res, 200, await steam.sync());
          if (route === '/login/qr') { await steam.startQr(); return send(res, 200, { ok: true }); }
          if (route === '/login/password') {
            // a password over plain HTTP from another device would cross the network unencrypted
            if (!isLocal(req)) return send(res, 403, { error: 'Password sign-in only works on this computer. Use the QR code from other devices.' });
            await steam.startPassword(String(body.user ?? ''), String(body.pass ?? ''));
            return send(res, 200, { ok: true });
          }
          if (route === '/guard') { await steam.submitGuard(String(body.code ?? '')); return send(res, 200, { ok: true }); }
          if (route === '/cancel') { steam.cancelLogin(); return send(res, 200, { ok: true }); }
          if (route === '/signout') { steam.signOut(); return send(res, 200, { ok: true }); }
          if (route === '/load') {
            const t0 = Date.now();
            const data = await steam.loadMatch(String(body.id ?? ''));
            server.config.logger.info(`[steam] ${data.map}: ${data.rounds.length} rounds ready in ${Date.now() - t0} ms`);
            return send(res, 200, data);
          }
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
