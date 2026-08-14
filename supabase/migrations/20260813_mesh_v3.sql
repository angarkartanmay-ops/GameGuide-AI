-- ═══════════════════════════════════════════════════════════════════════════
--  GameGuide-AI :: NEURAL MESH v3
--  Rate limiting · provider health · quota ledger · player memory
--  ───────────────────────────────────────────────────────────────────────
--  Run in the Supabase SQL editor (Dashboard → SQL Editor → New Query), or
--    supabase db push
--
--  Every table here is written ONLY by the edge function using the service
--  role key. RLS is enabled with no public policies, so the anon key cannot
--  read or write any of it. The player profile is the sole exception: users
--  may read and edit their own row.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
--  1. RATE LIMITING
--  A single append-only event log. Sliding windows are computed at read time,
--  which keeps writes contention-free and lets one table serve minute, hour
--  and day windows simultaneously.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gg_usage_events (
  id          BIGSERIAL PRIMARY KEY,
  bucket_key  TEXT        NOT NULL,          -- 'u:<auth uid>' or 'ip:<sha256 prefix>'
  kind        TEXT        NOT NULL DEFAULT 'chat'
                          CHECK (kind IN ('chat', 'vision', 'image_gen')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves every sliding-window count; created_at DESC matches the range scan.
CREATE INDEX IF NOT EXISTS gg_usage_events_bucket_time_idx
  ON public.gg_usage_events (bucket_key, created_at DESC);
CREATE INDEX IF NOT EXISTS gg_usage_events_time_idx
  ON public.gg_usage_events (created_at);

ALTER TABLE public.gg_usage_events ENABLE ROW LEVEL SECURITY;
-- No policies: service role bypasses RLS, everyone else is denied.


-- Atomic check-and-record. Returns the decision plus the counts that drove it
-- so the edge function can surface accurate Retry-After / quota headers.
--
-- Counting BEFORE inserting means the caller's own request is not included in
-- the comparison, so a limit of N allows exactly N requests per window.
CREATE OR REPLACE FUNCTION public.gg_check_rate_limit(
  p_bucket     TEXT,
  p_kind       TEXT DEFAULT 'chat',
  p_limit_min  INT  DEFAULT 12,
  p_limit_hour INT  DEFAULT 120,
  p_limit_day  INT  DEFAULT 600,
  -- How many slots this request consumes. A vision turn runs OCR plus a HUD
  -- crop plus possibly a second-opinion model, and image generation is costlier
  -- still, so they must not bill the same as a one-shot text reply.
  p_weight     INT  DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min    INT;
  v_hour   INT;
  v_day    INT;
  v_allow  BOOLEAN;
  v_scope  TEXT := NULL;
  v_retry  INT  := 0;
  v_weight INT  := GREATEST(COALESCE(p_weight, 1), 1);
BEGIN
  SELECT
    count(*) FILTER (WHERE created_at > now() - INTERVAL '1 minute'),
    count(*) FILTER (WHERE created_at > now() - INTERVAL '1 hour'),
    count(*) FILTER (WHERE created_at > now() - INTERVAL '1 day')
  INTO v_min, v_hour, v_day
  FROM public.gg_usage_events
  WHERE bucket_key = p_bucket
    AND created_at > now() - INTERVAL '1 day';

  IF v_min >= p_limit_min THEN
    v_allow := FALSE; v_scope := 'minute'; v_retry := 60;
  ELSIF v_hour >= p_limit_hour THEN
    v_allow := FALSE; v_scope := 'hour';   v_retry := 900;
  ELSIF v_day >= p_limit_day THEN
    v_allow := FALSE; v_scope := 'day';    v_retry := 3600;
  ELSE
    v_allow := TRUE;
  END IF;

  -- Only successful admissions consume quota; a blocked caller cannot extend
  -- its own penalty window by hammering the endpoint.
  IF v_allow THEN
    INSERT INTO public.gg_usage_events (bucket_key, kind)
    SELECT p_bucket, COALESCE(p_kind, 'chat')
      FROM generate_series(1, GREATEST(COALESCE(p_weight, 1), 1));
    v_min := v_min + v_weight; v_hour := v_hour + v_weight; v_day := v_day + v_weight;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allow,
    'scope',   v_scope,
    'retry_after', v_retry,
    'minute',  v_min, 'minute_limit', p_limit_min,
    'hour',    v_hour, 'hour_limit',  p_limit_hour,
    'day',     v_day,  'day_limit',   p_limit_day
  );
END;
$$;


-- Housekeeping: drop events older than the widest window. Call from a cron job
-- (Supabase → Database → Cron) e.g. every hour:
--   SELECT public.gg_prune_usage_events();
CREATE OR REPLACE FUNCTION public.gg_prune_usage_events()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted INT;
BEGIN
  DELETE FROM public.gg_usage_events
   WHERE created_at < now() - INTERVAL '2 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
--  2. PROVIDER HEALTH (circuit breaker)
--  Shared across edge-function isolates, which is the entire point: an
--  in-memory breaker is useless when every cold start forgets that a provider
--  is rate-limited and pays the timeout again.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gg_provider_health (
  provider             TEXT        NOT NULL,
  model                TEXT        NOT NULL,
  consecutive_failures INT         NOT NULL DEFAULT 0,
  cooldown_until       TIMESTAMPTZ,
  last_error           TEXT,
  last_status          INT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model)
);

ALTER TABLE public.gg_provider_health ENABLE ROW LEVEL SECURITY;

-- Record an outcome and compute the next cooldown.
-- Exponential backoff on repeated failure, capped at 30 minutes. A 429 (quota)
-- starts at a longer floor than a transient 5xx because retrying a spent quota
-- immediately is guaranteed to fail again.
CREATE OR REPLACE FUNCTION public.gg_report_provider(
  p_provider TEXT,
  p_model    TEXT,
  p_ok       BOOLEAN,
  p_status   INT  DEFAULT NULL,
  p_error    TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fails INT;
  v_base  INT;
  v_cool  INTERVAL;
BEGIN
  IF p_ok THEN
    INSERT INTO public.gg_provider_health (provider, model, consecutive_failures, cooldown_until, last_error, last_status, updated_at)
    VALUES (p_provider, p_model, 0, NULL, NULL, NULL, now())
    ON CONFLICT (provider, model) DO UPDATE
      SET consecutive_failures = 0,
          cooldown_until = NULL,
          last_error = NULL,
          last_status = NULL,
          updated_at = now();
    RETURN;
  END IF;

  SELECT COALESCE(consecutive_failures, 0) INTO v_fails
    FROM public.gg_provider_health
   WHERE provider = p_provider AND model = p_model;
  v_fails := COALESCE(v_fails, 0) + 1;

  -- Quota exhaustion deserves a long rest; transient errors a short one.
  v_base := CASE WHEN p_status = 429 THEN 300 ELSE 20 END;
  v_cool := make_interval(secs => LEAST(v_base * POWER(2, LEAST(v_fails - 1, 5))::INT, 1800));

  INSERT INTO public.gg_provider_health (provider, model, consecutive_failures, cooldown_until, last_error, last_status, updated_at)
  VALUES (p_provider, p_model, v_fails, now() + v_cool, LEFT(COALESCE(p_error, ''), 300), p_status, now())
  ON CONFLICT (provider, model) DO UPDATE
    SET consecutive_failures = v_fails,
        cooldown_until = now() + v_cool,
        last_error = LEFT(COALESCE(p_error, ''), 300),
        last_status = p_status,
        updated_at = now();
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
--  3. QUOTA LEDGER
--  Per provider/model/day counters so routing can spend the free tiers in the
--  right order and stop before anything bills.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gg_provider_usage (
  provider    TEXT   NOT NULL,
  model       TEXT   NOT NULL,
  day         DATE   NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  requests    INT    NOT NULL DEFAULT 0,
  tokens_in   BIGINT NOT NULL DEFAULT 0,
  tokens_out  BIGINT NOT NULL DEFAULT 0,
  errors      INT    NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, model, day)
);

ALTER TABLE public.gg_provider_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.gg_record_usage(
  p_provider   TEXT,
  p_model      TEXT,
  p_tokens_in  INT DEFAULT 0,
  p_tokens_out INT DEFAULT 0,
  p_error      BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.gg_provider_usage (provider, model, day, requests, tokens_in, tokens_out, errors)
  VALUES (
    p_provider, p_model, (now() AT TIME ZONE 'utc')::date,
    1, GREATEST(p_tokens_in, 0), GREATEST(p_tokens_out, 0),
    CASE WHEN p_error THEN 1 ELSE 0 END
  )
  ON CONFLICT (provider, model, day) DO UPDATE
    SET requests   = public.gg_provider_usage.requests   + 1,
        tokens_in  = public.gg_provider_usage.tokens_in  + GREATEST(p_tokens_in, 0),
        tokens_out = public.gg_provider_usage.tokens_out + GREATEST(p_tokens_out, 0),
        errors     = public.gg_provider_usage.errors     + CASE WHEN p_error THEN 1 ELSE 0 END;
$$;


-- One round trip returns everything the router needs: today's spend plus any
-- active cooldowns. Called once per request, so it must stay cheap.
CREATE OR REPLACE FUNCTION public.gg_mesh_state()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'usage', COALESCE((
      SELECT jsonb_object_agg(provider || '|' || model, requests)
        FROM public.gg_provider_usage
       WHERE day = (now() AT TIME ZONE 'utc')::date
    ), '{}'::jsonb),
    'cooldowns', COALESCE((
      SELECT jsonb_object_agg(provider || '|' || model,
                              EXTRACT(EPOCH FROM (cooldown_until - now()))::INT)
        FROM public.gg_provider_health
       WHERE cooldown_until IS NOT NULL AND cooldown_until > now()
    ), '{}'::jsonb)
  );
$$;


-- ───────────────────────────────────────────────────────────────────────────
--  4. PLAYER MEMORY
--  What turns a search engine with a personality into an assistant that knows
--  you. Written by the edge function; readable and editable by the owner.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gg_player_profile (
  user_id      UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  platform     TEXT,             -- 'PC' | 'PS5' | 'Xbox Series X' | 'Switch' | ...
  gpu          TEXT,
  cpu          TEXT,
  ram          TEXT,
  display      TEXT,             -- '1440p 165Hz'
  -- [{name, hours, rank, status:'playing'|'stuck'|'finished'|'dropped', note}]
  games        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- {spoilers:bool, difficulty:'casual'|'balanced'|'hardcore', tone:'chill'|'blunt'}
  prefs        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Free-form durable facts the assistant learned ("hates soulslikes").
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gg_player_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own profile read"   ON public.gg_player_profile;
DROP POLICY IF EXISTS "own profile write"  ON public.gg_player_profile;
DROP POLICY IF EXISTS "own profile update" ON public.gg_player_profile;

CREATE POLICY "own profile read"
  ON public.gg_player_profile FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own profile write"
  ON public.gg_player_profile FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own profile update"
  ON public.gg_player_profile FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- Merge-in-place upsert. Only non-null scalars overwrite; games/prefs merge so
-- a partial extraction can never wipe facts learned in an earlier session.
CREATE OR REPLACE FUNCTION public.gg_upsert_profile(
  p_user_id  UUID,
  p_patch    JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.gg_player_profile AS pp (
    user_id, platform, gpu, cpu, ram, display, games, prefs, notes, updated_at
  )
  VALUES (
    p_user_id,
    NULLIF(p_patch->>'platform', ''),
    NULLIF(p_patch->>'gpu', ''),
    NULLIF(p_patch->>'cpu', ''),
    NULLIF(p_patch->>'ram', ''),
    NULLIF(p_patch->>'display', ''),
    COALESCE(p_patch->'games', '[]'::jsonb),
    COALESCE(p_patch->'prefs', '{}'::jsonb),
    NULLIF(p_patch->>'notes', ''),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    platform   = COALESCE(NULLIF(p_patch->>'platform', ''), pp.platform),
    gpu        = COALESCE(NULLIF(p_patch->>'gpu', ''),      pp.gpu),
    cpu        = COALESCE(NULLIF(p_patch->>'cpu', ''),      pp.cpu),
    ram        = COALESCE(NULLIF(p_patch->>'ram', ''),      pp.ram),
    display    = COALESCE(NULLIF(p_patch->>'display', ''),  pp.display),
    prefs      = pp.prefs || COALESCE(p_patch->'prefs', '{}'::jsonb),
    games      = CASE
                   WHEN p_patch ? 'games' THEN public.gg_merge_games(pp.games, p_patch->'games')
                   ELSE pp.games
                 END,
    notes      = COALESCE(NULLIF(p_patch->>'notes', ''), pp.notes),
    updated_at = now();
END;
$$;


-- Merge game entries by case-insensitive name: incoming fields overwrite the
-- matching entry, unseen games are appended. Keeps the 40 most recent.
CREATE OR REPLACE FUNCTION public.gg_merge_games(p_existing JSONB, p_incoming JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_out  JSONB := COALESCE(p_existing, '[]'::jsonb);
  v_new  JSONB;
  v_idx  INT;
  v_found BOOLEAN;
  i INT;
BEGIN
  IF p_incoming IS NULL OR jsonb_typeof(p_incoming) <> 'array' THEN
    RETURN v_out;
  END IF;

  FOR v_new IN SELECT * FROM jsonb_array_elements(p_incoming) LOOP
    CONTINUE WHEN COALESCE(v_new->>'name', '') = '';
    v_found := FALSE;
    FOR i IN 0 .. jsonb_array_length(v_out) - 1 LOOP
      IF lower(COALESCE(v_out->i->>'name', '')) = lower(v_new->>'name') THEN
        v_out := jsonb_set(v_out, ARRAY[i::text], (v_out->i) || v_new);
        v_found := TRUE;
        EXIT;
      END IF;
    END LOOP;
    IF NOT v_found THEN
      v_out := v_out || jsonb_build_array(v_new);
    END IF;
  END LOOP;

  -- Cap growth so the injected context block stays bounded.
  v_idx := jsonb_array_length(v_out);
  IF v_idx > 40 THEN
    v_out := (SELECT jsonb_agg(e) FROM (
      SELECT e FROM jsonb_array_elements(v_out) WITH ORDINALITY t(e, o)
       WHERE o > v_idx - 40 ORDER BY o
    ) s);
  END IF;

  RETURN v_out;
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
--  4b. LOCK DOWN FUNCTION EXECUTION  ← do not remove
--  ───────────────────────────────────────────────────────────────────────
--  Postgres grants EXECUTE on new functions to PUBLIC by default, and Supabase
--  exposes every function in `public` as a PostgREST RPC endpoint reachable
--  with the anon key. Combined with SECURITY DEFINER (which runs as the owner
--  and bypasses RLS) that default is a critical hole:
--
--    curl -X POST '<project>/rest/v1/rpc/gg_upsert_profile' \
--         -H "apikey: <ANON KEY>" -H 'Content-Type: application/json' \
--         -d '{"p_user_id":"<any victim uuid>","p_patch":{"notes":"owned"}}'
--
--  …would let any anonymous caller overwrite any player's profile, forge
--  rate-limit consumption, or read operational spend data.
--
--  These functions are called ONLY by the edge function using the service role
--  key, so PUBLIC/anon/authenticated must hold no EXECUTE at all.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.gg_check_rate_limit(text,text,int,int,int,int)',
    'public.gg_prune_usage_events()',
    'public.gg_report_provider(text,text,boolean,int,text)',
    'public.gg_record_usage(text,text,int,int,boolean)',
    'public.gg_mesh_state()',
    'public.gg_upsert_profile(uuid,jsonb)',
    'public.gg_merge_games(jsonb,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
--  5. REQUEST TRACE (observability)
--  _meta already carries which sources fired and which model answered; this
--  keeps it so "why did it say that" is answerable after the fact.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gg_request_trace (
  id          BIGSERIAL PRIMARY KEY,
  bucket_key  TEXT,
  prompt      TEXT,
  game        TEXT,
  intent      TEXT,
  persona     TEXT,
  provider    TEXT,
  model       TEXT,
  sources     TEXT[],
  vision      BOOLEAN NOT NULL DEFAULT FALSE,
  corrected   BOOLEAN NOT NULL DEFAULT FALSE,
  cached      BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms  INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gg_request_trace_time_idx ON public.gg_request_trace (created_at DESC);

ALTER TABLE public.gg_request_trace ENABLE ROW LEVEL SECURITY;
