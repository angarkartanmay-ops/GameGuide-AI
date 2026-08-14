# chat-proxy — Neural Mesh v3

## Deploying these changes

Two steps, in order. The function degrades gracefully without step 1, but you
lose durable rate limiting and player memory.

```bash
# 1. Apply the schema (rate limiting, provider health, quota ledger, memory)
supabase db push
#    …or paste supabase/migrations/20260813_mesh_v3.sql into the SQL editor.

# 2. Deploy the function
supabase functions deploy chat-proxy
```

Then confirm everything is wired:

```bash
curl https://<project>.supabase.co/functions/v1/chat-proxy/health
```

The response reports `db: connected`, which providers hold keys, and — most
usefully — a `mesh` array showing each model's spend against its daily cap and
any active cooldown. That endpoint is the fastest way to answer "why did
quality drop?"

Optionally schedule the cleanup job (Database → Cron), hourly:

```sql
SELECT public.gg_prune_usage_events();
```

## Environment

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

| Variable | Required | Purpose |
|---|---|---|
| `GROQ_API_KEY` | strongly recommended | Primary workhorse. Free tier is rate-limited, not credit-metered. |
| `CEREBRAS_API_KEY` | recommended | Second free pool, separate quota from Groq. |
| `GOOGLE_API_KEY` | recommended | Vision, OCR, image generation. |
| `OPENROUTER_API_KEY` | optional | Extra free vision models; smallest daily allowance. |
| `RATE_LIMIT_SALT` | recommended | Salt for hashing anonymous IPs. Set to any random string. |
| `GROQ_DAILY_CAP` | optional | Default 1000. Raise when you upgrade. |
| `CEREBRAS_DAILY_CAP` | optional | Default 800. |
| `OPENROUTER_DAILY_CAP` | optional | Default 50; set ~1000 once the account holds credit. |
| `SERPER_API_KEY` / `GOOGLE_CSE_ID` / `BRAVE_SEARCH_API_KEY` | optional | Better search recall. Free fallbacks run without them. |

## Cost model

Routing spends free-and-unmetered capacity (Groq, Cerebras) before
free-but-capped capacity (OpenRouter), and drops any model that reaches its
daily cap. With Groq and Cerebras keys set, ordinary daily use by a handful of
people should not bill at all — the ceiling is requests per day, not spend.

To raise capacity later, bump the `*_DAILY_CAP` values rather than editing the
registry.

## Keeping model IDs alive

**A retired model id fails silently.** It looks like degraded quality, not an
error. Every OpenRouter id in v2 had been retired upstream, which meant the
entire fallback tier — including all three vision models — was failing 100% of
the time.

Re-verify from the source of truth, don't guess:

```bash
# OpenRouter — the free tier changes often
curl -s https://openrouter.ai/api/v1/models \
  | jq -r '.data[] | select(.id|endswith(":free")) | .id'
```

- Groq: <https://console.groq.com/docs/models>
- Cerebras: <https://inference-docs.cerebras.ai/models/overview>
- Gemini: <https://ai.google.dev/gemini-api/docs/models>

All ids live in `meshRouter.ts`. Nothing model-specific belongs anywhere else.

## Streaming

Send `stream: true` to get `text/event-stream` instead of JSON. Events:

| Event | Meaning |
|---|---|
| `stage` | Retrieval progress (`searching`, `scanning-sources`, `reading-image`, `generating`) |
| `delta` | Token chunk — append to the visible message |
| `final` | Authoritative text. **Replaces** accumulated deltas. |
| `error` | Generation failed |

`final` supersedes the deltas because post-processing (follow-up chips,
uncertainty scrubbing) only runs once the full response exists.

A model may only be swapped out **before** it emits its first token. Once text
has reached the user we are committed — silently restarting on another model
would contradict what they already read — so mid-stream failures surface as
`error` rather than a silent retry.

## On "search that never gets anything wrong"

It doesn't exist. The web contains stale wikis, datamined rumours stated as
fact, and confidently wrong forum posts; no ranking function repairs a bad
underlying source.

`corroboration.ts` does the achievable thing instead — it makes confidence
*legible*, so wrongness stops being silent:

- counts **independent** domains (aggregators republishing one story collapse
  to a single source rather than looking like consensus)
- weights first-party sources above fan sites
- detects conflicting patch/season/date claims and forces the model to surface
  the disagreement instead of quietly picking one
- demotes confidence when a "what's current" question is answered only from
  stale pages

The resulting block tells the model how much trust each claim earned, so
"three independent sources agree" and "one forum post said this" produce
visibly different answers.
