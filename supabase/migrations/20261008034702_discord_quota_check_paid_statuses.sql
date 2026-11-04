CREATE OR REPLACE FUNCTION public.gg_discord_quota_check(
  p_user_id  BIGINT,
  p_guild_id BIGINT DEFAULT NULL,
  p_kind     TEXT   DEFAULT 'chat',
  p_dry_run  BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_kind        TEXT := COALESCE(NULLIF(p_kind, ''), 'chat');
  v_day_start   TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_reset_at    TIMESTAMPTZ;
  v_retry_day   INT;
  v_user_tier   TEXT := 'free';
  v_guild_prem  BOOLEAN := FALSE;
  v_tier        TEXT;
  v_t           public.discord_quota_tiers%ROWTYPE;
  v_min         INT;
  v_day         INT;
  v_vision      INT;
  v_imagegen    INT;
  v_guild_day   INT := 0;
  v_global_day  INT := 0;
  v_global_cap  INT;
  v_bonus       INT := 0;
  v_bonus_id    BIGINT;
  v_allow       BOOLEAN := TRUE;
  v_scope       TEXT    := NULL;
  v_retry       INT     := 0;
  v_used_bonus  BOOLEAN := FALSE;
BEGIN
  IF v_kind NOT IN ('chat', 'vision', 'image_gen') THEN
    v_kind := 'chat';
  END IF;

  v_reset_at  := v_day_start + INTERVAL '1 day';
  v_retry_day := GREATEST(CEIL(EXTRACT(EPOCH FROM (v_reset_at - now())))::INT, 1);

  SELECT e.tier INTO v_user_tier
    FROM public.discord_entitlements e
   WHERE e.user_id = p_user_id
     -- past_due keeps access while the provider retries the card; 'ending' =
     -- cancelled but paid up. Both only until current_period_end.
     AND e.status IN ('active', 'past_due', 'ending')
     AND (e.current_period_end IS NULL OR e.current_period_end > now())
   LIMIT 1;
  v_user_tier := COALESCE(v_user_tier, 'free');

  IF p_guild_id IS NOT NULL THEN
    SELECT TRUE INTO v_guild_prem
      FROM public.discord_premium_servers s
     WHERE s.guild_id = p_guild_id
       AND (s.expires_at IS NULL OR s.expires_at > now())
     LIMIT 1;
  END IF;
  v_guild_prem := COALESCE(v_guild_prem, FALSE);

  IF v_user_tier IN ('pro', 'lifetime') THEN
    v_tier := v_user_tier;
  ELSIF v_guild_prem THEN
    v_tier := 'server';
  ELSE
    v_tier := 'free';
  END IF;

  SELECT * INTO v_t FROM public.discord_quota_tiers WHERE tier = v_tier;
  IF NOT FOUND THEN
    SELECT * INTO v_t FROM public.discord_quota_tiers WHERE tier = 'free';
  END IF;

  SELECT
    count(*) FILTER (WHERE created_at > now() - INTERVAL '1 minute'),
    count(*),
    count(*) FILTER (WHERE kind = 'vision'),
    count(*) FILTER (WHERE kind = 'image_gen')
  INTO v_min, v_day, v_vision, v_imagegen
  FROM public.discord_usage_events
  WHERE user_id = p_user_id
    AND created_at >= v_day_start;

  SELECT COALESCE(sum(credits), 0) INTO v_bonus
    FROM public.discord_bonus_credits
   WHERE user_id = p_user_id AND expires_at > now() AND credits > 0;

  IF v_tier = 'server' AND p_guild_id IS NOT NULL THEN
    SELECT count(*) INTO v_guild_day
      FROM public.discord_usage_events
     WHERE guild_id = p_guild_id AND created_at >= v_day_start;
  END IF;

  SELECT int_value INTO v_global_cap
    FROM public.discord_quota_config WHERE key = 'global_daily_cap';
  v_global_cap := COALESCE(v_global_cap, 3000);

  IF v_tier = 'free' THEN
    SELECT count(*) INTO v_global_day
      FROM public.discord_usage_events WHERE created_at >= v_day_start;
  END IF;

  IF v_day >= v_t.msgs_day THEN
    IF v_bonus > 0 THEN
      v_used_bonus := TRUE;
    ELSE
      v_allow := FALSE; v_scope := 'day'; v_retry := v_retry_day;
    END IF;
  END IF;

  IF v_allow AND v_kind = 'vision' AND v_vision >= v_t.vision_day THEN
    v_allow := FALSE; v_scope := 'vision'; v_retry := v_retry_day; v_used_bonus := FALSE;
  END IF;

  IF v_allow AND v_kind = 'image_gen' AND v_imagegen >= v_t.imagegen_day THEN
    v_allow := FALSE; v_scope := 'image_gen'; v_retry := v_retry_day; v_used_bonus := FALSE;
  END IF;

  IF v_allow AND v_tier = 'server' AND v_t.guild_pool_day IS NOT NULL
     AND v_guild_day >= v_t.guild_pool_day THEN
    v_allow := FALSE; v_scope := 'guild'; v_retry := v_retry_day; v_used_bonus := FALSE;
  END IF;

  IF v_allow AND v_tier = 'free' AND v_global_day >= v_global_cap THEN
    v_allow := FALSE; v_scope := 'capacity'; v_retry := v_retry_day; v_used_bonus := FALSE;
  END IF;

  IF v_allow AND v_min >= v_t.burst_min THEN
    v_allow := FALSE; v_scope := 'minute'; v_retry := 60; v_used_bonus := FALSE;
  END IF;

  IF v_allow AND NOT p_dry_run THEN
    IF v_used_bonus THEN
      SELECT id INTO v_bonus_id
        FROM public.discord_bonus_credits
       WHERE user_id = p_user_id AND expires_at > now() AND credits > 0
       ORDER BY expires_at ASC
       LIMIT 1
         FOR UPDATE SKIP LOCKED;

      IF v_bonus_id IS NULL THEN
        RETURN jsonb_build_object(
          'allowed', FALSE, 'tier', v_tier, 'tier_label', v_t.label,
          'scope', 'day', 'retry_after', v_retry_day,
          'reset_at', to_char(v_reset_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'used_bonus', FALSE,
          'messages',  jsonb_build_object('used', v_day, 'limit', v_t.msgs_day, 'remaining', 0),
          'vision',    jsonb_build_object('used', v_vision, 'limit', v_t.vision_day, 'remaining', GREATEST(v_t.vision_day - v_vision, 0)),
          'image_gen', jsonb_build_object('used', v_imagegen, 'limit', v_t.imagegen_day, 'remaining', GREATEST(v_t.imagegen_day - v_imagegen, 0)),
          'burst',     jsonb_build_object('used', v_min, 'limit', v_t.burst_min),
          'bonus_credits', 0,
          'guild', CASE WHEN v_tier = 'server'
                        THEN jsonb_build_object('used', v_guild_day, 'limit', v_t.guild_pool_day)
                        ELSE NULL END,
          'limits', jsonb_build_object(
            'history_len', v_t.history_len, 'context_turns', v_t.context_turns,
            'priority', v_t.priority, 'soft_capped', FALSE, 'soft_cap_day', v_t.soft_cap_day)
        );
      END IF;

      UPDATE public.discord_bonus_credits
         SET credits = credits - 1
       WHERE id = v_bonus_id;
      v_bonus := v_bonus - 1;
    END IF;

    INSERT INTO public.discord_usage_events (user_id, guild_id, kind, used_bonus)
    VALUES (p_user_id, p_guild_id, v_kind, v_used_bonus);

    v_min := v_min + 1;
    v_day := v_day + 1;
    IF v_kind = 'vision'    THEN v_vision   := v_vision   + 1; END IF;
    IF v_kind = 'image_gen' THEN v_imagegen := v_imagegen + 1; END IF;
    IF v_tier = 'server'    THEN v_guild_day := v_guild_day + 1; END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed',     v_allow,
    'tier',        v_tier,
    'tier_label',  v_t.label,
    'scope',       v_scope,
    'retry_after', v_retry,
    'reset_at',    to_char(v_reset_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'used_bonus',  v_used_bonus,
    'messages',  jsonb_build_object('used', v_day,      'limit', v_t.msgs_day,     'remaining', GREATEST(v_t.msgs_day     - v_day,      0)),
    'vision',    jsonb_build_object('used', v_vision,   'limit', v_t.vision_day,   'remaining', GREATEST(v_t.vision_day   - v_vision,   0)),
    'image_gen', jsonb_build_object('used', v_imagegen, 'limit', v_t.imagegen_day, 'remaining', GREATEST(v_t.imagegen_day - v_imagegen, 0)),
    'burst',     jsonb_build_object('used', v_min,      'limit', v_t.burst_min),
    'bonus_credits', v_bonus,
    'guild', CASE WHEN v_tier = 'server'
                  THEN jsonb_build_object('used', v_guild_day, 'limit', v_t.guild_pool_day)
                  ELSE NULL END,
    'limits', jsonb_build_object(
      'history_len',   v_t.history_len,
      'context_turns', v_t.context_turns,
      'priority',      v_t.priority,
      'soft_capped',   (v_t.soft_cap_day IS NOT NULL AND v_day > v_t.soft_cap_day),
      'soft_cap_day',  v_t.soft_cap_day)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.gg_discord_quota_check(BIGINT, BIGINT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gg_discord_quota_check(BIGINT, BIGINT, TEXT, BOOLEAN) TO service_role;;
