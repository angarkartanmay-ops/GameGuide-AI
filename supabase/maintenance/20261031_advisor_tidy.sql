-- ===========================================================================
--  2026-10-31 — clear the two Supabase security-advisor warnings that are
--  ours to fix. Optional, idempotent, changes no behaviour.
--  Paste into Supabase → SQL Editor → Run.
--
--  1. rls_auto_enable() is the event-trigger function that switches RLS on
--     for every new table. It runs from the trigger, never from the API, but
--     sits in `public`, so the REST API exposes it to anon and signed-in
--     users (calling it there only errors). Take that EXECUTE away; the
--     trigger does not need it.
--  2. gg_merge_games() is a pure JSON helper with an unpinned search_path.
--     Pin it.
--
--  Left as they are, on purpose:
--  - "RLS enabled, no policy" on the discord_* / gg_* tables: those tables
--    are service-role only, and no policy means anon and signed-in users get
--    nothing.
--  - gg_public_stats() callable by anon: it is the landing page's live count
--    and returns aggregates only (20261002_public_stats.sql).
--  - Leaked-password protection: a toggle in Authentication → Settings
--    (Pro plan), not SQL.
-- ===========================================================================

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.gg_merge_games(jsonb, jsonb) SET search_path = public;

-- Shows both as fixed.
SELECT has_function_privilege('anon', 'public.rls_auto_enable()', 'execute') AS anon_can_call_rls_auto_enable,
       (SELECT proconfig FROM pg_proc WHERE proname = 'gg_merge_games') AS gg_merge_games_config;
