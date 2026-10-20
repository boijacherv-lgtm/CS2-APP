# Stratboard API (Cloudflare Worker)

Gives the website (https://tsakhstvo.xyz) **Log in with Steam** and **Your matches**. Free Cloudflare plan is enough.

- **Log in with Steam** is Steam OpenID: you log in on Steam's own page, Steam sends you back to the website, the site
  hands Steam's signed answer to this Worker, which confirms it with Steam and returns a session token. The Worker only
  ever learns your SteamID. No passwords, no Steam sessions.
- **Profile** keeps, per SteamID, a summary of each match you reviewed as yourself (numbers only, never the demo),
  your goals and settings (`stats:<steamid>` in KV; see `src/profile.ts`). Friends can look you up only if you turn
  on Public profile in the site's Settings. `/forget` deletes it together with your match list.
- **Your matches** uses Valve's official match-history Web API with the site's own Web API key (a secret here) plus each
  user's game authentication code and one share code (pasted once). Stored per SteamID in Cloudflare KV.
- Never add Steam login automation here (steam-session / steam-user / logging in as a user): Steam flagged that as
  malicious on the owner's account.

## First-time setup

Run these in `cs2-tactics/worker`:

```bash
npm install
npx wrangler login                 # opens Cloudflare in your browser: log in and click Allow
npx wrangler kv namespace create SB  # prints an id → paste it into wrangler.toml (kv_namespaces id)
npx wrangler secret put STEAM_API_KEY  # paste your Steam Web API key when it asks (never put it in a file)
npx wrangler deploy                # prints the address, e.g. https://stratboard-api.<you>.workers.dev
```

Then tell the website where the Worker is: GitHub → repo **CS2-APP** → Settings → Secrets and variables → Actions →
**Variables** → New repository variable `API_URL` = the address `wrangler deploy` printed (no trailing slash). Re-run the
"Deploy website" action (or push anything) and the site shows **Log in with Steam**.

## Demo bot (server/)

The demo bot (see [../server/README.md](../server/README.md)) uses the `/internal/*` routes with a shared secret:

```bash
npx wrangler secret put SERVER_TOKEN   # paste the SERVER_TOKEN from server/.env
```

## Updating

`npx wrangler deploy` after changing `src/`. `npx wrangler tail` shows live logs.

## Settings (`wrangler.toml`)

- `SITE_ORIGINS`: the website addresses allowed to call the API.
- `RETURN_TO`: where Steam sends the browser back (the website). Must match what the site uses (`location.origin + /`).
