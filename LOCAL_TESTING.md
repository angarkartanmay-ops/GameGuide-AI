# Local testing — staying on free tiers

Goal: run the **new** backend on your machine and confirm it's better before
deploying anything.

## 1. Keys you need

**No new API keys are required.** Every model added in the latest round rides on
providers already in the mesh:

| Model added | Key it uses | New key? |
|---|---|---|
| `groq/compound`, `groq/compound-mini` (self-searching) | `GROQ_API_KEY` | No — same Groq key |
| Live-discovered OpenRouter models | `OPENROUTER_API_KEY` | No — same key |
| OpenRouter model *catalog* lookup | none | No — unauthenticated |

Minimum to get a reply is **one** provider key. Recommended free set:

| Provider | Why | Free tier | Get a key |
|---|---|---|---|
| **Groq** | Primary workhorse + the self-searching models | Rate-limited, no card | https://console.groq.com/keys |
| **Google** | Vision, OCR, image generation | Free tier, no card | https://aistudio.google.com/apikey |
| **Cerebras** | Second free pool with its own quota | Free tier, no card | https://cloud.cerebras.ai |
| **OpenRouter** | Free vision fallback + widest model choice | Free models, no card | https://openrouter.ai/keys |

If you only want to set up one, make it **Groq** — it covers the workhorse and
the recency path that caused the 007 First Light failure.

## ⚠️ Search: read this, it decides whether recency works

Verified 2026-08-25 from this machine: **the free search backends are
effectively dead.**

| Backend | Result |
|---|---|
| `searx.be` | HTTP 200 but serves a *browser-verification captcha*, not JSON |
| `priv.au`, `paulgo.io`, `searx.tiekoetter.com` | HTTP 429 (rate limited) |
| DuckDuckGo Lite | HTTP 202 challenge page, no results |

Consequence: PULSE returns **0 blocks**, the model gets no live context, and a
2026 release looks like it doesn't exist. That is the exact 007 First Light
failure, and no model upgrade fixes it — you cannot reason your way to a fact
you were never given.

**Two independent ways to fix it. Do at least one; doing both is better.**

### A. `GROQ_API_KEY` — the free one (do this first)

Groq's `compound` models run their own server-side web search. That bypasses
our broken search layer entirely. The router already sends recency questions
there first, and now also falls back to it whenever our own retrieval comes
back empty. One free key, no card, fixes both the workhorse and recency.

### B. `SERPER_API_KEY` — fixes our own retrieval

2500 free searches/month, no card: https://serper.dev

This repairs PULSE itself, which matters beyond recency — corroboration
scoring needs multiple independent sources to judge confidence, and with zero
sources every answer is marked low-confidence.

Alternative: `GOOGLE_CSE_ID` (100 free/day, pairs with your existing
`GOOGLE_API_KEY`) — create one at https://programmablesearchengine.google.com

### How to tell it is working

Watch the API logs. This line means retrieval failed and the system routed
around it:

```
[RETRIEVAL-STARVED] no live sources for "..." — free search backends are
likely rate-limited or serving captchas.
```

Seeing it occasionally is fine. Seeing it on every query means neither fix is
in place, and answers about anything recent will be unreliable.

## 2. One-time setup

```bash
# Deno runs the edge function standalone — no Docker, no Supabase CLI.
npm install -g deno

# Function secrets
cp supabase/functions/.env.example supabase/functions/.env
#   → paste your keys into that file

# Frontend config
cp .env.example .env.local
#   → set VITE_SUPABASE_URL=http://127.0.0.1:8000
#   → set VITE_SUPABASE_ANON_KEY to your project's anon key
#     (any non-empty string works locally; it is only used as a bearer token)
```

Both `.env` files are gitignored; the `.example` templates are not.

## 3. Run it

Two terminals:

```bash
npm run dev:api     # edge function on http://127.0.0.1:8000
npm run dev         # frontend on http://localhost:5173
```

Confirm the backend is healthy:

```bash
curl http://127.0.0.1:8000/health
```

Look for:
- `catalog.source: "live"` — model discovery is working. `"fallback"` means it
  couldn't reach OpenRouter and is using deploy-time ids, which rot within days.
- `catalog.usableModels` — should be ~11 free models, 4 with vision.
- `agentic.enabled: true` — the self-searching path is armed (needs `GROQ_API_KEY`).
- `db: "NOT CONFIGURED"` locally is **expected and fine** — rate limiting falls
  back to an in-memory limiter and player memory is skipped. Nothing errors.

## 4. What to try

The questions that previously failed:

1. *"What are the recent reviews about 007 First Light? How long ago did it release?"*
   Should identify it as the 2026 IO Interactive game. It must **never** say the
   game doesn't exist or suggest you meant Infamous: First Light.
2. *"But this is from Forza Horizon 6"* after it names a different game — should
   accept the correction, not argue or reset to a scope message.
3. Attach a game screenshot — vision path.
4. *"I'm burnt out on ranked"* — should get a human reply with **no** follow-up
   chips stapled on.
5. `/stealth` — banner appears, nothing persists, exiting discards the transcript.

## 5. Automated check

Once the local API is running:

```bash
node tests/eval/live.mjs http://127.0.0.1:8000/functions/v1/chat-proxy local-test-key
```

This replays the failure cases and fails on hallucination markers, refusal-template
leakage, or answers with zero sources attached. It's the gate that actually proves
the fix, since `npm test` only covers the retrieval and routing layer offline.

## 6. When you're happy

```bash
supabase db push                          # schema: rate limits, memory, health
supabase functions deploy chat-proxy      # the backend itself
```

Then set the same keys in **Dashboard → Project Settings → Edge Functions →
Secrets**, plus `SUPABASE_JWT_SECRET` and `RATE_LIMIT_SALT` which only matter in
production.

## Optional: a paid quality floor

Everything above stays strictly free. If you later want quality to degrade
gracefully instead of failing when free tiers exhaust:

```
ENABLE_PAID_FALLBACK=1
MAX_PAID_PROMPT_USD_PER_MTOK=0.10
```

Qualifying models run $0.02–0.05 per million tokens, so a few users a day costs
cents per month, and the cap makes runaway spend structurally impossible. Leave
it unset to stay entirely on free tiers.
