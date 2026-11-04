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

ALTER TABLE public.discord_premium_servers ADD COLUMN IF NOT EXISTS provider_ref TEXT;
CREATE INDEX IF NOT EXISTS discord_premium_servers_ref_idx
  ON public.discord_premium_servers (provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.discord_billing_events (
  event_id     TEXT PRIMARY KEY CHECK (char_length(event_id) <= 255),
  type         TEXT NOT NULL CHECK (char_length(type) <= 100),
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.discord_billing_events ENABLE ROW LEVEL SECURITY;

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
GRANT EXECUTE ON FUNCTION public.gg_discord_prune_billing_events() TO service_role;;
