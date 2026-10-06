-- ===========================================================================
--  2026-10-06 — Razorpay and Lemon Squeezy alongside Stripe.
--  Run AFTER 20261005_billing_final.sql. Idempotent.
--
--  1. discord_billing_events gains `completed_at`. An event is claimed when it
--     arrives and completed when its work is done; a claim that never
--     completes (the bot restarted mid-handler) goes stale after five minutes
--     and the provider's next retry takes it over, so a paid grant is never
--     lost to a crash. Rows from before this column existed finished long ago.
--  2. A prune function for that table (events older than 180 days are only
--     history; webhook replay windows are days, not months).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.discord_billing_events (
  event_id    TEXT PRIMARY KEY CHECK (char_length(event_id) <= 255),
  type        TEXT NOT NULL CHECK (char_length(type) <= 100),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.discord_billing_events ENABLE ROW LEVEL SECURITY;   -- service role only

ALTER TABLE public.discord_billing_events ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
UPDATE public.discord_billing_events SET completed_at = received_at WHERE completed_at IS NULL;

REVOKE ALL ON public.discord_billing_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.gg_discord_prune_billing_events()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_n INT;
BEGIN
  DELETE FROM public.discord_billing_events WHERE received_at < now() - INTERVAL '180 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.gg_discord_prune_billing_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gg_discord_prune_billing_events() TO service_role;
-- Schedule with the others in Supabase → Database → Cron (daily):
--   SELECT public.gg_discord_prune_billing_events();
