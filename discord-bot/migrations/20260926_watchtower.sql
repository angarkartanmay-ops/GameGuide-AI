-- 2026-09-26 — Watchtower: patch-note and deal alerts posted into server channels.
--
-- Applied to the live project with: supabase db query --linked -f <this file>
-- Mirrors the WATCHTOWER block in schema-v3.sql (the source of truth for a
-- fresh install). Idempotent: safe to re-run.
--
-- Server configuration, not personal data: which channel follows which game.
-- No user ids are stored. Rows go when the watch is removed, the channel is
-- deleted, or the bot leaves the server. Written only by the bot with the
-- service role; RLS on with no policies keeps the anon key out.

CREATE TABLE IF NOT EXISTS public.discord_watches (
  id              BIGSERIAL PRIMARY KEY,
  guild_id        BIGINT      NOT NULL,
  channel_id      BIGINT      NOT NULL,
  steam_appid     INT         NOT NULL CHECK (steam_appid > 0),
  game_name       TEXT        NOT NULL CHECK (char_length(game_name) BETWEEN 1 AND 120),
  news            TEXT        NOT NULL DEFAULT 'patches' CHECK (news IN ('patches', 'all', 'none')),
  deals           BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Only items published after this are posted: adding a watch never floods
  -- the channel with old patches.
  since           TIMESTAMPTZ NOT NULL DEFAULT now(),
  cheapshark_id   TEXT,
  last_deal_price NUMERIC(10,2),
  last_deal_at    TIMESTAMPTZ,
  -- Set when the bot can no longer post in the channel; re-adding clears it.
  paused_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, channel_id, steam_appid),
  -- A watch that posts nothing is a row that only costs polling.
  CONSTRAINT discord_watches_posts_something CHECK (news <> 'none' OR deals)
);
CREATE INDEX IF NOT EXISTS discord_watches_active_app_idx
  ON public.discord_watches (steam_appid) WHERE paused_reason IS NULL;
CREATE INDEX IF NOT EXISTS discord_watches_guild_idx
  ON public.discord_watches (guild_id);

-- One row per (watch, Steam item or deal) ever posted. The primary key is the
-- exactly-once guarantee: the bot INSERTs before it posts, so a restart or a
-- second instance cannot post the same patch twice.
CREATE TABLE IF NOT EXISTS public.discord_watch_posts (
  watch_id   BIGINT      NOT NULL REFERENCES public.discord_watches(id) ON DELETE CASCADE,
  item_key   TEXT        NOT NULL CHECK (char_length(item_key) <= 200),
  posted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (watch_id, item_key)
);
CREATE INDEX IF NOT EXISTS discord_watch_posts_age_idx
  ON public.discord_watch_posts (posted_at);

ALTER TABLE public.discord_watches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_watch_posts ENABLE ROW LEVEL SECURITY;
