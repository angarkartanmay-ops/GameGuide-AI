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
| Per-user tier (free/pro/premium-server) | rate-limit aware (`5/30/60` per minute) |
| Backend model hidden | provider/model never leak in responses |

## Quick Start (Local Dev)

```bash
cd discord-bot
npm install

# 1. Run schema.sql in Supabase SQL Editor (one-time)
#    → app.supabase.com → your project → SQL Editor → paste schema.sql → Run

# 2. Fill out .env (at minimum: DISCORD_TOKEN, DISCORD_CLIENT_ID,
#    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)

# 3. Register slash commands (one-time, or whenever you change them)
npm run register
# OR for instant dev (replace with your test guild ID):
node register-commands.js 123456789012345678

# 4. Run the bot
npm start
```

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
| `/stats` | Global + your usage stats |
| `/premium` | Upgrade for higher rate limits |
| `/help` | Full reference |
| `/noclip`, `/konami`, `/loading` | Vibe / fun commands |

## Tier System

| Tier | Rate limit | How it's granted |
|---|---|---|
| **🆓 Free** | 5/min | Default |
| **⭐ Pro** | 30/min | `discord_premium` row OR `PREMIUM_USER_IDS` env OR Top.gg vote (12h) |
| **🌟 Premium Server** | 60/min for all members | `discord_premium_servers` row OR `PREMIUM_GUILD_IDS` env |

## Monetization Hooks (already wired)

### 1. Stripe / Patreon / Ko-fi (paid Pro tier)
Set any of these in `.env` — `/premium` will show buttons linking to them:
- `STRIPE_PAYMENT_LINK` — direct Stripe Payment Link (easiest)
- `PATREON_URL` — your Patreon page
- `KOFI_URL` — your Ko-fi page

For Stripe: create a [Payment Link](https://dashboard.stripe.com/payment-links), set its **success URL** to a tiny page that asks for the user's Discord ID, and use a [Stripe webhook](https://stripe.com/docs/webhooks) to write to `discord_premium`. The bot picks up the new tier on next call (5-min cache TTL).

### 2. Top.gg Vote-for-Premium (free traffic)
List the bot at [Top.gg](https://top.gg). Users get **12 hours of free Pro tier per vote** (24h on weekends).

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
A server admin pays once — every member of their guild gets 60/min for the period.
Add their guild ID to `discord_premium_servers` (with optional `expires_at`).

## Production Deploy

### Railway (easiest, ~$5/month)
1. Push the `discord-bot/` directory to GitHub
2. https://railway.app → New Project → Deploy from GitHub → pick the repo
3. Add all env vars from `.env`
4. Done — Railway uses [railway.json](railway.json) and Nixpacks auto-detects Node

### Fly.io
```bash
flyctl launch --no-deploy
flyctl secrets set DISCORD_TOKEN=... SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... DISCORD_CLIENT_ID=...
flyctl deploy
```

### Render / Heroku
The included [Procfile](Procfile) declares a `worker: node index.js` process. Add env vars in the dashboard, deploy.

### Docker (anywhere)
```bash
docker build -t gameguide-bot .
docker run --env-file .env gameguide-bot
```

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
| [index.js](index.js) | Production bot (mention listener + slash command handlers + vote webhook) |
| [register-commands.js](register-commands.js) | One-time slash command registration with Discord |
| [schema.sql](schema.sql) | Supabase tables (run once in SQL Editor) |
| [.env](.env) | All config (never commit — `.gitignore`'d) |
| [Procfile](Procfile) | Heroku/Render-style deploy declaration |
| [Dockerfile](Dockerfile) | Container build |
| [railway.json](railway.json) | Railway deploy config |

## Observability

- **Bot logs** — every chat request, rate-limit hit, vote, and error logs to stdout
- **Supabase**: query `discord_usage_stats` for analytics, `discord_votes` for vote tracking
- **`/stats` command** — quick sanity check that calls are landing
- **`/health` HTTP endpoint** — included when the vote webhook is enabled (returns `{ ok: true, bot: 'BotName#1234' }`)

## Troubleshooting

**Bot says "Connection Lost"** → check the bot logs. The error category is in stdout (e.g., `HTTP 503: ...`). The most common cause: `chat-proxy` not deployed or its secrets not set. Hit the proxy `/health` endpoint to verify.

**Slash commands don't appear** → re-run `npm run register`. Global registration takes ~1h. For instant testing use a guild ID.

**`/history` and persistence don't work** → the bot needs the `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS for the `discord_*` tables. Without it, history persistence is silently disabled (the bot still works, just session-only).

**Top.gg webhook 401 errors** → `TOPGG_WEBHOOK_AUTH` must match exactly what you pasted in the Top.gg dashboard.

## Roadmap (next ideas)

- Per-server installable commands with admin-only `/setup` for premium tier purchase
- Daily-tip auto-post (cron) to channels that opted in via `/setup channel`
- DM-based onboarding flow for new users
- Localization (the chat-proxy already speaks any language; just translate the slash command descriptions)
