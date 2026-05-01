-- ═══════════════════════════════════════════════════════════════════════════
--  GameGuide-AI :: Discord Bot Supabase Schema
--  ───────────────────────────────────────────────────────────────────────
--  Run this ONCE in your Supabase SQL Editor (https://app.supabase.com →
--  your project → SQL Editor → New Query → paste → Run).
--
--  Creates:
--    - discord_chat_messages    : per-user chat history (parity with the web)
--    - discord_premium          : premium-tier users (Stripe-driven or manual)
--    - discord_premium_servers  : premium servers (whole-server upgrade)
--    - discord_usage_stats      : per-user counter for analytics + Top.gg badge
--    - discord_votes            : Top.gg vote rewards (one row per vote event)
--
--  All tables use bigint user_id / guild_id (Discord snowflakes are 64-bit).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.discord_chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  guild_id    BIGINT,
  text        TEXT NOT NULL,
  sender      TEXT NOT NULL CHECK (sender IN ('user', 'ai')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discord_chat_user_created_idx
  ON public.discord_chat_messages (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.discord_premium (
  user_id      BIGINT PRIMARY KEY,
  tier         TEXT NOT NULL DEFAULT 'pro' CHECK (tier IN ('pro', 'lifetime')),
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'stripe', 'topgg-vote')),
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.discord_premium_servers (
  guild_id     BIGINT PRIMARY KEY,
  granted_by   BIGINT,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.discord_usage_stats (
  user_id        BIGINT PRIMARY KEY,
  total_calls    INT NOT NULL DEFAULT 0,
  vision_calls   INT NOT NULL DEFAULT 0,
  last_call_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.discord_votes (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  bot_id      BIGINT,
  source      TEXT NOT NULL DEFAULT 'topgg',
  is_weekend  BOOLEAN DEFAULT FALSE,
  voted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discord_votes_user_voted_idx
  ON public.discord_votes (user_id, voted_at DESC);

-- ─── Row Level Security ───────────────────────────────────────────────────
-- We disable RLS for these tables because the bot uses the SERVICE ROLE key
-- to write/read on behalf of users. The service role bypasses RLS by design.
-- If you want a public read (e.g. a /stats web page), add SELECT policies.

ALTER TABLE public.discord_chat_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_premium         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_premium_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_usage_stats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_votes           ENABLE ROW LEVEL SECURITY;

-- Aggregate stats are safe to expose publicly (no PII).
DROP POLICY IF EXISTS "Public can read aggregate usage" ON public.discord_usage_stats;
CREATE POLICY "Public can read aggregate usage"
  ON public.discord_usage_stats FOR SELECT TO anon USING (TRUE);
