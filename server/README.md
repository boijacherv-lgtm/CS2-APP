# Stratboard server (demo bot)

Makes **all your matches appear by themselves** on https://tsakhstvo.xyz: for every logged-in user, it finds their new
matches (through the Cloudflare Worker), gets each demo with a **bot Steam account**, downloads, reads and **grades** it,
and sends the result to the Worker. A few minutes after a match is played it's on the user's **Profile** (numbers, trends,
goals) and ready in **Review**.

**Status: not hosted yet.** Until it runs somewhere, add matches with **Profile → Add matches** (or one at a time in Review).

- Needs an **always-on machine** with Node.js 20+ and about 3 GB of RAM (the native demo parser peaks near 2.9 GB).
- **Only outgoing connections:** no open ports, no domain, no HTTPS setup.
- The bot is its **own Steam account**, never yours or a visitor's. If Steam ever objects to the bot, only that account is
  affected.
- Each demo is parsed once and kept (about 0.6 MB per match); teammates who also use the site get it without re-parsing.

## Setup (Windows PC, PowerShell)

The same steps work on macOS / Linux (use `openssl rand -hex 32` for the token and any text editor for `.env`).

1. **Bot Steam account:** a new, free Steam account with **Counter-Strike 2** in its library (spending $5 on it makes it
   a non-limited account, which CS2 answers more reliably). Never use your own account. Keep its password to yourself.
2. **Code and tools:** Node.js 20+ installed. In the repo folder (the one with `package.json`):
   ```powershell
   git pull
   npm install
   cd server
   npm ci --omit=dev
   ```
   `npm install` in the repo installs the app's tools too (not `npm ci`: the demo reader lists builds for other systems that were never published, and newer npm versions refuse `npm ci` over them): the bot uses them to grade each match for profiles.
3. **A shared secret:** make one and keep the output:
   ```powershell
   [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
   ```
   Give it to the Worker (in the repo's `worker` folder; paste it when asked):
   ```powershell
   npx wrangler secret put SERVER_TOKEN
   npx wrangler deploy
   ```
4. **`server\.env`** (never committed): `notepad server\.env`, then:
   ```
   WORKER_URL=https://stratboard-api.stratboard.workers.dev
   SERVER_TOKEN=<the secret from step 3>
   ```
5. **Log in the bot (once):** in `server`, `npm run login`, then type the **bot's** login, password and Steam Guard code.
   Only Steam's login token is saved (`server\data\bot-token`).
6. **Try one round:** `npm run once`. It should list the site's users and handle their new matches
   (`✓ on their profile`, `✓ ready`).
7. **Run:** `npm start` and leave the window open. To start it with Windows: Task Scheduler → Create Basic Task →
   "When I log on" → Start a program: `node`, arguments `src\main.mjs`, start in: the `server` folder.

Each user (you too) pastes their **authentication code** and one **match share code** once on the website (Review → Your
matches); that's how the Worker finds their new matches.

## How it works

Every 5 minutes (`CYCLE_MINUTES` in `server/.env`):
1. `GET /internal/users` from the Worker, then for each user `POST /internal/sync/<steamId>` (Valve's match history) and
   `GET /internal/pending/<steamId>`.
2. For each new match: the bot asks CS2's game coordinator for the demo link (`src/bot.mjs`), the demo is downloaded and
   parsed with the app's own parser (`src/process.mjs` → `tools/demo.mjs`), gzipped and sent with
   `PUT /internal/demo/<outcomeId>`; the player's map / score / K/D go with `POST /internal/result/<steamId>`.
3. The match is graded once by the coach (`tools/grade-profile.ts`, about 20–60 s; every player's entry kept in
   `data/graded/`), and the user's entry goes to their profile with `POST /internal/profile/<steamId>`.
4. The website shows it; **Review** loads `GET /demo/<outcomeId>` from the Worker.

All `/internal/*` calls carry `SERVER_TOKEN`; without it the Worker refuses them.

## Troubleshooting

| Log says | Fix |
|---|---|
| `The bot is not logged in yet` | step 4 |
| `the saved login is no longer valid` | step 4 again, then restart |
| `Worker /users: 403` | the Worker's SERVER_TOKEN doesn't match `server/.env`: `npx wrangler secret put SERVER_TOKEN` with the value from `server/.env` |
| `CS2 did not answer about this match` (every time) | Steam sometimes ignores brand-new or limited bot accounts; try again later, or make the bot account non-limited |
| `gone: The demo has expired` | normal for matches older than about a month |
| `matches are added, but not to profiles` | the repo was installed with `--omit=dev`: run `npm install` in the repo folder |
| `! profile: grading failed` | the match is still in Review; run `git pull` and `npm install` (the app changed), then restart |
