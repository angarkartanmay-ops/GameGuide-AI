-- 2026-09-26 — Spoiler Shield: per-player progress for the Discord bot.
--
-- Applied to the live project with: supabase db query --linked -f <this file>
-- Mirrors the discord_spoiler_prefs block in schema-v3.sql (the source of truth
-- for a fresh install). Idempotent: safe to re-run.
--
-- Written only by the bot with the service role. RLS on with no policies means
-- the anon key — which ships in the public web bundle — can neither read nor
-- write where anyone is in any game.

CREATE TABLE IF NOT EXISTS public.discord_spoiler_prefs (
  user_id     BIGINT PRIMARY KEY,
  mode        TEXT NOT NULL DEFAULT 'shield' CHECK (mode IN ('shield', 'off')),
  progress    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.discord_spoiler_prefs ENABLE ROW LEVEL SECURITY;
