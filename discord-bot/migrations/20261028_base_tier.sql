-- ===========================================================================
--  2026-10-28 — the Base plan.
--  Run AFTER 20261006_billing_providers.sql. Idempotent. Paste the whole file
--  into Supabase → SQL Editor → Run. Nothing else is needed.
--
--  1. gg_discord_quota_check() treats any personal tier with a row in
--     discord_quota_tiers as a paid personal plan (it used to list only 'pro'
--     and 'lifetime'), so Base — and any later plan — is just a row. The
--     function is patched in place: one condition changes, nothing else.
--  2. The Base tier's limits. Base sits between Free and Pro on the same free
--     model mesh: more messages, screenshots and memory than Free, never
--     queued when the free pool is full — but no paid model on deep
--     questions, which is what Pro pays for.
--
--  PayPal needs no schema: its entitlements carry source 'paypal' and
--  provider refs prefixed 'pp:' in the existing tables.
-- ===========================================================================

DO $$
DECLARE
  d text;
  old_test text := 'IF v_user_tier IN (''pro'', ''lifetime'') THEN';
  new_test text := 'IF v_user_tier NOT IN (''free'', ''server'')';
BEGIN
  SELECT pg_get_functiondef('public.gg_discord_quota_check(bigint,bigint,text,boolean)'::regprocedure) INTO d;
  IF position(new_test in d) > 0 THEN
    RETURN;                                   -- already patched (or a fresh schema-v3.sql)
  END IF;
  IF position(old_test in d) = 0 THEN
    RAISE EXCEPTION 'gg_discord_quota_check is not the version this migration expects — re-run schema-v3.sql instead';
  END IF;
  EXECUTE replace(d, old_test,
    'IF v_user_tier NOT IN (''free'', ''server'') AND EXISTS (SELECT 1 FROM public.discord_quota_tiers t WHERE t.tier = v_user_tier) THEN');
END $$;

INSERT INTO public.discord_quota_tiers
  (tier, label, msgs_day, burst_min, vision_day, imagegen_day, guild_pool_day, history_len, context_turns, priority, soft_cap_day) VALUES
  ('base', 'Base', 60, 10, 10, 5, NULL, 25, 12, TRUE, NULL)
ON CONFLICT (tier) DO UPDATE SET
  label = EXCLUDED.label, msgs_day = EXCLUDED.msgs_day, burst_min = EXCLUDED.burst_min,
  vision_day = EXCLUDED.vision_day, imagegen_day = EXCLUDED.imagegen_day,
  guild_pool_day = EXCLUDED.guild_pool_day, history_len = EXCLUDED.history_len,
  context_turns = EXCLUDED.context_turns, priority = EXCLUDED.priority,
  soft_cap_day = EXCLUDED.soft_cap_day;

-- Shows 'base' and 'patched' when it worked.
SELECT (SELECT string_agg(tier, ', ' ORDER BY tier) FROM public.discord_quota_tiers) AS tiers,
       CASE WHEN position('NOT IN (''free'', ''server'')' in pg_get_functiondef('public.gg_discord_quota_check(bigint,bigint,text,boolean)'::regprocedure)) > 0
            THEN 'patched' ELSE 'NOT patched' END AS quota_function;
