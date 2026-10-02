-- ═══════════════════════════════════════════════════════════════════════════
--  GameGuide-AI :: PUBLIC STATS
--  The live player count on the landing page.
--  ───────────────────────────────────────────────────────────────────────
--  Run in the Supabase SQL editor after 20260813_mesh_v3.sql (and, if the
--  Discord bot shares this project, after discord-bot/schema.sql).
--
--  What is counted, and how:
--    players  distinct callers who got a researched answer, across the web
--             and Discord. A caller is a signed-in account (u:), a Discord
--             user (d:), or an anonymous visitor's salted IP hash (ip:) —
--             the same buckets the rate limiter already uses. Discord users
--             from discord_usage_stats are folded in, de-duplicated.
--    answers  rows in gg_request_trace: researched answers. Cache hits and
--             stealth turns are never traced, so this is a floor.
--    games    distinct games those answers were about.
--
--  It is an honest approximation, not a census: one person on two networks
--  counts twice, a household behind one router counts once.
--
--  Only the three totals leave the database. The function is SECURITY
--  DEFINER so the anon key can call it without being able to read the trace
--  table itself, and it recomputes at most once every 10 minutes no matter
--  how often it is called, so it cannot be used to load the database.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.gg_public_stats_cache (
  id           SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payload      JSONB       NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gg_public_stats_cache ENABLE ROW LEVEL SECURITY;
-- No policies: only the function below touches it.


CREATE OR REPLACE FUNCTION public.gg_public_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_payload  JSONB;
  v_at       TIMESTAMPTZ;
  v_players  BIGINT;
  v_answers  BIGINT;
  v_games    BIGINT;
  v_discord  BOOLEAN := to_regclass('public.discord_usage_stats') IS NOT NULL;
BEGIN
  SELECT payload, computed_at INTO v_payload, v_at
    FROM public.gg_public_stats_cache WHERE id = 1;
  IF v_payload IS NOT NULL AND v_at > now() - INTERVAL '10 minutes' THEN
    RETURN v_payload;
  END IF;

  SELECT count(*), count(DISTINCT lower(btrim(game))) FILTER (WHERE btrim(coalesce(game, '')) <> '')
    INTO v_answers, v_games
    FROM public.gg_request_trace;

  -- Only real caller buckets; anything else (diagnostics, a future internal
  -- bucket) is not a player.
  IF v_discord THEN
    EXECUTE $q$
      SELECT count(*) FROM (
        SELECT bucket_key FROM public.gg_request_trace
         WHERE bucket_key ~ '^(u|ip):.' OR bucket_key ~ '^d:[0-9]+$'
        UNION
        SELECT 'd:' || user_id::text FROM public.discord_usage_stats
      ) p
    $q$ INTO v_players;
  ELSE
    SELECT count(DISTINCT bucket_key) INTO v_players
      FROM public.gg_request_trace
     WHERE bucket_key ~ '^(u|ip):.' OR bucket_key ~ '^d:[0-9]+$';
  END IF;

  v_payload := jsonb_build_object(
    'players', v_players,
    'answers', v_answers,
    'games',   v_games,
    'updated_at', now()
  );

  INSERT INTO public.gg_public_stats_cache (id, payload, computed_at)
  VALUES (1, v_payload, now())
  ON CONFLICT (id) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  RETURN v_payload;
END;
$fn$;

REVOKE ALL ON FUNCTION public.gg_public_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gg_public_stats() TO anon, authenticated, service_role;
