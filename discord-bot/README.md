# GameGuide-AI :: Discord Bot

Full feature parity with the GameGuide-AI web app, hardened for production and built for passive-income monetization.

## What It Does

| Web app feature | Bot equivalent |
|---|---|
| Chat with vision queries | `@GameGuide <text>` + image attachments, OR `/ask` |
| `/price`, `/tip`, `/lore`, `/redpill` | same slash commands |
| `/noclip`, `/konami`, `/loading` (vibes) | same slash commands |
| Persistent chat history (Supabase) | same Supabase project, table `discord_chat_messages` |
| Live-source telemetry chip | footer line on every reply showing sources |
| Per-user tier (free/pro/premium-server) | daily quota enforced in Postgres, `/quota` to check |
| Backend model hidden | provider/model never leak in responses |

## Quick Start (Local Dev)

```bash
cd discord-bot
npm install

# 1. Run schema.sql in Supabase SQL Editor (one-time)
#    → app.supabase.com → your project → SQL Editor → paste schema.sql → Run
#    THEN run schema-v3.sql the same way (the freemium quota engine).

# 2. Copy .env.example → .env and fill it in
cp .env.example .env
# At minimum: DISCORD_TOKEN, DISCORD_CLIENT_ID, SUPABASE_URL,
#             SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

# 3. Register slash commands (one-time, or whenever you change them)
npm run register
# OR for instant dev (replace with your test guild ID):
node register-commands.js 123456789012345678

# 4. Run the bot
npm start
```

> **Want 24/7 immediately?** Skip ahead to [Production Deploy (24/7)](#production-deploy-247) — Render and Koyeb are free and take ~5 minutes.

## Slash Commands

| Command | What it does |
|---|---|
| `/ask <question> [image]` | Free-form question, optional screenshot |
| `/price <game>` | Live multi-store prices via CheapShark |
| `/tip` | Random elite pro gaming tip |
| `/lore [game]` | Deep-cut lore drop |
| `/redpill` | Hidden gaming-industry secret |
| `/history` | Show your last messages with the bot (ephemeral) |
| `/clear` | Wipe your chat history |
| `/quota` | Messages and screenshots you have left today |
| `/stats` | Global + your usage stats |
| `/premium` | Compare plans and upgrade |
| `/help` | Full reference |
| `/noclip`, `/konami`, `/loading` | Vibe / fun commands |

## Tier System

Quota is enforced in Postgres by `gg_discord_quota_check()`, so it survives
restarts, is shared across instances, and cannot disagree with itself. Limits
live in the `discord_quota_tiers` **table** — retune them with an `UPDATE`, no
redeploy. A vision turn costs 1 message *and* 1 screenshot.

| | 🆓 Free | ⭐ Pro — $4.99/mo | 🌟 Server — $14.99/mo |
|---|---|---|---|
| Messages / day | **15** | **200** | **60 per member** |
| Guild pool / day | — | — | **800 shared** |
| Burst / minute | 5 | 20 | 10 |
| Screenshots / day | 3 | 40 | 10 |
| Image generations / day | 1 | 15 | 5 |
| History retained | 10 | 50 | 25 |
| Context sent to model | 6 turns | 24 turns | 12 turns |
| Priority routing | — | ✅ | ✅ |
| At global capacity | waits | never queued | protected |

**Why 15/day free:** median engaged use is 3–5 messages/day, so 15 clears
roughly 88% of users untouched while the heaviest ~12% — the only group that
costs real money — hit the wall by mid-afternoon. The platform can serve about
3,000 turns/day in total across all providers; that ceiling is what the whole
table is derived from, and it is enforced by `global_daily_cap` in
`discord_quota_config`.

**Granted by:** `discord_entitlements` row (Stripe, or `manual`), a
`discord_premium_servers` row for the server plan, or the `PREMIUM_USER_IDS` /
`PREMIUM_GUILD_IDS` env vars, which are synced into the database at boot.

Users check their own balance with `/quota`.

## Monetization

### 1. Stripe (paid Pro + Server) — fully wired

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, create two recurring
[Payment Links](https://dashboard.stripe.com/payment-links), and point a
[webhook](https://stripe.com/docs/webhooks) at
`https://<your-bot-host>/stripe-webhook` subscribed to
`checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted` and `invoice.payment_failed`.

The bot appends `?client_reference_id=<discord id>` to the payment link, so the
buyer is joined to their Discord account automatically — no "paste your Discord
ID" step, which is where most bot conversions are lost. Entitlements are written
through `entitlements.js`, so enabling Discord's own App Subscriptions later
writes the same table and nothing downstream changes.

A failed charge marks the account `past_due` but **keeps Pro active** while
Stripe's dunning retries — pulling access on the first declined card turns an
expired card into a cancellation.

Test it end to end without leaving your machine:
```bash
stripe listen --forward-to localhost:3000/stripe-webhook
stripe trigger checkout.session.completed
```

### 2. Top.gg votes (free traffic)
List the bot at [Top.gg](https://top.gg). A vote grants **+10 bonus messages for
24h**, capped at 20 banked, spent before the daily allowance.

> Votes deliberately do **not** grant a tier. Top.gg allows a vote every 12
> hours, so the previous "12h of Pro per vote" meant voting twice a day bought
> permanent free Pro — and because it upserted on `user_id`, a lifetime customer
> who voted was silently downgraded to a 12-hour expiry.

To wire the webhook:
1. Set `TOPGG_WEBHOOK_AUTH` to a long random string
2. Set `TOPGG_VOTE_URL` to `https://top.gg/bot/<your_bot_id>/vote` (shown on `/premium`)
3. In your Top.gg dashboard → Webhooks tab, set:
   - URL: `https://your-bot-host.com/topgg-webhook`
   - Authorization: same string as `TOPGG_WEBHOOK_AUTH`
4. The bot's Express webhook auto-spins up on `:VOTE_WEBHOOK_PORT/topgg-webhook` when `TOPGG_WEBHOOK_AUTH` is set.

### 3. Affiliate links on `/price` (passive)
Set any of these — every CheapShark URL the bot returns gets auto-decorated:
- `HUMBLE_AFFILIATE` (your Humble Partner ID, no traffic minimum to join)
- `GMG_AFFILIATE` (GreenManGaming Affiliate program)
- `FANATICAL_AFFILIATE` (Fanatical's affiliate ref)

Sign up:
- Humble Partner: https://www.humblebundle.com/partners
- GMG Affiliates: https://www.greenmangaming.com/affiliate-program/
- Fanatical: https://www.fanatical.com/affiliate

### 4. Per-server Premium upgrade (B2B)
A server admin pays once — every member of their guild gets 60 messages/day for
the period, drawn from an 800/day shared pool. Buying via `/premium` writes the
row automatically; to grant one by hand, add the guild id to
`discord_premium_servers` (with optional `expires_at`).

Per-member caps stop one loud member consuming the whole subscription; the pool
stops one guild consuming the platform.

## Production Deploy (24/7)

> **TL;DR — Pick ONE.** All options below keep the bot online 24/7. Free-tier hosts marked ✅ FREE; paid (~$5/mo) marked 💵.

### How the 24/7 design works

The bot now ships with **5 layers of resilience** that together guarantee uptime:

1. **Always-on HTTP server** on `PORT` — binds before login, so any host that "needs a port" stays happy. Exposes `/`, `/ping`, `/health`.
2. **Login supervisor** — retries `client.login()` with exponential backoff (2s → 60s, forever), except on invalid-token which fails fast so you notice.
3. **Watchdog** — every 60s, if the gateway has been "not ready" for > 5 min it destroys & re-logs the client.
4. **Resilient handlers** — `unhandledRejection` and `uncaughtException` are logged but **do not crash the process**. discord.js auto-reconnects shards internally.
5. **Self-ping keep-alive** — set `KEEPALIVE_URL=https://your-bot.example.com` and the bot pings itself every 4 min, defeating idle-sleep on free tiers (Render free, Replit).

Combined, any cause of "the bot stopped":
- Network blip during boot → login supervisor retries
- WebSocket dies → discord.js auto-reconnect (logged via `shardReconnecting`)
- Gateway stuck "not ready" → watchdog forces reconnect
- Free host went to sleep → self-ping wakes it
- Whole process crashes → host restart policy (`restartPolicyType: ALWAYS` on Railway, `autorestart: true` on PM2, `restart=always` on Docker) brings it back

### ✅ FREE — Render (recommended free option)
1. Push `discord-bot/` to GitHub.
2. https://render.com → New → Web Service → connect repo.
3. Render will auto-detect [render.yaml](render.yaml). Set env vars when prompted (only the secrets — Render reads the rest from yaml).
4. After first deploy, copy your public URL (e.g. `https://gameguide-bot.onrender.com`) and add it as `KEEPALIVE_URL` env var → redeploy.
   Without this, Render free instances sleep after 15 min idle.

### ✅ FREE — Koyeb (no card needed)
1. https://app.koyeb.com → Create App → GitHub.
2. Root directory: `discord-bot`. Build: auto-detected. Port: `3000`. Health check path: `/health`.
3. Add env vars, deploy. Set `KEEPALIVE_URL` to your `*.koyeb.app` URL.

### ✅ FREE-ish — Fly.io (3 small machines free)
```bash
cd discord-bot
flyctl launch --no-deploy --copy-config        # uses fly.toml
flyctl secrets set DISCORD_TOKEN=... DISCORD_CLIENT_ID=... \
                   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
flyctl deploy
```
[fly.toml](fly.toml) is preconfigured with `min_machines_running = 1` and `auto_stop_machines = false` — your bot will never sleep. `/health` is wired as the HTTP check.

### 💵 Railway (~$5/month, zero-config)
1. Push to GitHub.
2. https://railway.app → New Project → Deploy from GitHub.
3. Add env vars from `.env.example`. Done.

[railway.json](railway.json) sets `restartPolicyType: ALWAYS`, `sleepApplication: false`, and the `/health` healthcheck.

### 💵 Self-hosted (VPS / home server / Pi) with PM2
The most reliable option once configured — your bot survives reboots and crashes automatically.

```bash
cd discord-bot
npm ci --omit=dev
cp .env.example .env && nano .env          # fill in secrets
npm i -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup                                # then run the command it prints
```
PM2 ([ecosystem.config.js](ecosystem.config.js)) auto-restarts on crash, on file-touch, and on reboot. Logs go to `./logs/`.

### 💵 Docker (anywhere — VPS, Kubernetes, Cloud Run)
```bash
docker build -t gameguide-bot .
docker run -d --restart=always --env-file .env -p 3000:3000 --name gameguide-bot gameguide-bot
```
The [Dockerfile](Dockerfile) ships with a `HEALTHCHECK` that calls `/health`. Docker will report `unhealthy` (and many orchestrators will restart) if the bot isn't responding.

### Optional but recommended for any deployment: external uptime monitor

Add a free monitor on top of the in-process self-ping for belt-and-suspenders:

| Service | What to set |
|---|---|
| [UptimeRobot](https://uptimerobot.com) | 5-min HTTP(s) check on `https://your-bot/health` |
| [cron-job.org](https://cron-job.org) | Every 5 min, GET `https://your-bot/ping` |
| [BetterStack](https://betterstack.com/uptime) | HTTP check + alerts on `/health` returning non-200 |

If you get paged, `/health` returns full diagnostics: ws ping, guild count, reconnect counter, error counter, last-ready timestamp.

## Architecture

```
Discord ──► Bot (this repo) ──► Supabase chat-proxy ──► Cortex v4.1
                  │
                  ├──► Supabase tables (history, premium, stats, votes)
                  └──► Top.gg vote webhook (Express, optional)
```

The bot doesn't run any LLM logic itself — it's a thin gateway to the existing [chat-proxy edge function](../supabase/functions/chat-proxy/index.ts), which handles the entire Cortex pipeline (Game Resolver → Omniscience → Trust Ranker → Persona → Neural Mesh → Quality Gate → Vision GODMODE).

## Files

| File | Purpose |
|---|---|
| [index.js](index.js) | Production bot — mention listener, slash handlers, HTTP server, login supervisor, watchdog, vote webhook |
| [register-commands.js](register-commands.js) | One-time slash command registration with Discord |
| [schema.sql](schema.sql) | Supabase tables (run once in SQL Editor) |
| [.env.example](.env.example) | Template for all env vars — copy to `.env` |
| `.env` | Your local secrets (never commit — `.gitignore`'d) |
| [Dockerfile](Dockerfile) | Container build (with `HEALTHCHECK`) |
| [.dockerignore](.dockerignore) | Files excluded from Docker image |
| [Procfile](Procfile) | Heroku-style deploy declaration (`web: node index.js`) |
| [railway.json](railway.json) | Railway deploy config — restart ALWAYS, no sleep |
| [render.yaml](render.yaml) | Render Web Service blueprint |
| [fly.toml](fly.toml) | Fly.io machine config — `min_machines_running = 1` |
| [ecosystem.config.js](ecosystem.config.js) | PM2 process manager config for self-hosted 24/7 |

## Observability

- **Bot logs** — every chat request, rate-limit hit, vote, shard event, reconnect, and error logs to stdout
- **Supabase**: query `discord_usage_stats` for analytics, `discord_votes` for vote tracking
- **`/stats` command** — quick sanity check that calls are landing
- **HTTP endpoints (always on)**:
  - `GET /` — text alive message
  - `GET /ping` — `pong` (cheap, for cron/uptime pingers)
  - `GET /health` — full diagnostics:
    ```json
    {
      "ok": true,
      "bot": "GameGuide-AI#1234",
      "uptimeSec": 86400,
      "wsPing": 47,
      "guilds": 12,
      "reconnects": 0,
      "chatRequests": 1842,
      "errors": 3,
      "lastReadyAt": "2026-05-13T12:34:56.789Z"
    }
    ```
    Returns **503** if the gateway is not connected — your uptime monitor will catch this even if the HTTP server is otherwise healthy.

## Troubleshooting

**Bot keeps stopping / "is offline" after a while** → almost always a hosting platform issue, not a bot bug. Diagnose with:
1. Hit `https://your-bot-url/health` — if it returns 200 with `ok: true`, the bot is up. If you get a connection error, the host killed your service. If you get 503, the gateway is disconnected but the process is alive (the watchdog should fix this within 5 min — check logs).
2. On free-tier hosts (Render, Replit, Koyeb), **set `KEEPALIVE_URL`** to your public bot URL. Without it the host puts the service to sleep after ~15 min of no inbound traffic. The bot then can't hold the Discord gateway open.
3. Add a free [UptimeRobot](https://uptimerobot.com) check on `/health` as a second layer.
4. Make sure your host's restart policy is set: Railway `restartPolicyType: ALWAYS` (in [railway.json](railway.json) already), Docker `--restart=always`, PM2 `autorestart: true` (in [ecosystem.config.js](ecosystem.config.js) already).

**Bot says "Connection Lost"** in user-facing replies → check the bot logs. The error category is in stdout (e.g., `HTTP 503: ...`). The most common cause: `chat-proxy` not deployed or its secrets not set. Hit the proxy `/health` endpoint to verify.

**Slash commands don't appear** → re-run `npm run register`. Global registration takes ~1h. For instant testing use a guild ID.

**`/history` and persistence don't work** → the bot needs the `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS for the `discord_*` tables. Without it, history persistence is silently disabled (the bot still works, just session-only).

**Top.gg webhook 401 errors** → `TOPGG_WEBHOOK_AUTH` must match exactly what you pasted in the Top.gg dashboard.

**`DISCORD_TOKEN is invalid`** → the bot deliberately exits on invalid token (no point retrying). Reset the token in the Discord Developer Portal and update env vars.

## Roadmap (next ideas)

- Per-server installable commands with admin-only `/setup` for premium tier purchase
- Daily-tip auto-post (cron) to channels that opted in via `/setup channel`
- DM-based onboarding flow for new users
- Localization (the chat-proxy already speaks any language; just translate the slash command descriptions)
