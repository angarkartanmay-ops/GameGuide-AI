-- ===========================================================================
--  2026-10-28 — the Base plan, and PayPal as a payment rail.
--  Run AFTER 20261006_billing_providers.sql. Idempotent.
--
--  1. The Base tier's limits. Base sits between Free and Pro on the same
--     free model mesh: more messages, screenshots and memory than Free, never
--     queued when the free pool is full — but no paid model on deep
--     questions, which is what Pro pays for.
--  2. gg_discord_quota_check() must treat 'base' as a personal plan. That
--     function lives in schema-v3.sql: RE-RUN schema-v3.sql (it is
--     idempotent) BEFORE this file. From then on any personal tier with a row
--     here is honoured, so the next plan needs no function change.
--
--  PayPal needs no schema: its entitlements carry source 'paypal' and
--  provider refs prefixed 'pp:' in the existing tables.
-- ===========================================================================

INSERT INTO public.discord_quota_tiers
  (tier, label, msgs_day, burst_min, vision_day, imagegen_day, guild_pool_day, history_len, context_turns, priority, soft_cap_day) VALUES
  ('base', 'Base', 60, 10, 10, 5, NULL, 25, 12, TRUE, NULL)
ON CONFLICT (tier) DO UPDATE SET
  label = EXCLUDED.label, msgs_day = EXCLUDED.msgs_day, burst_min = EXCLUDED.burst_min,
  vision_day = EXCLUDED.vision_day, imagegen_day = EXCLUDED.imagegen_day,
  guild_pool_day = EXCLUDED.guild_pool_day, history_len = EXCLUDED.history_len,
  context_turns = EXCLUDED.context_turns, priority = EXCLUDED.priority,
  soft_cap_day = EXCLUDED.soft_cap_day;
