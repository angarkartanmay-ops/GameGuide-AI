-- The function created in the previous step is executable by everyone by
-- default; limit it to the bot's service role like every other gg_ function.
REVOKE ALL ON FUNCTION public.gg_discord_prune_billing_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gg_discord_prune_billing_events() TO service_role;;
