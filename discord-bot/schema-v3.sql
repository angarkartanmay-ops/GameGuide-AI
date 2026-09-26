-- ===========================================================================
--  GameGuide-AI :: Discord Bot Schema v3 - Freemium Quota Engine
--  -----------------------------------------------------------------------
--  Run ONCE in your Supabase SQL Editor, AFTER schema.sql.
--  Additive and idempotent: every existing table keeps working.
--
--  Why this exists
--  ---------------
--  Quota used to live in a per-process in-memory Map inside the bot, which
--  meant it reset on every restart (free hosts restart constantly), could not
--  be shared across instances, and had no daily cap at all - only a 60-second
--  window. Meanwhile the edge function enforced its own, different limits, so
--  a paying Pro user was capped below what they had paid for.
--
--  This migration makes Postgres the single source of truth for PRODUCT quota.
--  The edge function's own limiter stays, demoted to an infrastructure ceiling.
--
--  Creates:
--    - discord_quota_config     : global knobs (platform daily ceiling)
--    - discord_quota_tiers      : the tier table as DATA, tunable with UPDATE
--    - discord_entitlements     : provider-agnostic paid status (Stripe today,
--                                 Discord SKUs later) - replaces discord_premium
--    - discord_bonus_credits    : Top.gg vote rewards. Deliberately NOT a tier.
--    - discord_usage_events     : append-only admission log
--    - gg_discord_quota_check() : atomic check-and-record, one round trip
--    - gg_discord_grant_bonus() : capped bonus-credit grant
--    - gg_discord_prune()       : housekeeping (schedule via Supabase Cron)
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  CONFIG - global knobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discord_quota_config (
  key        TEXT PRIMARY KEY,
  int_value  INT  NOT NULL,
  note       TEXT
);

-- The platform-wide ceiling. Derived from summed provider budgets
-- (Gemini rotation + Groq + Cerebras + OpenRouter) divided by ~1.3 LLM calls
-- per user turn, with headroom reserved for retries and the web app.
-- Only the FREE tier is blocked by this; paying users are never turned away.
INSERT INTO public.discord_quota_config (key, int_value, note) VALUES
  ('global_daily_cap', 3000, 'Platform-wide Discord turns/day. Free tier blocks here; paid tiers pass.')
ON CONFLICT (key) DO NOTHING;


-- ---------------------------------------------------------------------------
--  TIERS - the pricing table as rows, not constants.
--  The first month of live traffic will prove one of these numbers wrong.
--  Tuning must be an UPDATE, not a redeploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discord_quota_tiers (
  tier           TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  msgs_day       INT  NOT NULL,   -- every turn costs 1, whatever the kind
  burst_min      INT  NOT NULL,   -- sliding 60s window, anti-spam only
  vision_day     INT  NOT NULL,   -- screenshots also cost 1 message
  imagegen_day   INT  NOT NULL,
  guild_pool_day INT,             -- server tier only: shared ceiling for the guild
  history_len    INT  NOT NULL,   -- rows retained/read from discord_chat_messages
  context_turns  INT  NOT NULL,   -- turns forwarded to the model (server max is 24)
  priority       BOOLEAN NOT NULL DEFAULT FALSE,
  soft_cap_day   INT              -- past this, route to free models only (margin guard)
);

INSERT INTO public.discord_quota_tiers
  (tier, label, msgs_day, burst_min, vision_day, imagegen_day, guild_pool_day, history_len, context_turns, priority, soft_cap_day) VALUES
  ('free',     'Free',            15,  5,  3,  1, NULL, 10,  6, FALSE, NULL),
  ('pro',      'Pro',            200, 20, 40, 15, NULL, 50, 24, TRUE,   120),
  ('lifetime', 'Pro (Lifetime)', 200, 20, 40, 15, NULL, 50, 24, TRUE,   120),
  ('server',   'Premium Server',  60, 10, 10,  5,  800, 25, 12, TRUE,  NULL)
ON CONFLICT (tier) DO NOTHING;


-- ---------------------------------------------------------------------------
--  ENTITLEMENTS - provider-agnostic paid status.
--  No CHECK constraint on tier/source: adding a tier or a payment rail must
--  not require a migration (the old discord_premium.tier CHECK did).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discord_entitlements (
  user_id             BIGINT PRIMARY KEY,
  tier                TEXT        NOT NULL DEFAULT 'free',
  source              TEXT        NOT NULL DEFAULT 'manual',  -- manual|stripe|discord_sku|patreon|kofi
  provider_ref        TEXT,                                   -- stripe subscription id / discord entitlement id
  status              TEXT        NOT NULL DEFAULT 'active',  -- active|past_due|canceled
  current_period_end  TIMESTAMPTZ,
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discord_entitlements_ref_idx
  ON public.discord_entitlements (provider_ref);

-- Backfill from the old table - MANUAL rows only.
-- topgg-vote rows are deliberately dropped: granting a tier for a vote is what
-- let anyone hold permanent free Pro by voting twice a day.
INSERT INTO public.discord_entitlements (user_id, tier, source, status, current_period_end, granted_at)
SELECT user_id, tier, source, 'active', expires_at, granted_at
  FROM public.discord_premium
 WHERE source <> 'topgg-vote'
ON CONFLICT (user_id) DO NOTHING;


-- ---------------------------------------------------------------------------
--  BONUS CREDITS - where Top.gg votes go now.
--  Consumed BEFORE the daily allowance so a bonus feels like a real bonus.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discord_bonus_credits (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL,
  credits     INT         NOT NULL CHECK (credits >= 0),
  source      TEXT        NOT NULL DEFAULT 'topgg-vote',
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS discord_bonus_user_exp_idx
  ON public.discord_bonus_credits (user_id, expires_at)
  WHERE credits > 0;


-- ---------------------------------------------------------------------------
--  USAGE EVENTS - append-only admission log.
--  Same shape as gg_usage_events, but keyed to Discord and carrying guild_id
--  so a guild pool can be enforced in the same round trip.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discord_usage_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL,
  guild_id    BIGINT,
  kind        TEXT        NOT NULL DEFAULT 'chat',   -- chat|vision|image_gen
  used_bonus  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discord_usage_user_time_idx
  ON public.discord_usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS discord_usage_guild_time_idx
  ON public.discord_usage_events (guild_id, created_at DESC)
  WHERE guild_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS discord_usage_time_idx
  ON public.discord_usage_events (created_at);


-- ---------------------------------------------------------------------------
--  SPOILER SHIELD - where each player is in each game, and whether they want
--  the shield at all. Sent to chat-proxy as prompt context on every turn so a
--  player says "I just beat Margit" once and stays shielded across sessions.
--  progress: {"elden ring": "beat Margit", ...}  (lower-cased game keys)
--  /clear deletes the row along with chat history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discord_spoiler_prefs (
  user_id     BIGINT PRIMARY KEY,
  mode        TEXT NOT NULL DEFAULT 'shield' CHECK (mode IN ('shield', 'off')),
  progress    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
--  WATCHTOWER - patch-note and deal alerts posted into server channels.
--  Server configuration, not personal data: no user ids. Rows go when the
--  watch is removed, its channel is deleted or the bot leaves the server.
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
--  ROW LEVEL SECURITY
--  Every table here is written by the bot with the service role, which bypasses
--  RLS. Enabling it with no policies therefore denies everyone else by default.
--  The tier table is the one exception: it is public pricing, safe to read.
-- ---------------------------------------------------------------------------
ALTER TABLE public.discord_quota_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_quota_tiers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_entitlements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_bonus_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_usage_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_spoiler_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_watches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_watch_posts   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read tier pricing" ON public.discord_quota_tiers;
CREATE POLICY "Public can read tier pricing"
  ON public.discord_quota_tiers FOR SELECT TO anon USING (TRUE);


-- ===========================================================================
--  gg_discord_quota_check - atomic check-and-record, ONE round trip.
--  -----------------------------------------------------------------------
--  Resolves entitlement, picks the tier's limits, spends bonus credits first,
--  evaluates every window, and inserts an event ONLY on admission.
--
--  Counting BEFORE inserting means the caller's own request is not included in
--  the comparison, so a limit of N allows exactly N. Not charging a blocked
--  caller means they cannot extend their own penalty by hammering the bot.
--
--  Daily windows are CALENDAR days at 00:00 UTC, not a sliding 24h window.
--  A sliding window drip-feeds quota back and is impossible to explain; a fixed
--  reset lets the bot say "resets in 4 hours" and be believed. The 60-second
--  burst window stays sliding - that one is pure anti-spam.
-- ===========================================================================
--  p_dry_run evaluates everything and records nothing. /quota reads through the
--  SAME function that enforces, so the number shown and the number enforced can
--  never drift - and asking "how much is left?" must not itself cost a message.
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

  -- -- Entitlement ---------------------------------------------------------
  SELECT e.tier INTO v_user_tier
    FROM public.discord_entitlements e
   WHERE e.user_id = p_user_id
     AND e.status = 'active'
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

  -- An individually-paying user keeps their own (larger) allowance and does
  -- NOT draw from the guild pool - they bought that separately.
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

  -- -- Counters ------------------------------------------------------------
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

  -- -- Decision ------------------------------------------------------------
  -- Ordered by how USEFUL the answer is, longest-lasting limit first, with the
  -- 60-second burst window checked LAST.
  --
  -- The tempting order is cheapest-signal-first, so that "wait a minute" beats
  -- "come back tomorrow". That is actively misleading for anyone who is both
  -- out of messages and typing fast: they are told to wait 60 seconds, they
  -- wait, they retry, and only then learn they were done for the day. Reporting
  -- the daily wall first costs nothing and is the fact they actually need.

  -- 1. Daily allowance, with bonus credits as the fallback before refusing.
  IF v_day >= v_t.msgs_day THEN
    IF v_bonus > 0 THEN
      v_used_bonus := TRUE;
    ELSE
      v_allow := FALSE; v_scope := 'day'; v_retry := v_retry_day;
    END IF;
  END IF;

  -- 2. Per-kind sub-caps. Being out of screenshots is worth saying even when
  --    the caller is also bursting.
  IF v_allow AND v_kind = 'vision' AND v_vision >= v_t.vision_day THEN
    v_allow := FALSE; v_scope := 'vision'; v_retry := v_retry_day; v_used_bonus := FALSE;
  END IF;

  IF v_allow AND v_kind = 'image_gen' AND v_imagegen >= v_t.imagegen_day THEN
    v_allow := FALSE; v_scope := 'image_gen'; v_retry := v_retry_day; v_used_bonus := FALSE;
  END IF;

  -- 3. Shared guild pool.
  IF v_allow AND v_tier = 'server' AND v_t.guild_pool_day IS NOT NULL
     AND v_guild_day >= v_t.guild_pool_day THEN
    v_allow := FALSE; v_scope := 'guild'; v_retry := v_retry_day; v_used_bonus := FALSE;
  END IF;

  -- 4. Platform at capacity. Free waits; paid tiers never reach this branch.
  IF v_allow AND v_tier = 'free' AND v_global_day >= v_global_cap THEN
    v_allow := FALSE; v_scope := 'capacity'; v_retry := v_retry_day; v_used_bonus := FALSE;
  END IF;

  -- 5. Burst, last: the most transient limit and the least informative.
  IF v_allow AND v_min >= v_t.burst_min THEN
    v_allow := FALSE; v_scope := 'minute'; v_retry := 60; v_used_bonus := FALSE;
  END IF;

  -- -- Record --------------------------------------------------------------
  IF v_allow AND NOT p_dry_run THEN
    IF v_used_bonus THEN
      -- Spend the soonest-expiring credit first so grants are used before they lapse.
      SELECT id INTO v_bonus_id
        FROM public.discord_bonus_credits
       WHERE user_id = p_user_id AND expires_at > now() AND credits > 0
       ORDER BY expires_at ASC
       LIMIT 1
         FOR UPDATE SKIP LOCKED;

      IF v_bonus_id IS NULL THEN
        -- Raced with another request that took the last credit. Refuse rather
        -- than serve a turn nobody paid for.
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
      -- Past the soft cap a paying user still gets every answer, just from the
      -- free model pool. Protects margin on the rare outlier without a hard wall.
      'soft_capped',   (v_t.soft_cap_day IS NOT NULL AND v_day > v_t.soft_cap_day),
      'soft_cap_day',  v_t.soft_cap_day)
  );
END;
$fn$;


-- ===========================================================================
--  gg_discord_grant_bonus - Top.gg vote reward.
--  Grants CREDITS, never a tier. Capped, so the reward cannot be farmed into
--  a permanent free Pro subscription.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.gg_discord_grant_bonus(
  p_user_id  BIGINT,
  p_credits  INT  DEFAULT 10,
  p_hours    INT  DEFAULT 24,
  p_cap      INT  DEFAULT 20,
  p_source   TEXT DEFAULT 'topgg-vote'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_current INT;
  v_grant   INT;
BEGIN
  SELECT COALESCE(sum(credits), 0) INTO v_current
    FROM public.discord_bonus_credits
   WHERE user_id = p_user_id AND expires_at > now() AND credits > 0;

  v_grant := LEAST(GREATEST(p_credits, 0), GREATEST(p_cap - v_current, 0));

  IF v_grant > 0 THEN
    INSERT INTO public.discord_bonus_credits (user_id, credits, source, expires_at)
    VALUES (p_user_id, v_grant, p_source, now() + make_interval(hours => GREATEST(p_hours, 1)));
  END IF;

  RETURN jsonb_build_object(
    'granted', v_grant,
    'balance', v_current + v_grant,
    'cap',     p_cap,
    'capped',  v_grant < GREATEST(p_credits, 0)
  );
END;
$fn$;


-- ===========================================================================
--  HOUSEKEEPING
--  Scheduled in Supabase -> Database -> Cron (daily, 03:00 UTC):
--    SELECT public.gg_discord_prune();
--    SELECT public.gg_prune_usage_events();
-- ===========================================================================
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


-- ===========================================================================
--  GRANTS - SECURITY DEFINER functions are exposed as PostgREST RPC by
--  default. Close that: only the service role (the bot) may call them.
--  Mirrors the hardening at the end of 20260813_mesh_v3.sql.
-- ===========================================================================
REVOKE ALL ON FUNCTION public.gg_discord_quota_check(BIGINT, BIGINT, TEXT, BOOLEAN)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gg_discord_grant_bonus(BIGINT, INT, INT, INT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gg_discord_prune()                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gg_discord_global_stats()                           FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.gg_discord_quota_check(BIGINT, BIGINT, TEXT, BOOLEAN)        TO service_role;
GRANT EXECUTE ON FUNCTION public.gg_discord_grant_bonus(BIGINT, INT, INT, INT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.gg_discord_prune()                                  TO service_role;
GRANT EXECUTE ON FUNCTION public.gg_discord_global_stats()                           TO service_role;
