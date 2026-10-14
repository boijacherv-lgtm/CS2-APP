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

export default defineConfig({
  plugins: [react(), demoApi()],
  server: { port: 5173, open: false },
});
