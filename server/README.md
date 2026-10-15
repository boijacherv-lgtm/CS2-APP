# Stratboard server (demo bot)

Makes **all your matches appear by themselves** on https://tsakhstvo.xyz: for every logged-in user, it finds their new
matches (through the Cloudflare Worker), gets each demo with a **bot Steam account**, downloads and reads it, and sends the
result to the Worker. On the website the match then shows map, score, K/D and **Review** a few minutes after it's played.

**Status: not hosted yet.** Until it runs somewhere, use **Download in CS2** + **Your CS2 demo folder** on the website.

- Needs an **always-on machine** with Node.js 20+ and about 3 GB of RAM (the native demo parser peaks near 2.9 GB).
- **Only outgoing connections:** no open ports, no domain, no HTTPS setup.
- The bot is its **own Steam account**, never yours or a visitor's. If Steam ever objects to the bot, only that account is
  affected.
- Each demo is parsed once and kept (about 0.6 MB per match); teammates who also use the site get it without re-parsing.

## Setup

1. **Bot Steam account:** a new, free Steam account with **Counter-Strike 2** in its library. Keep its password to yourself.
2. **Code:** on the machine, clone the repo, then in it run `npm ci --omit=dev` and `cd server && npm ci --omit=dev`.
3. **`server/.env`** (never committed):
   ```
   WORKER_URL=https://stratboard-api.stratboard.workers.dev
   SERVER_TOKEN=<a long random string, e.g. from: openssl rand -hex 32>
   ```
   Give the Worker the same token: in `cs2-tactics/worker`, `npx wrangler secret put SERVER_TOKEN` and paste it at the prompt.
4. **Log in the bot (once):** `cd server && npm run login`, then type the **bot's** login, password and Steam Guard code.
   Only Steam's login token is saved (`server/data/bot-token`).
5. **Run:** `npm start` (keeps running; `npm run once` does one round and exits). Keep it running with whatever the machine
   offers (a service, pm2, a scheduled task…).

## How it works

Every 5 minutes (`CYCLE_MINUTES` in `server/.env`):
1. `GET /internal/users` from the Worker, then for each user `POST /internal/sync/<steamId>` (Valve's match history) and
   `GET /internal/pending/<steamId>`.
2. For each new match: the bot asks CS2's game coordinator for the demo link (`src/bot.mjs`), the demo is downloaded and
   parsed with the app's own parser (`src/process.mjs` → `tools/demo.mjs`), gzipped and sent with
   `PUT /internal/demo/<outcomeId>`; the player's map / score / K/D go with `POST /internal/result/<steamId>`.
3. The website shows it; **Review** loads `GET /demo/<outcomeId>` from the Worker.

All `/internal/*` calls carry `SERVER_TOKEN`; without it the Worker refuses them.

## Troubleshooting

| Log says | Fix |
|---|---|
| `The bot is not logged in yet` | step 4 |
| `the saved login is no longer valid` | step 4 again, then restart |
| `Worker /users: 403` | the Worker's SERVER_TOKEN doesn't match `server/.env`: `npx wrangler secret put SERVER_TOKEN` with the value from `server/.env` |
| `CS2 did not answer about this match` (every time) | Steam sometimes ignores brand-new or limited bot accounts; try again later, or make the bot account non-limited |
| `gone: The demo has expired` | normal for matches older than about a month |
