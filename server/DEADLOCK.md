# The bots (Deadlock and CS2), free on GitHub Actions

**How it runs now:** `.github/workflows/bots.yml` runs `server/src/once.mjs` every 15 minutes on GitHub Actions (free for
this public repo): one login of the bot account, Deadlock friends' new matches to deadlock-api, the Worker told what it
saw (the site reads `/dl/bot`, `/dl/friend/…`, `/dl/matches/…` there), then one CS2 round. Repo secrets:
`STEAM_REFRESH_TOKEN` (`server/data/bot-token`) and `SERVER_TOKEN` (`STRATBOARD_SERVER_TOKEN` in the repo's `.env`).
The Actions log is public: IDs and codes are masked. The Fly.io set-up below is the paid alternative (always on).

## Fly.io (paid alternative)

One Fly app runs both bots on the bot's one Steam login (Steam allows one login per account): the Deadlock match
finder below, and the CS2 demo bot (`README.md`: every logged-in player's new CS2 matches downloaded, read, graded
and put on their profile every 5 minutes). The CS2 side runs when the `SERVER_TOKEN` secret is set (`CS2_BOT=off` turns
it off). It needs a 4 GB machine (demos take about 3 GB to read): about $20-25 a month.

Makes every visitor's **Deadlock matches load by themselves** on https://tsakhstvo.xyz. A visitor clicks **Add in Steam**
in Review once; the bot (a separate Steam account) accepts, and from then on it checks their match history every
10 minutes, gets each new match's salts from Deadlock's game coordinator and hands them to deadlock-api, which fetches the
match and, when Valve kept one, its replay. Visitors install nothing.

- The bot is its **own Steam account**: never yours, never a visitor's. If Steam objects to it, only that account is hit.
- It only reads friends' Deadlock match history and match salts. It sends deadlock-api the match ID and salts, nothing else.
- About $2–3 a month on Fly.io (one small always-on machine and a 1 GB volume).

## 1. The bot account (once)

1. Make a new Steam account for the bot (or use the CS2 bot account from `README.md`).
2. Its profile must be **public** (so visitors can open it and add it), and it needs **Deadlock** in its library
   (step 2 tries to add it by itself).

## 2. Log the bot in (once, on your computer)

In the repo's `server` folder:

```bash
npm ci --omit=dev
npm run login
```

Type the **bot's** login, password and Steam Guard code. Only Steam's login token is saved, in `server/data/bot-token`
(never committed). Nobody else sees the password.

Try it locally if you like: `npm run deadlock`, then open http://localhost:8080/dl/bot (it shows the bot's SteamID once
it's connected).

## 3. Put it on Fly.io

Install `flyctl` (https://fly.io/docs/flyctl/install/). From the **repo root** (the image holds the app's tools):

```bash
fly auth login
fly volumes create dl_bot_data --size 3 --region fra -c server/fly.toml   # first time only
fly secrets set -c server/fly.toml STEAM_REFRESH_TOKEN="$(cat server/data/bot-token)"
fly secrets set -c server/fly.toml SERVER_TOKEN="$(grep ^STRATBOARD_SERVER_TOKEN= .env | cut -d= -f2-)"
fly deploy . --config server/fly.toml --dockerfile server/Dockerfile.bots
```

`SERVER_TOKEN` is the Worker's shared secret (made once by `npm run link:coach`, kept in the repo's `.env`). Check
`https://<app>.fly.dev/health` says `"state":"ready","cs2":"ready"`; the Dev page shows the CS2 bot's last round.

Logs: `fly logs -c server/fly.toml`. When Steam renews the login, the new token is kept on the volume. A full volume
(parsed demos, about 0.6 MB a match): `fly volumes extend <id> --size 6 -c server/fly.toml`.

## 4. Tell the website

GitHub repo → Settings → Secrets and variables → Actions → **Variables** → New: `DL_BOT_URL` =
`https://<app>.fly.dev`. The next deploy shows **Add in Steam** in Review → Your matches.
(If you use another address than tsakhstvo.xyz, add it to `DL_ALLOW_ORIGINS` in `fly.toml`.)

## How it works

`src/deadlock.mjs` (the service) and `src/deadlock/` (the bot and the few Deadlock messages it uses, from
[SteamDatabase/Protobufs](https://github.com/SteamDatabase/Protobufs/tree/master/deadlock)):

- **Friends:** every friend request is accepted (`friendRelationship`).
- **Every `DL_POLL_MINUTES` (10):** for each friend, `ClientToGCGetMatchHistory`; for each match of the last week not handed
  on yet, `ClientToGCGetMatchMetaData` (salts: metadata, replay, cluster), a check that the match file is on Valve's
  server, then `POST https://api.deadlock-api.com/v1/matches/salts`. Requests are spaced 2.5 s apart.
- **For the site** (CORS for `DL_ALLOW_ORIGINS`): `GET /dl/bot`, `GET /dl/friend/<SteamID3>`,
  `GET /dl/matches/<SteamID3>` (friends only), `POST /dl/refresh/<SteamID3>` (check now: Pro only, for your own account, verified with the Worker's `/me` using your site session; once a minute).
- **State** (`/data/deadlock-state.json`): each friend's last match list and which matches were handed on (two weeks).
