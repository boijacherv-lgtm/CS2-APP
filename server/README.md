# Stratboard server (demo bot)

Makes **all your matches appear by themselves** on https://tsakhstvo.xyz: for every logged-in user, it finds their new
matches (through the Cloudflare Worker), gets each demo with a **bot Steam account**, downloads and reads it, and sends the
result to the Worker. On the website the match shows map, score, K/D and **Review** a few minutes after it's played.

- Runs on a free **Oracle Cloud "Always Free"** VM, 24/7, as a background service that restarts itself.
- **Only outgoing connections:** no open ports, no domain, no HTTPS setup on the server.
- The bot is its **own Steam account**, never yours or a visitor's. If Steam ever objects to the bot, only that account is
  affected.
- Each demo is parsed once and kept (about 0.6 MB per match); teammates who also use the site get it without re-parsing.

## One-time setup

### 1. The bot Steam account
Make a **new, free Steam account** for the bot (its own email). Add **Counter-Strike 2** to its library (free). Keep its
password to yourself; you type it on the server in step 4, nobody else needs it.

### 2. The Oracle VM
1. Sign up at https://www.oracle.com/cloud/free/ (they verify a card but **Always Free** resources cost nothing).
2. Create an instance: **Compute → Instances → Create instance**
   - Image: **Ubuntu 24.04** (or 22.04)
   - Shape: **Ampere → VM.Standard.A1.Flex**, **2 OCPU, 12 GB memory** (Always Free allows up to 4 / 24)
   - SSH keys: **Generate a key pair**, download the private key
   - Create. If it says "out of capacity", try another availability domain or again later.
3. Note the instance's **Public IP**.

### 3. Install
From your computer (the key file is the one you downloaded):

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@YOUR_PUBLIC_IP
```

On the server:

```bash
curl -fsSL https://raw.githubusercontent.com/boijacherv-lgtm/CS2-APP/main/server/deploy/setup.sh | bash
```

It installs Node.js, the code and the service, and prints a **SERVER_TOKEN**. On your own computer, in `cs2-tactics/worker`:

```bash
npx wrangler secret put SERVER_TOKEN
```

Paste the token when it asks (type the command exactly like that; the token goes in at the prompt, not on the command line).

### 4. Log in the bot (once)
On the server:

```bash
cd ~/CS2-APP/server && npm run login
```

Type the **bot's** login, password and Steam Guard code. Only Steam's login token is saved (`server/data/bot-token`).

### 5. Start

```bash
sudo systemctl start stratboard
journalctl -u stratboard -f        # watch it: "connected to CS2", then "✓ ready" per match
```

## Everyday

- **Update** after a push to GitHub: `~/CS2-APP/server/deploy/update.sh`
- **Status / logs:** `systemctl status stratboard`, `journalctl -u stratboard -n 100`
- **Stop / start:** `sudo systemctl stop stratboard`, `sudo systemctl start stratboard`
- **Bot login expired** (log says to): `cd ~/CS2-APP/server && npm run login`, then `sudo systemctl restart stratboard`

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
| `the saved login is no longer valid` | step 4 again, then `sudo systemctl restart stratboard` |
| `Worker /users: 403` | the Worker's SERVER_TOKEN doesn't match `server/.env`: `npx wrangler secret put SERVER_TOKEN` with the value from `server/.env` |
| `CS2 did not answer about this match` (every time) | Steam sometimes ignores brand-new or limited bot accounts; try again later, or make the bot account non-limited |
| `gone: The demo has expired` | normal for matches older than about a month |
