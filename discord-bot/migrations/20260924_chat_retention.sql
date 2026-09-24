-- 2026-09-24 — Discord chat retention + server-side /stats aggregate.
--
-- Applied to the live project with: supabase db query --linked -f <this file>
-- Kept out of supabase/migrations because the Discord schema is managed from
-- discord-bot/*.sql; the bodies below are sliced verbatim from schema-v3.sql,
-- which remains the source of truth for a fresh install.
--
-- Idempotent: CREATE OR REPLACE plus REVOKE/GRANT, safe to re-run.
CREATE OR REPLACE FUNCTION public.gg_discord_prune()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_total INT := 0;
  v_n     INT;
BEGIN
  -- Keep 3 days: one for the live window, two so /stats and any usage
  -- investigation have yesterday to look at.
  DELETE FROM public.discord_usage_events WHERE created_at < now() - INTERVAL '3 days';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  DELETE FROM public.discord_bonus_credits WHERE expires_at < now() - INTERVAL '1 day';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  -- Chat retention. Every message anyone sent the bot used to be kept forever,
  -- yet the bot only ever READS the newest 50 per user (the largest tier's
  -- history_len, and /history's display cap). Everything older was pure
  -- liability: stored personal text with no function, and unbounded growth
  -- toward the free tier's database cap. The privacy policy states these
  -- limits, so they must hold: 90 days, and the newest 50 per user.
  DELETE FROM public.discord_chat_messages
   WHERE created_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  DELETE FROM public.discord_chat_messages m
   USING (
     SELECT id FROM (
       SELECT id,
              row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
         FROM public.discord_chat_messages
     ) ranked
     WHERE ranked.rn > 50
   ) excess
   WHERE m.id = excess.id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  RETURN v_total;
END;
$fn$;


-- /stats global totals, aggregated in Postgres. The bot previously selected
-- every row and summed client-side, which PostgREST silently caps at max_rows
-- (1000) — the "users" figure would have frozen at 1,000.
CREATE OR REPLACE FUNCTION public.gg_discord_global_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'users',  count(*),
    'total',  coalesce(sum(total_calls), 0),
    'vision', coalesce(sum(vision_calls), 0)
  )
  FROM public.discord_usage_stats;
$fn$;

REVOKE ALL ON FUNCTION public.gg_discord_prune()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gg_discord_global_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gg_discord_prune()        TO service_role;
GRANT EXECUTE ON FUNCTION public.gg_discord_global_stats() TO service_role;
