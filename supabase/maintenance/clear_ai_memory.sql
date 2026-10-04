-- Clear what the AI remembers about players, keeping a backup first.
--
-- Run in Supabase → SQL Editor (or: npx supabase db query --linked -f this file).
--
-- CLEARED (fed back into prompts, so old or wrong facts here make answers
-- slower and worse):
--   gg_player_profile      remembered platform / hardware / games / notes (web, signed in)
--   discord_chat_messages  Discord conversation history replayed into each turn
--   chat_messages          stored web chat history
--   gg_request_trace       per-request traces, which include prompt text
--
-- KEPT (not memory; deleting them breaks paid or chosen features):
--   discord_entitlements, discord_bonus_credits, discord_premium*, discord_quota_*,
--   discord_usage_*, discord_votes        billing and quota
--   discord_spoiler_prefs                 progress each player told /progress
--   discord_watches, discord_watch_posts  Watchtower subscriptions
--   gg_provider_*, gg_usage_events        model health and rate limits
--
-- Undo: INSERT INTO <table> SELECT * FROM backup_20261004_<table>;
-- Drop the backup tables once you are happy: DROP TABLE backup_20261004_<table>;

BEGIN;

CREATE TABLE IF NOT EXISTS public.backup_20261004_gg_player_profile     AS SELECT * FROM public.gg_player_profile;
CREATE TABLE IF NOT EXISTS public.backup_20261004_discord_chat_messages AS SELECT * FROM public.discord_chat_messages;
CREATE TABLE IF NOT EXISTS public.backup_20261004_chat_messages         AS SELECT * FROM public.chat_messages;
CREATE TABLE IF NOT EXISTS public.backup_20261004_gg_request_trace      AS SELECT * FROM public.gg_request_trace;

-- Backups hold personal data: no API access to them.
ALTER TABLE public.backup_20261004_gg_player_profile     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_20261004_discord_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_20261004_chat_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_20261004_gg_request_trace      ENABLE ROW LEVEL SECURITY;

DELETE FROM public.gg_player_profile;
DELETE FROM public.discord_chat_messages;
DELETE FROM public.chat_messages;
DELETE FROM public.gg_request_trace;

COMMIT;
