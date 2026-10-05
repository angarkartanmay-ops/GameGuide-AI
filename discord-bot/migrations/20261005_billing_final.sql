-- ===========================================================================
--  2026-10-05 — Final tiers, Pro Lifetime, and billing hardening.
--  Run AFTER re-running schema-v3.sql (safe to re-run: it only creates what is
--  missing and replaces functions). Idempotent itself.
--
--  1. Tier limits, final. UPSERT with DO UPDATE so these numbers win over
--     whatever an earlier run left behind. Prices live in discord-bot/plans.js
--     (the webhook checks them); limits live here.
--  2. Server plans remember their Stripe subscription, so renewals extend them
--     and cancellations end them. Before this a server plan expired after its
--     first month even while it kept renewing.
--  3. discord_billing_events: every Stripe event id is claimed once, so
--     retries and replays cannot apply a grant twice. Also the audit trail.
--  4. discord_usage_stats was readable by anyone with the public anon key —
--     every Discord user id with its activity times. The public counter reads
--     it through a SECURITY DEFINER function, so the policy is not needed.
-- ===========================================================================

-- 1. Tiers --------------------------------------------------------------------
--                                     msgs burst vision img  pool  hist ctx  prio  soft
INSERT INTO public.discord_quota_tiers
  (tier, label, msgs_day, burst_min, vision_day, imagegen_day, guild_pool_day, history_len, context_turns, priority, soft_cap_day) VALUES
  ('free',     'Free',            15,   5,    3,    1,  NULL,  10,  6, FALSE, NULL),
  ('pro',      'Pro',            200,  20,   40,   15,  NULL,  50, 24, TRUE,   120),
  ('lifetime', 'Pro Lifetime',   200,  20,   40,   15,  NULL,  50, 24, TRUE,   120),
  ('server',   'Premium Server',  60,  10,   10,    5,   800,  25, 12, TRUE,  NULL)
ON CONFLICT (tier) DO UPDATE SET
  label = EXCLUDED.label, msgs_day = EXCLUDED.msgs_day, burst_min = EXCLUDED.burst_min,
  vision_day = EXCLUDED.vision_day, imagegen_day = EXCLUDED.imagegen_day,
  guild_pool_day = EXCLUDED.guild_pool_day, history_len = EXCLUDED.history_len,
  context_turns = EXCLUDED.context_turns, priority = EXCLUDED.priority,
  soft_cap_day = EXCLUDED.soft_cap_day;

-- 2. Server plans track their subscription ------------------------------------
ALTER TABLE public.discord_premium_servers ADD COLUMN IF NOT EXISTS provider_ref TEXT;
CREATE INDEX IF NOT EXISTS discord_premium_servers_ref_idx
  ON public.discord_premium_servers (provider_ref) WHERE provider_ref IS NOT NULL;

-- 3. Webhook idempotency + audit ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.discord_billing_events (
  event_id    TEXT PRIMARY KEY CHECK (char_length(event_id) <= 255),
  type        TEXT NOT NULL CHECK (char_length(type) <= 100),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.discord_billing_events ENABLE ROW LEVEL SECURITY;   -- service role only

-- 4. Close the per-user stats read --------------------------------------------
DROP POLICY IF EXISTS "Public can read aggregate usage" ON public.discord_usage_stats;

-- Belt and braces: nothing Discord-side is writable or readable by anon or
-- signed-in web users except the public tier table. RLS already denies it;
-- this removes the table privileges as well.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'discord_chat_messages','discord_premium','discord_premium_servers','discord_usage_stats',
    'discord_votes','discord_quota_config','discord_entitlements','discord_bonus_credits',
    'discord_usage_events','discord_spoiler_prefs','discord_watches','discord_watch_posts',
    'discord_billing_events'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.discord_quota_tiers FROM anon, authenticated;
GRANT SELECT ON public.discord_quota_tiers TO anon, authenticated;   -- public pricing page
