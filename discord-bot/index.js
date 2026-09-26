// ═══════════════════════════════════════════════════════════════════════════
//  GameGuide-AI :: Discord Bot v2.0 (production)
//  ───────────────────────────────────────────────────────────────────────
//  Full feature-parity with the web app + monetization hooks.
//
//  Slash commands:    /ask /price /discover /konami /clear /history /quota
//                     /stats /premium /help /progress /spoilers /watch
//  Watchtower:        patch-note + deal alerts posted into server channels
//                     (watchtower.js; polled from this process every 15 min)
//  Mention chat:      @GameGuide <question> [+ image attachments], or a DM
//  Intents:           none privileged — only reads messages addressed to it
//  Invite perms:      277025508352 (View, Send, Send in Threads, Embed, Attach,
//                     Read History, App Commands) — see tests/discord-launch
//  Vision:            up to 3 images per message, GODMODE pipeline
//  History:           per-user, persistent in Supabase (table: discord_chat_messages)
//  Tiers:             FREE 15/day · PRO 200/day · SERVER 60/day (+800 guild pool)
//                     Authoritative limits live in discord_quota_tiers, not here.
//                     Tier resolution: Stripe-driven Supabase row OR env override
//  Affiliate:         CheapShark deal URLs decorated with affiliate tags
//                     (Humble, GreenManGaming, Fanatical) when env keys set
//  Monetization:      /premium command, vote-rewards Top.gg webhook
//  Analytics:         per-user call counters → Supabase (discord_usage_stats)
//  Resilience:        SIGTERM, AbortController timeouts, structured errors
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config({ quiet: true });
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { fetchPriceDirect, fetchJson } = require('./cheapshark');
const watchtower = require('./watchtower');
const quota = require('./quota');
const { syncEnvOverrides, grantBonusCredits } = require('./entitlements');
const { mountStripeWebhook, buildCheckoutUrl, stripeConfigured } = require('./billing-stripe');
const { splitForDiscord } = require('./textsplit');

// ─── Native fetch sanity ───────────────────────────────────────────────────
if (typeof fetch !== 'function') {
  throw new Error('Native fetch not available. Upgrade Node to 18+.');
}

// ─── Env ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // for bot-side writes
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
// Shared secret proving requests come from this bot, so chat-proxy rate-limits
// per Discord user instead of lumping the whole bot into one IP bucket.
// Must match BOT_SERVICE_TOKEN in the edge function's secrets.
const BOT_SERVICE_TOKEN = process.env.BOT_SERVICE_TOKEN || '';
const PREMIUM_USER_IDS = (process.env.PREMIUM_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const PREMIUM_GUILD_IDS = (process.env.PREMIUM_GUILD_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const PATREON_URL = process.env.PATREON_URL || '';
const KOFI_URL = process.env.KOFI_URL || '';
const STRIPE_PAYMENT_LINK = process.env.STRIPE_PAYMENT_LINK || '';
const STRIPE_SERVER_PAYMENT_LINK = process.env.STRIPE_SERVER_PAYMENT_LINK || '';
const TOPGG_VOTE_URL = process.env.TOPGG_VOTE_URL || '';
const HUMBLE_AFFILIATE = process.env.HUMBLE_AFFILIATE || ''; // ?partner=YOUR_ID
const GMG_AFFILIATE = process.env.GMG_AFFILIATE || '';       // mw_aref=YOUR_ID
const FANATICAL_AFFILIATE = process.env.FANATICAL_AFFILIATE || ''; // ?ref=YOUR_ID
// HTTP port — Render/Railway/Fly/Koyeb/Heroku all inject PORT. Fall back to VOTE_WEBHOOK_PORT for compat, then 3000.
const HTTP_PORT = parseInt(process.env.PORT || process.env.VOTE_WEBHOOK_PORT || '3000', 10);
const TOPGG_WEBHOOK_AUTH = process.env.TOPGG_WEBHOOK_AUTH || ''; // shared secret with Top.gg

// 24/7 keep-alive — set this to your deployed bot's public URL (e.g. https://gameguide-bot.onrender.com)
// to have the bot self-ping every ~4 minutes, defeating idle-sleep on free tiers.
const KEEPALIVE_URL = process.env.KEEPALIVE_URL || '';
const KEEPALIVE_INTERVAL_MS = parseInt(process.env.KEEPALIVE_INTERVAL_MS || '240000', 10); // 4 min

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DISCORD_TOKEN) {
  console.error('❌ Missing required env vars. Need SUPABASE_URL, SUPABASE_ANON_KEY, DISCORD_TOKEN.');
  process.exit(1);
}

const CHAT_PROXY_URL = `${SUPABASE_URL}/functions/v1/chat-proxy`;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const supabaseHasServiceRole = !!SUPABASE_SERVICE_ROLE_KEY;

// ─── Constants ─────────────────────────────────────────────────────────────
// Upper bound on what /history will ever render. The per-tier retention that
// actually governs a request comes from discord_quota_tiers.history_len.
const MAX_HISTORY_DISPLAY = 50;
// Raised from 60s: the proxy now always gathers live data (multi-source web
// search + wiki + Steam/RSS) before generating, because gating retrieval on
// successful game detection was how brand-new titles got answered from stale
// training. Discord does not stream, so the whole pipeline must fit here.
const PROXY_TIMEOUT_MS = 90_000;
const TYPING_PULSE_MS = 8_000;

// Vote rewards grant CREDITS, never a tier — see entitlements.grantBonusCredits
// for why the old "12h of Pro per vote" was a hole rather than a perk.
const VOTE_BONUS_CREDITS = 10;
const VOTE_BONUS_HOURS = 24;
const VOTE_BONUS_CAP = 20;

const PRO_PRICE = '$4.99';
const SERVER_PRICE = '$14.99';

// ─── In-memory state ───────────────────────────────────────────────────────
// Rate limiting used to live here in a Map. It now lives in Postgres, because
// a Map resets on every restart and free hosts restart constantly — see quota.js.
const historyCache = new Map();      // userId → { history: [], fetchedAt }
const HISTORY_CACHE_MS = 30_000;     // small cache to dedupe rapid replies
let tierCache = null;                // { rows, fetchedAt } — pricing copy for /premium
const TIER_CACHE_MS = 10 * 60_000;

/**
 * Tier rows, for copy that quotes limits. Read from the same table the quota
 * function enforces against, so an operator retuning discord_quota_tiers can
 * never leave /premium advertising a number the bot will not honour.
 */
async function fetchTiers() {
  if (tierCache && Date.now() - tierCache.fetchedAt < TIER_CACHE_MS) return tierCache.rows;
  try {
    const { data } = await supabase
      .from('discord_quota_tiers')
      .select('tier, label, msgs_day, burst_min, vision_day, imagegen_day, guild_pool_day');
    const rows = Object.fromEntries((data || []).map(r => [r.tier, r]));
    if (Object.keys(rows).length) tierCache = { rows, fetchedAt: Date.now() };
    return rows;
  } catch {
    return tierCache?.rows || {};
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tier resolution and rate limiting now happen inside a single Postgres call
//  (gg_discord_quota_check, via quota.js). The three functions that used to
//  live here — resolveUserTier, resolveGuildTier, effectiveLimit — plus the
//  in-memory checkRateLimit have been removed rather than kept alongside it:
//  two limiters that disagreed is precisely what made a paid Pro user hit a
//  429 at message 13 while the bot told them they had 30.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers — chat history (Supabase persistent + in-memory cache)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {number} limit  How many messages to retain for this caller. Comes
 *   from the tier's `history_len`, so Pro genuinely remembers more of the
 *   conversation than free does — a perk that costs nothing to grant.
 */
async function getHistory(userId, limit = 10) {
  const cached = historyCache.get(userId);
  // A cache entry filled for a shorter tier must not be served to a longer one.
  if (cached && Date.now() - cached.fetchedAt < HISTORY_CACHE_MS && cached.limit >= limit) {
    return cached.history.slice(-limit);
  }
  try {
    // supabase-js reports failures in `error` and does not throw, so each call
    // here checks it explicitly — a try/catch alone never sees a DB failure.
    const { data, error } = await supabase
      .from('discord_chat_messages')
      .select('text, sender, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    const history = (data || []).reverse().map(r => ({ sender: r.sender, text: r.text }));
    historyCache.set(userId, { history, limit, fetchedAt: Date.now() });
    return history;
  } catch (e) {
    console.warn('[history] read failed:', e.message);
    return [];
  }
}

async function pushHistory(userId, guildId, sender, text) {
  // Invalidate cache so next call fetches fresh
  historyCache.delete(userId);
  if (!supabaseHasServiceRole) {
    // Without service role, RLS will block anonymous inserts — log a hint once.
    if (!pushHistory._warned) {
      console.warn('[history] SUPABASE_SERVICE_ROLE_KEY not set — history persistence disabled.');
      pushHistory._warned = true;
    }
    return;
  }
  try {
    const { error } = await supabase.from('discord_chat_messages').insert({
      user_id: userId,
      guild_id: guildId || null,
      sender,
      text: text.slice(0, 4000),
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn('[history] write failed:', e.message);
  }
}

/**
 * @returns {'cleared'|'disabled'|'failed'}
 *
 * This used to return true whenever the call didn't throw — but supabase-js
 * never throws on a failed delete, it returns `{ error }`. So a transient DB
 * failure made /clear tell the user their history was wiped when every row was
 * still there: a privacy promise the bot wasn't keeping.
 */
async function clearUserHistory(userId) {
  historyCache.delete(userId);
  spoilerCache.delete(userId);
  if (!supabaseHasServiceRole) return 'disabled';
  try {
    // One promise to the user: /clear forgets everything the bot stored about
    // them — the conversation AND where they are in each game.
    const [chat, prefs] = await Promise.all([
      supabase.from('discord_chat_messages').delete().eq('user_id', userId),
      supabase.from('discord_spoiler_prefs').delete().eq('user_id', userId),
    ]);
    if (chat.error) throw new Error(chat.error.message);
    if (prefs.error) throw new Error(prefs.error.message);
    return 'cleared';
  } catch (e) {
    console.warn('[history] clear failed:', e.message);
    return 'failed';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Spoiler Shield — per-player progress (table: discord_spoiler_prefs)
//  Sent to chat-proxy as prompt context each turn; the server decides what to
//  hide. See supabase/functions/chat-proxy/spoilerShield.ts.
// ═══════════════════════════════════════════════════════════════════════════

const spoilerCache = new Map();         // userId → { prefs, fetchedAt }
const SPOILER_CACHE_MS = 60_000;
const SPOILER_MAX_GAMES = 30;
const DEFAULT_SPOILER = Object.freeze({ mode: 'shield', progress: {} });

function cleanField(s, max = 60) {
  return String(s ?? '').replace(/[\r\n\t|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function getSpoilerPrefs(userId) {
  const hit = spoilerCache.get(userId);
  if (hit && Date.now() - hit.fetchedAt < SPOILER_CACHE_MS) return hit.prefs;
  if (!supabaseHasServiceRole) return { ...DEFAULT_SPOILER, progress: {} };
  try {
    const { data, error } = await supabase
      .from('discord_spoiler_prefs')
      .select('mode, progress')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const prefs = {
      mode: data?.mode === 'off' ? 'off' : 'shield',
      progress: data?.progress && typeof data.progress === 'object' ? data.progress : {},
    };
    spoilerCache.set(userId, { prefs, fetchedAt: Date.now() });
    return prefs;
  } catch (e) {
    // Fail safe: an unreadable setting means the shield stays ON.
    console.warn('[spoiler] read failed:', e.message);
    return { ...DEFAULT_SPOILER, progress: {} };
  }
}

async function saveSpoilerPrefs(userId, prefs) {
  spoilerCache.set(userId, { prefs, fetchedAt: Date.now() });
  if (!supabaseHasServiceRole) return false;
  const { error } = await supabase.from('discord_spoiler_prefs').upsert({
    user_id: userId,
    mode: prefs.mode === 'off' ? 'off' : 'shield',
    progress: prefs.progress,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) { console.warn('[spoiler] write failed:', error.message); return false; }
  return true;
}

async function setSpoilerProgress(userId, game, where) {
  const g = cleanField(game).toLowerCase();
  const w = cleanField(where);
  if (!g || !w) return false;
  const prefs = await getSpoilerPrefs(userId);
  const { [g]: _prev, ...rest } = prefs.progress;
  const kept = Object.entries(rest).slice(-(SPOILER_MAX_GAMES - 1));
  return saveSpoilerPrefs(userId, { ...prefs, progress: Object.fromEntries([...kept, [g, w]]) });
}

async function bumpStats(userId, vision) {
  if (!supabaseHasServiceRole) return;
  try {
    // Upsert + increment via two-step (Postgres has no built-in upsert-with-counter)
    const { data } = await supabase
      .from('discord_usage_stats')
      .select('total_calls, vision_calls')
      .eq('user_id', userId)
      .maybeSingle();
    if (data) {
      await supabase
        .from('discord_usage_stats')
        .update({
          total_calls: data.total_calls + 1,
          vision_calls: data.vision_calls + (vision ? 1 : 0),
          last_call_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    } else {
      await supabase.from('discord_usage_stats').insert({
        user_id: userId,
        total_calls: 1,
        vision_calls: vision ? 1 : 0,
      });
    }
  } catch { /* analytics is best-effort */ }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers — formatting
// ═══════════════════════════════════════════════════════════════════════════

// splitForDiscord lives in textsplit.js: it must keep ||spoiler|| spans intact
// across message boundaries, and a split inside one would post the rest of the
// secret unhidden. The old inline version did exactly that in 277 of 300
// randomised multi-message answers — see tests/textsplit.test.mjs.

// ─── CheapShark /price embed formatter ────────────────────────────────────
// Mirrors the web app's PriceBadge: thumb + title + historic-low chip +
// deal table. Returns a Discord interaction-payload (embed + components).
function formatPriceEmbed(data) {
  const cheapest = parseFloat(data.cheapest || 0);
  const historicLow = data.cheapestEver ? parseFloat(data.cheapestEver.price) : null;
  const atLow = historicLow !== null && cheapest <= historicLow;

  const lines = [];
  if (atLow) lines.push(`🔥 **AT HISTORIC LOW** — currently $${data.cheapest}`);
  else if (historicLow !== null) lines.push(`📉 Historic low: **$${data.cheapestEver.price}** · current: **$${data.cheapest}**`);
  else if (data.cheapest) lines.push(`💵 Current lowest: **$${data.cheapest}**`);

  if (data.deals.length > 0) {
    lines.push('');
    lines.push('**Live deals:**');
    for (let i = 0; i < Math.min(data.deals.length, 5); i++) {
      const d = data.deals[i];
      const badge = i === 0 && atLow ? '🔥' : i === 0 && d.savings >= 50 ? '✅' : i === 0 && d.savings >= 25 ? '👍' : '';
      const savingsLabel = d.savings > 0 ? ` (**${d.savings}% off** $${d.retailPrice})` : '';
      const storeLine = d.url
        ? `${badge} [${d.store}](${d.url}) — **$${d.price}**${savingsLabel}`
        : `${badge} ${d.store} — **$${d.price}**${savingsLabel}`;
      lines.push(`• ${storeLine.trim()}`);
    }
  }

  const description = decorateWithAffiliate(lines.join('\n')) || '*No live deals found.*';

  const embed = new EmbedBuilder()
    .setColor(atLow ? 0xFFD700 : 0x00FFD1)
    .setTitle(`💰 Live Price — ${data.title}`)
    .setDescription(description.slice(0, 4000))
    .setFooter({ text: 'Powered by CheapShark · Refreshed every 15 min' });

  if (data.thumb) embed.setThumbnail(data.thumb);

  return { embeds: [embed], allowedMentions: { parse: [] } };
}

// ─── Affiliate link decorator for /price responses ────────────────────────
function decorateWithAffiliate(text) {
  if (!text) return text;
  let out = text;
  if (HUMBLE_AFFILIATE) {
    out = out.replace(/(https?:\/\/(?:www\.)?humblebundle\.com\/[^\s)"]+)/gi, (url) => {
      return url.includes('?') ? `${url}&partner=${HUMBLE_AFFILIATE}` : `${url}?partner=${HUMBLE_AFFILIATE}`;
    });
  }
  if (GMG_AFFILIATE) {
    out = out.replace(/(https?:\/\/(?:www\.)?greenmangaming\.com\/[^\s)"]+)/gi, (url) => {
      return url.includes('?') ? `${url}&mw_aref=${GMG_AFFILIATE}` : `${url}?mw_aref=${GMG_AFFILIATE}`;
    });
  }
  if (FANATICAL_AFFILIATE) {
    out = out.replace(/(https?:\/\/(?:www\.)?fanatical\.com\/[^\s)"]+)/gi, (url) => {
      return url.includes('?') ? `${url}&ref=${FANATICAL_AFFILIATE}` : `${url}?ref=${FANATICAL_AFFILIATE}`;
    });
  }
  return out;
}

// Must mirror the server's allowlist in chat-proxy/index.ts. A type the server
// rejects is dropped SILENTLY there, and the model then answers "Analyze this
// image." with no image attached — a confidently wrong reply and no error. Fail
// here instead, where we can tell the user why.
const PROXY_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const PROXY_MAX_BASE64 = 8_000_000;

/**
 * @returns {{mimeType,data}|{error:string}|null}
 * An `error` result is surfaced to the user; null means "not an image, ignore".
 */
async function fetchAttachmentAsBase64(att) {
  if (!att.contentType) return null;
  const mime = att.contentType.split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) return null;
  if (!PROXY_ALLOWED_MIME.has(mime)) {
    return { error: `\`${att.name || 'image'}\` is ${mime}, which isn't supported. Re-upload as PNG or JPEG.` };
  }
  try {
    const res = await fetch(att.url);
    if (!res.ok) return { error: `Couldn't download \`${att.name || 'image'}\`.` };
    const buf = Buffer.from(await res.arrayBuffer());
    const data = buf.toString('base64');
    // Check the ENCODED length: base64 inflates by ~1.37x, so an 8MB raw file
    // becomes ~11MB and is rejected server-side after passing a raw-size check.
    if (data.length >= PROXY_MAX_BASE64) {
      return { error: `\`${att.name || 'image'}\` is too large (max ~5.8MB). Try a smaller screenshot.` };
    }
    return { mimeType: mime, data };
  } catch {
    return { error: `Couldn't read \`${att.name || 'image'}\`.` };
  }
}

async function callChatProxy({ prompt, history, attachments, discordUserId, tier, softCapped, spoiler, stateless }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY,
    };
    // Identifies this caller as the trusted bot so the server rate-limits per
    // Discord user. Without it every user shares one IP bucket (40/hour for
    // the entire bot across all guilds).
    if (BOT_SERVICE_TOKEN && discordUserId) {
      headers['X-GG-Bot-Token'] = BOT_SERVICE_TOKEN;
      headers['X-GG-Bot-User'] = String(discordUserId);
      // Routing preference ONLY — explicitly not security-bearing. Quota is
      // resolved server-side from the database, so the worst a leaked bot token
      // buys here is slightly better model selection, never extra quota.
      // `softCapped` asks the mesh to stay on free models for a Pro user who is
      // far past normal usage, protecting margin without refusing them.
      if (tier) headers['X-GG-Bot-Tier'] = softCapped ? 'free' : String(tier);
    }

    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers,
      body: JSON.stringify({
        prompt,
        chatHistory: history,
        attachments: attachments || [],
        // Spoiler Shield context — where this player is, and whether the reply
        // lands in a shared server channel (reveals then stay barred even if
        // the asker said "spoil it": bystanders never agreed).
        spoiler: spoiler || undefined,
        // Watchtower summaries: no memory, no trace — nobody asked a question.
        ephemeral: stateless === true,
      }),
    });

    // Rate limited — the server tells us the real wait; honour it instead of
    // guessing. The scopes are 60s, 900s and 3600s, so the old blanket
    // "wait 15-30 seconds" sent users retrying into a wall for an hour.
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const retryAfter = Number(res.headers.get('Retry-After'))
        || body?._meta?.retryAfter
        || 60;
      const err = new Error(`RATE_LIMITED:${retryAfter}`);
      err.rateLimited = true;
      err.retryAfter = retryAfter;
      err.scope = body?._meta?.scope || null;
      throw err;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data || typeof data.text !== 'string') throw new Error('Malformed response (no text field).');
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout after ${PROXY_TIMEOUT_MS / 1000}s — proxy is overloaded.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Human-readable wait, e.g. 3600 -> "about an hour". */
function formatWait(seconds) {
  if (seconds >= 3600) {
    const h = Math.round(seconds / 3600);
    return h === 1 ? 'about an hour' : `about ${h} hours`;
  }
  if (seconds >= 60) {
    const m = Math.round(seconds / 60);
    return m === 1 ? 'about a minute' : `about ${m} minutes`;
  }
  return `${Math.max(5, Math.round(seconds))} seconds`;
}

async function sendLongResponse(replyTarget, text, footer = '', files = []) {
  const finalText = footer ? `${text}\n\n${footer}` : text;
  const chunks = splitForDiscord(finalText);
  if (chunks.length === 0) {
    // An image-only reply has no text but is not empty — send the pictures.
    const empty = files.length ? { content: '', files } : { content: '*(empty response)*' };
    if (replyTarget.editReply) return replyTarget.editReply(empty);
    if (replyTarget.reply) return replyTarget.reply(empty);
    return replyTarget.send(empty);
  }
  // Attach files to the first message so they appear alongside the answer.
  const first = files.length ? { content: chunks[0], files } : { content: chunks[0] };
  if (replyTarget.editReply) {
    await replyTarget.editReply(first);
  } else if (replyTarget.reply) {
    // A per-message allowedMentions REPLACES the client default rather than
    // merging with it, so `parse: []` has to be restated here.
    await replyTarget.reply({ ...first, allowedMentions: { parse: [], repliedUser: false } });
  } else {
    await replyTarget.send(first);
  }
  for (let i = 1; i < chunks.length; i++) {
    if (replyTarget.followUp) await replyTarget.followUp({ content: chunks[i] });
    else if (replyTarget.channel) await replyTarget.channel.send(chunks[i]);
  }
}

function userFacingError(err) {
  // Server-driven rate limit — quote the real wait rather than a guess.
  if (err?.rateLimited) {
    const wait = formatWait(err.retryAfter || 60);
    const scope = err.scope ? ` (${err.scope} limit)` : '';
    return `⏳ **Slow down a sec${scope}.** Try again in ${wait}.`;
  }
  const msg = (err.message || String(err)).toLowerCase();
  if (msg.includes('timeout')) return '⏱️ **That one took too long to research.** Try again in a few seconds.';
  // Word-bounded: a bare includes('rate') also matched "generate", "moderate"
  // and "accurate", labelling unrelated failures as a rate limit.
  if (/\b429\b|rate.?limit/.test(msg)) return '⏳ **Too many requests right now.** Please try again in a minute.';
  if (/\b50[023]\b/.test(msg)) return '🛠️ **The backend is briefly overloaded.** Try again in 30 seconds.';
  // Server-side misconfiguration is the operator's problem, not something a
  // member in a public server can act on — don't hand them our internals.
  if (/\b40[13]\b/.test(msg)) return '🛠️ **Something is misconfigured on my end.** It\'s not you — please try again later.';
  return '❌ **Connection issue.** Try again shortly.';
}

// ═══════════════════════════════════════════════════════════════════════════
//  CORE — handle a chat-style request (mention or /ask)
// ═══════════════════════════════════════════════════════════════════════════

/** Reply with a quota-block message plus, for free users, an upgrade button. */
function sendBlocked(replyTarget, decision, userId) {
  const content = quota.blockedMessage(decision);
  const components = [];
  if (decision.tier === 'free' && STRIPE_PAYMENT_LINK) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(`Upgrade to Pro — ${PRO_PRICE}/mo`)
        .setStyle(ButtonStyle.Link)
        .setURL(buildCheckoutUrl(STRIPE_PAYMENT_LINK, { userId })),
    ));
  }
  const payload = { content, components, allowedMentions: { parse: [] } };
  return replyTarget.editReply ? replyTarget.editReply(payload) : replyTarget.reply(payload);
}

/**
 * @param {object} [decision]  A quota decision already obtained by the caller
 *   (e.g. /price, which checks before trying CheapShark). Passing it through
 *   prevents billing the same turn twice.
 */
async function handleChatRequest({ userId, guildId, prompt, attachments, replyTarget, channel, decision }) {
  const cleaned = prompt.trim();
  if (!cleaned && (!attachments || attachments.length === 0)) {
    const msg = 'Please give me a question, or attach an image to analyse.';
    return replyTarget.editReply ? replyTarget.editReply(msg) : replyTarget.reply(msg);
  }

  // ── Quota ───────────────────────────────────────────────────────────────
  // One Postgres round trip resolves tier, spends any bonus credits, checks
  // every window and records the admission. It also hands back the per-tier
  // history and context lengths used below, so no second lookup is needed.
  if (!decision) {
    if (!quota.localSpamGate(userId)) {
      // A slash command has already been deferred by this point. Returning
      // silently would leave it showing "thinking…" forever, so drop the work
      // but always close the interaction; a duplicate @-mention can stay quiet.
      if (replyTarget.editReply) return replyTarget.editReply('⏳ One at a time — that one is still running.');
      return;
    }
    const kind = quota.kindFor({ attachments });
    decision = await quota.checkQuota(supabase, { userId, guildId, kind });
  }
  if (!decision.allowed) return sendBlocked(replyTarget, decision, userId);

  const tierLimits = decision.limits || {};

  // Typing indicator
  let typingTimer = null;
  if (channel?.sendTyping) {
    channel.sendTyping().catch(() => {});
    typingTimer = setInterval(() => channel.sendTyping().catch(() => {}), TYPING_PULSE_MS);
  }

  try {
    const [history, spoilerPrefs] = await Promise.all([
      getHistory(userId, tierLimits.history_len || 10),
      getSpoilerPrefs(userId),
    ]);
    const data = await callChatProxy({
      prompt: cleaned,
      history: history.slice(-(tierLimits.context_turns || 6)),
      attachments,
      discordUserId: userId,
      tier: decision.tier,
      softCapped: !!tierLimits.soft_capped,
      // A reply in a server is read by everyone in the channel; a DM only by
      // the asker. The shield keeps reveals barred in the first case always.
      spoiler: { ...spoilerPrefs, publicChannel: !!guildId },
    });

    // Persist history + bump stats (fire-and-forget)
    pushHistory(userId, guildId, 'user', cleaned).catch(() => {});
    pushHistory(userId, guildId, 'ai', data.text).catch(() => {});
    bumpStats(userId, !!attachments?.length).catch(() => {});

    // The server heard "I just beat Margit" in this turn — remember it, so the
    // next question about that game is shielded without being told again.
    const shield = data._meta?.spoiler;
    if (shield?.learned && shield.game && shield.progress) {
      setSpoilerProgress(userId, shield.game, shield.progress).catch(() => {});
    }

    // Build telemetry footer (no model/provider leak — server already redacts).
    const sources = (data._meta?.sources || []).filter(Boolean);
    const uniqueSources = [...new Set(sources)];
    const persona = data._meta?.persona ? `${data._meta.personaEmoji || '🤖'} ${data._meta.persona}` : '';
    const sourceLine = uniqueSources.length > 0
      ? `*— ${persona ? persona + ' · ' : ''}📡 ${uniqueSources.length} live source${uniqueSources.length > 1 ? 's' : ''}: ${uniqueSources.join(', ')}*`
      : (persona ? `*— ${persona}*` : '');

    // One quiet line once they are ~80% through the day, at most hourly.
    // Nothing at all for a paying user, and nothing while running degraded.
    const nudge = quota.quotaFooter(decision, { userId });
    // Make the shield visible — it is the reason to ask here and not a search
    // engine. Sanitised on the server, so it cannot carry markup or a ping.
    const shieldLine = shield?.active && shield.mode === 'progress' && shield.progress
      ? `-# 🛡️ Spoilers hidden past: ${shield.progress}`
      : shield?.active && shield.mode === 'unknown'
        ? '-# 🛡️ Spoiler Shield on — tell me where you are with `/progress`'
        : '';
    const footer = [sourceLine, shieldLine, nudge].filter(Boolean).join('\n');

    // Apply affiliate decoration when CheapShark / store URLs appear
    const decorated = decorateWithAffiliate(data.text);

    // The image-generation path returns pictures in `images[]`. Dropping them
    // left users with a bare "🎨 Done!" and nothing to look at.
    const files = (data.images || [])
      .filter(img => img?.data && img?.mimeType)
      .slice(0, 4)
      .map((img, i) => ({
        attachment: Buffer.from(img.data, 'base64'),
        name: `gameguide-${Date.now()}-${i}.${(img.mimeType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '')}`,
      }));

    await sendLongResponse(replyTarget, decorated, footer, files);
  } catch (err) {
    console.error(`[chat-proxy] user=${userId}:`, err.message);
    const friendly = userFacingError(err);
    if (replyTarget.editReply) await replyTarget.editReply(friendly).catch(() => {});
    else await replyTarget.reply(friendly).catch(() => {});
  } finally {
    if (typingTimer) clearInterval(typingTimer);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  WATCHTOWER — runtime wiring (the logic lives in watchtower.js)
// ═══════════════════════════════════════════════════════════════════════════

const watchRepo = watchtower.supabaseRepo(supabase);
const WATCHTOWER_ENABLED = process.env.WATCHTOWER_ENABLED !== '0';
const WATCH_POST_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];
const WATCH_PERM_NAMES = new Map([
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
]);
const watchtowerState = {};
let watchtowerRunning = false;

/** One summary per Steam item, written by the same model mesh as every answer. */
async function summarizeForWatch(gameName, item) {
  const data = await callChatProxy({
    prompt: watchtower.buildSummaryPrompt(gameName, item),
    history: [],
    attachments: [],
    // Billed to the bot's own bucket, never to a member's quota.
    discordUserId: client.user?.id,
    tier: 'free',
    // Posted in a shared channel: story DLC reveals stay behind bars.
    spoiler: { mode: 'shield', progress: {}, publicChannel: true },
    stateless: true,
  });
  return data?._meta?.error ? null : data.text;
}

/** Rejects with a Discord error code the cycle understands (10003/50001/50013). */
async function sendToWatchChannel(channelId, payload) {
  const channel = await client.channels.fetch(String(channelId));
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    throw Object.assign(new Error('not a text channel'), { code: 10003 });
  }
  const perms = channel.permissionsFor?.(client.user);
  if (perms && !perms.has(WATCH_POST_PERMS)) {
    throw Object.assign(new Error('missing permissions'), { code: 50013 });
  }
  await channel.send(payload);
}

async function watchtowerTick() {
  if (watchtowerRunning || shuttingDown || !client.isReady()) return;
  watchtowerRunning = true;
  try {
    const r = await watchtower.runCycle({
      repo: watchRepo,
      fetchJson,
      summarize: summarizeForWatch,
      send: sendToWatchChannel,
      state: watchtowerState,
      log: console,
    });
    if (r.posted || r.paused || r.failed) console.log(`[watchtower] ${JSON.stringify(r)}`);
  } catch (e) {
    console.warn('[watchtower] cycle failed:', e.message);
  } finally {
    watchtowerRunning = false;
  }
}

/** The body of `/watch add`, after the permission and channel checks. */
async function addWatch(interaction, target) {
  const query = interaction.options.getString('game', true);
  const alerts = watchtower.parseAlerts(interaction.options.getString('alerts'));
  const [existing, premium, game] = await Promise.all([
    watchRepo.listGuildWatches(interaction.guildId),
    watchRepo.guildIsPremium(interaction.guildId).catch(() => false),
    watchtower.resolveSteamGame(query, fetchJson),
  ]);
  if (!game) {
    return interaction.editReply(`🔎 I couldn't find **${cleanField(query, 80)}** on Steam. Watchtower follows Steam games — try the name exactly as the Steam store shows it.`);
  }
  const limit = premium ? watchtower.WATCH_LIMITS.server : watchtower.WATCH_LIMITS.free;
  const already = existing.find(w => w.channel_id === target.id && w.steam_appid === game.appid);
  if (!already && existing.length >= limit) {
    return interaction.editReply(
      `📡 This server already watches **${existing.length}/${limit}** games${premium ? '' : ' (the free limit)'}. ` +
      `Free one up with \`/watch remove\`` +
      (premium ? '.' : `, or upgrade the server with \`/premium\` to watch up to ${watchtower.WATCH_LIMITS.server}.`));
  }
  await watchRepo.upsertWatch({
    guild_id: interaction.guildId,
    channel_id: target.id,
    steam_appid: game.appid,
    game_name: game.name,
    news: alerts.news,
    deals: alerts.deals,
  });

  // Show the most recent matching post as proof it's wired to the right game.
  let latestLine = '';
  if (alerts.news !== 'none') {
    const items = await watchtower.fetchSteamNews(game.appid, fetchJson).catch(() => null);
    const kind = alerts.news === 'all' ? 'announcement' : 'patch notes';
    const latest = (items || [])
      .filter(i => (alerts.news === 'all' ? watchtower.isOfficial(i) : watchtower.isPatchNote(i)))
      .sort((a, b) => b.date - a.date)[0];
    latestLine = latest
      ? `Latest ${kind}: **${cleanField(latest.title, 120)}** (<t:${latest.date}:R>). The next one gets posted here.`
      : items ? `No ${kind} on Steam yet — the first one will be posted here.` : '';
  }
  const dealLine = alerts.deals
    ? `Deals: posted when it hits its all-time low or ${watchtower.DEAL_MIN_SAVINGS}%+ off.`
    : '';
  return interaction.editReply(
    `📡 **${already ? 'Updated' : 'Watching'} ${game.name}** in <#${target.id}> — ${watchtower.describeAlerts(alerts)}.\n` +
    [latestLine, dealLine].filter(Boolean).join('\n') +
    '\n-# Manage with `/watch list` · `/watch remove`');
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLIENT
// ═══════════════════════════════════════════════════════════════════════════

const client = new Client({
  // No MessageContent. It is a privileged intent, and this bot never reads a
  // message it wasn't addressed in: Discord already delivers the content of
  // DMs and of messages that @mention the app without it. Requesting it anyway
  // bought nothing and would have become a verification blocker at 100 guilds,
  // where Discord only grants it for use cases slash commands can't cover.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
  // Nothing this bot sends may ping anyone. Replies carry model output, and a
  // user can coax a model into writing "@everyone" or <@someone>; without this
  // default, editReply/followUp/channel.send parsed those mentions as live
  // pings. Only the /price embed opted out before. Server admins remove a bot
  // that mass-pings their members on the first offence.
  allowedMentions: { parse: [], repliedUser: false },
});

client.once('clientReady', async () => {
  console.log(`🎮 GameGuide-AI Bot online as ${client.user.tag}`);
  console.log(`   Proxy: ${CHAT_PROXY_URL}`);
  console.log(`   Service role key: ${supabaseHasServiceRole ? 'configured' : 'NOT configured (history disabled)'}`);
  console.log(`   Billing: ${stripeConfigured ? 'Stripe enabled' : 'disabled (no STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET)'}`);

  // Mirror the env overrides into the database. Tier is resolved inside the
  // quota function, which cannot read process.env — without this sync an
  // env-listed user would be shown "Pro" and still be enforced as free.
  if (PREMIUM_USER_IDS.length || PREMIUM_GUILD_IDS.length) {
    const synced = await syncEnvOverrides(supabase, {
      userIds: PREMIUM_USER_IDS,
      guildIds: PREMIUM_GUILD_IDS,
    });
    console.log(`   Env overrides synced: ${synced.users} user(s), ${synced.guilds} guild(s)`);
  }

  client.user.setActivity('🎮 /help · @ me with anything', { type: 0 });

  // Watchtower polls from this process: the bot is already always-on, and
  // posting needs the gateway connection anyway. First pass after a minute so
  // a restart loop can't hammer Steam; `once` means a re-login never stacks a
  // second timer.
  if (WATCHTOWER_ENABLED && supabaseHasServiceRole) {
    setTimeout(watchtowerTick, 60_000);
    setInterval(watchtowerTick, watchtower.POLL_INTERVAL_MS);
    console.log(`   Watchtower: polling every ${watchtower.POLL_INTERVAL_MS / 60_000} min`);
  } else {
    console.log(`   Watchtower: off (${supabaseHasServiceRole ? 'WATCHTOWER_ENABLED=0' : 'no service role key'})`);
  }
});

// A server that removes the bot, or deletes a watched channel, leaves nothing
// behind — no orphaned rows to poll for, no stored config for a server we
// are no longer in. An outage (guild unavailable) is not a removal.
client.on('guildDelete', (guild) => {
  if (!supabaseHasServiceRole || guild.available === false) return;
  watchRepo.deleteGuild(guild.id).catch(e => console.warn('[watchtower] guild cleanup failed:', e.message));
});
client.on('channelDelete', (channel) => {
  if (!supabaseHasServiceRole || !channel.guildId) return;
  watchRepo.deleteChannel(channel.id).catch(e => console.warn('[watchtower] channel cleanup failed:', e.message));
});

// ─── Mention listener (free-form chat, mirrors /ask) ──────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // DMs are a direct conversation and need no mention; the DirectMessages
  // intent and Channel partial were declared for exactly this, but the mention
  // gate below used to reject every DM that didn't @ the bot — i.e. all of them.
  const isDM = !message.inGuild();

  // mentions.has() counts @everyone, @here and role pings by default, so every
  // server announcement triggered a reply to the announcement (billed to
  // whoever posted it). Only a direct @ of the bot — or a reply to it — counts.
  const addressed = isDM
    || message.mentions.has(client.user, { ignoreEveryone: true, ignoreRoles: true });
  if (!addressed) return;

  // Don't take a turn we can't deliver. Quota is spent before the answer is
  // sent, so answering in a channel the bot can't post in charged the user for
  // nothing. ReadMessageHistory is checked separately because message.reply()
  // fails without it (error 160002) while a plain send still works.
  let replyTarget = message;
  if (!isDM) {
    const perms = message.channel.permissionsFor?.(client.user);
    const sendFlag = message.channel.isThread?.()
      ? PermissionFlagsBits.SendMessagesInThreads
      : PermissionFlagsBits.SendMessages;
    if (!perms?.has([PermissionFlagsBits.ViewChannel, sendFlag])) return;
    if (!perms.has(PermissionFlagsBits.ReadMessageHistory)) {
      replyTarget = {
        channel: message.channel,
        reply: (p) => message.channel.send(typeof p === 'string' ? { content: p } : p),
      };
    }
  }

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();
  const hasAttachments = message.attachments.size > 0;
  if (!prompt && !hasAttachments) return;

  const attachments = [];
  const attachmentErrors = [];
  if (hasAttachments) {
    for (const att of message.attachments.values()) {
      const enc = await fetchAttachmentAsBase64(att);
      if (!enc) continue;                       // not an image — ignore silently
      if (enc.error) { attachmentErrors.push(enc.error); continue; }
      attachments.push(enc);
      if (attachments.length >= 3) break;
    }
  }
  // Say why an image was dropped instead of answering blind about a picture
  // the model never received.
  if (attachmentErrors.length && attachments.length === 0) {
    await replyTarget.reply({
      content: `⚠️ ${attachmentErrors[0]}`,
      allowedMentions: { parse: [], repliedUser: false },
    }).catch(() => {});
    return;
  }

  await handleChatRequest({
    userId: message.author.id,
    guildId: message.guildId,
    prompt: prompt || 'Analyze this image.',
    attachments,
    replyTarget,
    channel: message.channel,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  try {
    switch (interaction.commandName) {

      case 'ask': {
        const question = interaction.options.getString('question', true);
        const imageOpt = interaction.options.getAttachment('image');
        await interaction.deferReply();
        const attachments = [];
        if (imageOpt) {
          const enc = await fetchAttachmentAsBase64(imageOpt);
          if (enc?.error) {
            // Don't answer blind about an image the model never received.
            return interaction.editReply(`⚠️ ${enc.error}`);
          }
          if (enc) attachments.push(enc);
        }
        return handleChatRequest({
          userId, guildId, prompt: question, attachments,
          replyTarget: interaction, channel: interaction.channel,
        });
      }

      case 'price': {
        const game = interaction.options.getString('game', true);
        await interaction.deferReply();

        // Bill /price like any other turn, once, up front.
        const priceDecision = await quota.checkQuota(supabase, { userId, guildId, kind: 'chat' });
        if (!priceDecision.allowed) return sendBlocked(interaction, priceDecision, userId);

        // Live CheapShark — mirrors the web app's /price path (no LLM hop).
        const data = await fetchPriceDirect(game);
        if (data && (data.cheapest || data.deals?.length)) {
          bumpStats(userId, false).catch(() => {});
          return interaction.editReply(formatPriceEmbed(data));
        }

        // Fallback: nothing on CheapShark — let the LLM try with web search.
        // The decision is handed through so this does not bill a second time.
        return handleChatRequest({
          userId, guildId,
          prompt: `What's the current price for "${game}" on PC? Use live data and include store URLs. If you can't find anything, say so directly.`,
          attachments: [],
          replyTarget: interaction, channel: interaction.channel,
          decision: priceDecision,
        });
      }

      // /tip, /lore and /redpill were three commands issuing three nearly
      // identical "give me a random nugget" prompts, each costing the user a
      // full quota turn. Folded into /discover to match the web app, with the
      // category either chosen by the user or picked at random.
      case 'discover': {
        const category = interaction.options.getString('category') || '';
        const game = interaction.options.getString('game') || '';
        await interaction.deferReply();

        const pick = category || ['tip', 'lore', 'secret'][Math.floor(Math.random() * 3)];
        const PROMPTS = {
          tip: 'Give me ONE elite pro gaming tip — concise, scannable, with **bold key terms**. Open with "💡 Pro Tip Unlocked".',
          lore: game
            ? `Give me a deep-cut lore drop about ${game}. Open with "📜 The Untold Story" — something most players miss. Use blockquotes for in-game text.`
            : 'Give me a deep-cut lore drop about a random iconic game universe. Open with "📜 The Untold Story" — something most players miss.',
          secret: 'Drop a hidden gaming-industry secret, accident, or unsolved mystery. Open with "🔴 Truth Unlocked" and use **bold key terms**.',
        };

        return handleChatRequest({
          userId, guildId,
          prompt: PROMPTS[pick] || PROMPTS.tip,
          attachments: [],
          replyTarget: interaction, channel: interaction.channel,
        });
      }

      case 'spoilers': {
        const choice = interaction.options.getString('mode');
        const prefs = await getSpoilerPrefs(userId);
        if (choice === 'on' || choice === 'off') {
          const ok = await saveSpoilerPrefs(userId, { ...prefs, mode: choice === 'on' ? 'shield' : 'off' });
          const content = !ok
            ? '⚠️ **I couldn\'t save that right now.** The shield stays **on** — try again in a minute.'
            : choice === 'on'
              ? '🛡️ **Spoiler Shield: ON.** Tell me where you are (`/progress`, or just say *"I just beat Margit"*) and nothing past that point shows unless you click it.'
              : '🛡️ **Spoiler Shield: OFF** for you. Full answers from now on.\n-# In server channels, big reveals are still put behind spoiler bars so other members don\'t get spoiled.';
          return interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: `🛡️ **Spoiler Shield is ${prefs.mode === 'off' ? 'OFF' : 'ON'}** for you.\n` +
            'I answer everything up to where you are and hide what comes after behind ||spoiler bars||.\n' +
            '• `/spoilers mode:off` · `/spoilers mode:on`\n' +
            '• `/progress` — tell me where you are in a game\n' +
            '• Or just say it: *"I\'m on chapter 4"*, *"I just beat Margit"* — I\'ll remember.',
          flags: MessageFlags.Ephemeral,
        });
      }

      case 'progress': {
        const game = interaction.options.getString('game');
        const at = interaction.options.getString('at');
        const prefs = await getSpoilerPrefs(userId);

        if (game && at) {
          const clear = /^clear$/i.test(at.trim());
          if (clear) {
            const g = cleanField(game).toLowerCase();
            const { [g]: _drop, ...rest } = prefs.progress;
            const ok = await saveSpoilerPrefs(userId, { ...prefs, progress: rest });
            return interaction.reply({
              content: ok ? `📍 Forgot where you were in **${cleanField(game)}**.` : '⚠️ Couldn\'t save that — try again in a minute.',
              flags: MessageFlags.Ephemeral,
            });
          }
          const ok = await setSpoilerProgress(userId, game, at);
          return interaction.reply({
            content: ok
              ? `📍 **${cleanField(game)}** — up to: **${cleanField(at)}**. I'll keep everything past that hidden.`
              : '⚠️ Couldn\'t save that — try again in a minute.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const rows = Object.entries(prefs.progress || {});
        return interaction.reply({
          content: '📍 **Where you are**\n' +
            (rows.length ? rows.map(([g, w]) => `• **${g}** — ${w}`).join('\n') : '*Nothing saved yet.*') +
            '\n\nSet it: `/progress game:Elden Ring at:beat Margit` · forget one: `at:clear` · forget everything: `/clear`',
          flags: MessageFlags.Ephemeral,
        });
      }

      // Watchtower. Discord hides the command from members without Manage
      // Server unless an admin grants it (Server Settings → Integrations), so
      // there is deliberately no second permission check here to fight that.
      case 'watch': {
        const sub = interaction.options.getSubcommand();
        if (!interaction.inGuild()) {
          return interaction.reply({ content: '📡 Watchtower posts into server channels — run `/watch` inside a server.', flags: MessageFlags.Ephemeral });
        }
        if (!supabaseHasServiceRole) {
          return interaction.reply({ content: '⚠️ Watchtower isn\'t available on this deployment (no database connection).', flags: MessageFlags.Ephemeral });
        }

        if (sub === 'list') {
          const rows = await watchRepo.listGuildWatches(guildId);
          const content = rows.length
            ? '📡 **Watchtower — this server**\n' + rows.map(w =>
                `• **${w.game_name}** → <#${w.channel_id}> · ${watchtower.describeAlerts(w)}` +
                (w.paused_reason ? `\n  ⏸️ Paused: ${w.paused_reason}. Fix the channel permissions, then \`/watch add\` again to resume.` : '')
              ).join('\n')
            : '📡 This server isn\'t watching anything yet. Try `/watch add game:Elden Ring` in your patch-notes channel.';
          return interaction.reply({ content: content.slice(0, 2000), flags: MessageFlags.Ephemeral });
        }

        if (sub === 'remove') {
          const q = cleanField(interaction.options.getString('game', true), 80).toLowerCase();
          const rows = await watchRepo.listGuildWatches(guildId);
          const hits = rows.filter(w => w.game_name.toLowerCase().includes(q) || String(w.steam_appid) === q);
          if (!hits.length) {
            return interaction.reply({ content: `📡 Nothing here matches **${q}**. See what's watched with \`/watch list\`.`, flags: MessageFlags.Ephemeral });
          }
          await watchRepo.deleteWatches(hits.map(w => w.id));
          return interaction.reply({
            content: `📡 Stopped: ${hits.map(w => `**${w.game_name}** in <#${w.channel_id}>`).join(', ')}.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // add
        const target = interaction.options.getChannel('channel') || interaction.channel;
        if (!target || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(target.type)) {
          return interaction.reply({ content: '📡 Pick a text or announcement channel (use the `channel` option), not a thread or voice chat.', flags: MessageFlags.Ephemeral });
        }
        const perms = target.permissionsFor?.(client.user);
        const missing = WATCH_POST_PERMS.filter(p => !perms?.has(p));
        if (missing.length) {
          return interaction.reply({
            content: `⚠️ I can't post in <#${target.id}> — I'm missing **${missing.map(p => WATCH_PERM_NAMES.get(p)).join(', ')}** there. Allow that in the channel's permissions, then run this again.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return addWatch(interaction, target);
      }

      case 'konami':
        return interaction.reply({
          content:
`## 🎮 ↑ ↑ ↓ ↓ ← → ← → B A
**KONAMI CODE ACCEPTED. 30 LIVES GRANTED.**

> *Kazuhisa Hashimoto added the code in 1986 while porting Gradius — he found the game too hard to test without it. It stayed in the release, players found it, and a legend was born.*

**Where it shows up**
• **1986 · Gradius** — full power-up
• **1988 · Contra** — 30 lives, the reason most players know it
• **2009 · ESPN.com** — the site sprouted unicorns
• **2009 · Facebook** — lens flares across the page

**One of the most recognized button combinations in gaming.** 🎖️`,
        });

      case 'clear': {
        const outcome = await clearUserHistory(userId);
        const CLEAR_COPY = {
          cleared: '🗑️ **Wiped.** Your chat history and your saved game progress are gone.',
          disabled: '🗑️ **Memory cleared.** (History isn\'t being stored at the moment, so there was nothing saved to delete.)',
          // Never claim a wipe that didn't happen.
          failed: '⚠️ **I couldn\'t wipe your history just now** — nothing was deleted. Please try `/clear` again in a minute.',
        };
        return interaction.reply({
          content: CLEAR_COPY[outcome],
          flags: MessageFlags.Ephemeral,
        });
      }

      case 'history': {
        const history = await getHistory(userId, MAX_HISTORY_DISPLAY);
        if (history.length === 0) {
          return interaction.reply({ content: 'You have no chat history yet. Try `/ask` or @-mention me.', flags: MessageFlags.Ephemeral });
        }
        const lines = history.slice(-MAX_HISTORY_DISPLAY).map(m => {
          const tag = m.sender === 'user' ? '🧑' : '🤖';
          return `${tag} ${m.text.slice(0, 250)}${m.text.length > 250 ? '…' : ''}`;
        });
        const embed = new EmbedBuilder()
          .setColor(0x00FFD1)
          .setTitle('📚 Your Recent Chat History')
          .setDescription(lines.join('\n\n').slice(0, 4000))
          .setFooter({ text: `Showing last ${history.length} message(s) · use /clear to wipe` });
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      case 'stats': {
        // Aggregated in Postgres. Selecting every row and summing here was
        // silently capped by PostgREST's max_rows (1000), so /stats would have
        // frozen at "1,000 users" and understated every total past that point.
        let global = { total: '?', vision: '?', users: '?' };
        try {
          const { data, error } = await supabase.rpc('gg_discord_global_stats');
          if (!error && data) {
            global = {
              total: Number(data.total || 0).toLocaleString(),
              vision: Number(data.vision || 0).toLocaleString(),
              users: Number(data.users || 0).toLocaleString(),
            };
          }
        } catch { /* stats are decorative; never fail the command over them */ }

        let userRow = null;
        try {
          const { data } = await supabase.from('discord_usage_stats').select('total_calls, vision_calls, last_call_at').eq('user_id', userId).maybeSingle();
          userRow = data;
        } catch { /* fine */ }

        // dryRun: reading your own stats must not spend a message.
        const d = await quota.checkQuota(supabase, { userId, guildId, kind: 'chat', dryRun: true });
        const m = d.messages || {};

        const embed = new EmbedBuilder()
          .setColor(0x00FFD1)
          .setTitle('📊 GameGuide-AI Stats')
          .addFields(
            { name: '🌍 Global', value: `**${global.total}** answers across **${global.users}** users\n**${global.vision}** vision queries`, inline: false },
            { name: '👤 You', value: userRow
                ? `**${(userRow.total_calls || 0).toLocaleString()}** calls · **${(userRow.vision_calls || 0).toLocaleString()}** vision\nLast call: <t:${Math.floor(new Date(userRow.last_call_at).getTime() / 1000)}:R>`
                : 'No calls yet — try `/ask`!',
              inline: false },
            { name: '🎟️ Your tier', value: `**${d.tier_label || 'Free'}** · ${m.remaining ?? 0}/${m.limit ?? 0} messages left today · see \`/quota\``, inline: false },
          );
        return interaction.reply({ embeds: [embed] });
      }

      case 'quota': {
        const d = await quota.checkQuota(supabase, { userId, guildId, kind: 'chat', dryRun: true });

        if (d.degraded) {
          return interaction.reply({
            content: '⚠️ Usage tracking is temporarily unavailable, so I can\'t show exact numbers right now. The bot still works.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const isFree = d.tier === 'free';
        const embed = new EmbedBuilder()
          .setColor(isFree ? 0x00FFD1 : 0xFFD700)
          .setTitle(`${d.tier_label} — today's usage`)
          .addFields(quota.quotaFields(d));

        if (d.limits?.soft_capped) {
          embed.setFooter({ text: 'Past your daily fair-use point — answers keep coming, from the standard model pool.' });
        }

        const components = [];
        if (isFree && STRIPE_PAYMENT_LINK) {
          components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel(`Upgrade to Pro — ${PRO_PRICE}/mo`)
              .setStyle(ButtonStyle.Link)
              .setURL(buildCheckoutUrl(STRIPE_PAYMENT_LINK, { userId })),
          ));
        }
        return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
      }

      case 'premium': {
        // dryRun so opening the upgrade page never costs the user a message.
        const [d, tiers] = await Promise.all([
          quota.checkQuota(supabase, { userId, guildId, kind: 'chat', dryRun: true }),
          fetchTiers(),
        ]);
        // Defaults matter here: if the tier table is briefly unreachable this
        // page still has to quote correct prices and limits rather than
        // "0 of undefined messages left". Keep in step with discord_quota_tiers.
        const free = { msgs_day: 15, vision_day: 3, burst_min: 5, ...(tiers.free || {}) };
        const pro = { msgs_day: 200, vision_day: 40, burst_min: 20, ...(tiers.pro || {}) };
        const srv = { msgs_day: 60, ...(tiers.server || {}) };
        const isPremium = d.tier !== 'free';

        const embed = new EmbedBuilder()
          .setColor(isPremium ? 0xFFD700 : 0x00FFD1)
          .setTitle(isPremium ? `${d.tier_label} — active` : '⭐ Upgrade to GameGuide Pro');

        if (isPremium) {
          embed.setDescription(
            'Thank you for supporting GameGuide-AI — you\'re the reason it stays free for everyone else.\n\n' +
            `• **${d.messages?.limit ?? pro.msgs_day} messages/day** · **${d.vision?.limit ?? pro.vision_day} screenshots**\n` +
            '• Priority routing — never queued when the free pool is exhausted\n' +
            '• Longer memory of your conversation\n\n' +
            'Track it any time with `/quota`.',
          );
        } else {
          embed
            .setDescription(d.degraded
              ? `You're on **Free**.`
              : `You're on **${d.tier_label || 'Free'}** — ${d.messages?.remaining ?? 0} of ${d.messages?.limit || free.msgs_day} messages left today.`)
            .addFields(
              {
                name: `🆓 Free`,
                value: `**${free.msgs_day}** messages/day\n**${free.vision_day}** screenshots/day\n${free.burst_min}/min`,
                inline: true,
              },
              {
                name: `⭐ Pro — ${PRO_PRICE}/mo`,
                value: `**${pro.msgs_day}** messages/day\n**${pro.vision_day}** screenshots/day\n${pro.burst_min}/min · priority`,
                inline: true,
              },
              {
                name: `🌟 Server — ${SERVER_PRICE}/mo`,
                value: `**${srv.msgs_day}**/day for **every member**\nWhole-server upgrade\nBest value for communities`,
                inline: true,
              },
            )
            .setFooter({ text: 'Cancel any time. Supports a solo dev keeping the bot free for everyone.' });
        }

        const buttons = [];
        if (STRIPE_PAYMENT_LINK && !isPremium) {
          // Carries the Discord id into checkout, so the webhook can grant Pro
          // without ever asking the buyer what their snowflake is.
          buttons.push(new ButtonBuilder()
            .setLabel(`⭐ Go Pro — ${PRO_PRICE}/mo`)
            .setStyle(ButtonStyle.Link)
            .setURL(buildCheckoutUrl(STRIPE_PAYMENT_LINK, { userId })));
        }
        if (STRIPE_SERVER_PAYMENT_LINK && guildId && d.tier !== 'server') {
          buttons.push(new ButtonBuilder()
            .setLabel(`🌟 Upgrade this server — ${SERVER_PRICE}/mo`)
            .setStyle(ButtonStyle.Link)
            .setURL(buildCheckoutUrl(STRIPE_SERVER_PAYMENT_LINK, { userId, guildId })));
        }
        if (PATREON_URL) buttons.push(new ButtonBuilder().setLabel('🎨 Patreon').setStyle(ButtonStyle.Link).setURL(PATREON_URL));
        if (KOFI_URL) buttons.push(new ButtonBuilder().setLabel('☕ Ko-fi').setStyle(ButtonStyle.Link).setURL(KOFI_URL));
        if (TOPGG_VOTE_URL) buttons.push(new ButtonBuilder().setLabel(`🗳️ Vote for +${VOTE_BONUS_CREDITS} messages`).setStyle(ButtonStyle.Link).setURL(TOPGG_VOTE_URL));

        // Discord allows at most 5 buttons per action row.
        const components = buttons.length ? [new ActionRowBuilder().addComponents(buttons.slice(0, 5))] : [];
        return interaction.reply({ embeds: [embed], components });
      }

      case 'help': {
        const tiers = await fetchTiers();
        const free = tiers.free || {};
        const pro = tiers.pro || {};
        const embed = new EmbedBuilder()
          .setColor(0x00FFD1)
          .setTitle('🎮 GameGuide-AI Command Reference')
          .setDescription('**@mention** me for free-form chat (with image support), or use these slash commands:')
          .addFields(
            { name: '🎯 Core', value:
                '`/ask <question> [image]` — ask anything\n' +
                '`/price <game>` — live multi-store prices\n' +
                '`/discover [category] [game]` — pro tip, industry secret, or lore drop', inline: false },
            { name: '🛡️ Spoiler Shield', value:
                'I answer up to where you are and hide the rest behind ||spoiler bars||.\n' +
                '`/progress [game] [at]` — tell me where you are in a game\n' +
                '`/spoilers [mode]` — turn the shield on or off for you', inline: false },
            { name: '📡 Watchtower (server admins)', value:
                '`/watch add <game>` — post its patch notes (and deals) in a channel\n' +
                '`/watch list` · `/watch remove <game>`', inline: false },
            { name: '🛠️ Utility', value:
                '`/quota` — how much you have left today\n' +
                '`/history` — show your recent chat with me\n' +
                '`/clear` — wipe your chat history\n' +
                '`/stats` — global + your usage stats\n' +
                '`/premium` — compare plans and upgrade', inline: false },
            { name: '🎉 Fun', value:
                '`/konami` — you know the one', inline: false },
          )
          .setFooter({ text: `Free: ${free.msgs_day ?? 15} messages/day · Pro: ${pro.msgs_day ?? 200}/day — see /premium` });
        return interaction.reply({ embeds: [embed] });
      }
    }
  } catch (err) {
    console.error(`[interaction] ${interaction.commandName} failed:`, err);
    const friendly = userFacingError(err);
    if (interaction.deferred) await interaction.editReply(friendly).catch(() => {});
    else if (!interaction.replied) await interaction.reply({ content: friendly, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ALWAYS-ON HTTP SERVER (health, keepalive, optional Top.gg webhook)
//  ───────────────────────────────────────────────────────────────────────
//  This always binds to PORT — required for 24/7 free-tier hosts
//  (Render, Replit, Koyeb, Fly.io free machines) which kill the service
//  if no port is exposed. The Top.gg vote handler is mounted only if
//  TOPGG_WEBHOOK_AUTH is set.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const app = express();

// `verify` stashes the exact bytes before parsing. Stripe signs the raw body,
// so a re-serialised object never validates — and doing it here, rather than
// with a route-specific express.raw(), means signature verification cannot be
// broken later by someone registering a route above the Stripe one.
// 1mb, not the 100kb default: a Stripe event carrying a subscription with
// several items plus metadata can exceed 100kb, and the body parser rejects
// with a 413 BEFORE the webhook's signature check ever runs — so the event
// would fail verification-less, Stripe would retry it for days, and the
// entitlement behind it would never land.
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Process lifecycle metrics — surfaced on /health for uptime monitors.
const PROCESS_STARTED_AT = Date.now();
const stats = { chatRequests: 0, errors: 0, reconnects: 0, lastReadyAt: null };

app.get('/', (_req, res) => res.type('text/plain').send('GameGuide-AI Discord bot — alive.'));

app.get('/health', (_req, res) => {
  const ready = client.isReady?.() ?? false;
  res.status(ready ? 200 : 503).json({
    ok: ready,
    bot: client.user?.tag || 'starting',
    uptimeSec: Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000),
    wsPing: client.ws?.ping ?? null,
    guilds: client.guilds?.cache?.size ?? 0,
    reconnects: stats.reconnects,
    chatRequests: stats.chatRequests,
    errors: stats.errors,
    lastReadyAt: stats.lastReadyAt,
  });
});

// Plain ping for cron-job.org / UptimeRobot / self-ping. Cheap, no JSON.
app.get('/ping', (_req, res) => res.type('text/plain').send('pong'));

if (TOPGG_WEBHOOK_AUTH) {
  app.post('/topgg-webhook', async (req, res) => {
    if (req.headers.authorization !== TOPGG_WEBHOOK_AUTH) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { user, isWeekend, bot } = req.body || {};
    if (!user) return res.status(400).json({ error: 'missing user' });

    // Credits, NOT a tier — and capped.
    //
    // This used to upsert `tier:'pro'` with a 12-hour expiry, which had two
    // consequences. Top.gg permits a vote every 12 hours, so voting twice a day
    // bought permanent free Pro and nobody ever needed to pay. And because the
    // upsert was keyed on user_id, a LIFETIME customer who voted had their row
    // overwritten and was silently downgraded to a 12-hour expiry.
    try {
      await supabase.from('discord_votes').insert({
        user_id: user, bot_id: bot || null, source: 'topgg', is_weekend: !!isWeekend,
      });
      const result = await grantBonusCredits(supabase, user, {
        credits: isWeekend ? VOTE_BONUS_CREDITS * 2 : VOTE_BONUS_CREDITS,
        hours: VOTE_BONUS_HOURS,
        cap: VOTE_BONUS_CAP,
      });
      console.log(`[topgg] vote → user=${user} granted=${result.granted} balance=${result.balance}`);

      client.users.fetch(String(user))
        .then(u => u.send(
          result.granted > 0
            ? `🗳️ **Thanks for voting!** +${result.granted} bonus messages, good for ${VOTE_BONUS_HOURS}h. You now have **${result.balance}** banked — they're spent before your daily allowance.`
            : `🗳️ **Thanks for voting!** You're already at the ${VOTE_BONUS_CAP}-credit cap — spend a few and vote again later.`,
        ))
        .catch(() => { /* DMs closed */ });

      return res.json({ ok: true, granted: result.granted });
    } catch (e) {
      console.error('[topgg] vote handling failed:', e);
      return res.status(500).json({ error: 'internal' });
    }
  });
}

mountStripeWebhook(app, { supabase, client });

const httpServer = app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP health server listening on :${HTTP_PORT} (/, /health, /ping${TOPGG_WEBHOOK_AUTH ? ', /topgg-webhook' : ''})`);
});
httpServer.on('error', (err) => console.error('[http server error]', err));

// ═══════════════════════════════════════════════════════════════════════════
//  KEEP-ALIVE — self-ping for hosts that sleep idle services
// ═══════════════════════════════════════════════════════════════════════════

if (KEEPALIVE_URL) {
  const url = KEEPALIVE_URL.replace(/\/+$/, '') + '/ping';
  setInterval(async () => {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) console.warn(`[keepalive] ping → HTTP ${res.status}`);
    } catch (e) {
      console.warn(`[keepalive] ping failed: ${e.message}`);
    }
  }, KEEPALIVE_INTERVAL_MS);
  console.log(`🔁 Keep-alive self-ping enabled → ${url} every ${Math.round(KEEPALIVE_INTERVAL_MS / 1000)}s`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  DISCORD CLIENT EVENTS — observability + reconnect tracking
// ═══════════════════════════════════════════════════════════════════════════

client.on('error', (err) => { stats.errors++; console.error('[discord client error]', err.message || err); });
client.on('warn', (msg) => console.warn('[discord warn]', msg));
client.on('shardError', (err, shardId) => { stats.errors++; console.error(`[shard ${shardId} error]`, err.message || err); });
client.on('shardDisconnect', (event, shardId) => console.warn(`[shard ${shardId} disconnect] code=${event?.code} reason=${event?.reason || 'unknown'} — discord.js will auto-reconnect`));
client.on('shardReconnecting', (shardId) => { stats.reconnects++; console.log(`[shard ${shardId}] reconnecting…`); });
client.on('shardResume', (shardId, replayed) => console.log(`[shard ${shardId}] resumed (replayed ${replayed} events)`));
client.on('shardReady', (shardId) => { stats.lastReadyAt = new Date().toISOString(); console.log(`[shard ${shardId}] ready`); });

// Hook into handleChatRequest counter — wrap once at boot.
const _origHandle = handleChatRequest;
handleChatRequest = async function (...args) {
  stats.chatRequests++;
  try { return await _origHandle(...args); }
  catch (e) { stats.errors++; throw e; }
};

// ═══════════════════════════════════════════════════════════════════════════
//  PROCESS-LEVEL RESILIENCE — never crash on transient errors
// ═══════════════════════════════════════════════════════════════════════════

process.on('unhandledRejection', (err) => {
  stats.errors++;
  console.error('[unhandledRejection]', err?.stack || err?.message || err);
});
process.on('uncaughtException', (err) => {
  stats.errors++;
  console.error('[uncaughtException]', err?.stack || err?.message || err);
  // Stay alive — discord.js will reconnect on its own. Only the supervisor (Docker/systemd/PM2/Railway)
  // should decide when to restart the whole process. Crashing the loop here breaks free-tier auto-recovery.
});

// ═══════════════════════════════════════════════════════════════════════════
//  LOGIN SUPERVISOR — retry with exponential backoff forever
// ═══════════════════════════════════════════════════════════════════════════

let shuttingDown = false;

async function loginWithRetry() {
  let attempt = 0;
  while (!shuttingDown) {
    try {
      await client.login(DISCORD_TOKEN);
      console.log('🔐 Logged in to Discord gateway.');
      return; // discord.js handles auto-reconnect internally from here on out
    } catch (err) {
      attempt++;
      stats.errors++;
      // Auth errors (4004 / "Invalid token") are unrecoverable — fail fast so the operator notices.
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('invalid') && msg.includes('token')) {
        console.error('❌ DISCORD_TOKEN is invalid. Cannot recover — fix env var and restart.', err);
        process.exit(1);
      }
      const delay = Math.min(60_000, 2_000 * Math.pow(2, Math.min(attempt, 5))); // cap at 60s
      console.warn(`[login] attempt ${attempt} failed (${err?.message || err}). Retrying in ${delay / 1000}s…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  WATCHDOG — if the client goes "not ready" for too long, force a reconnect
// ═══════════════════════════════════════════════════════════════════════════

const WATCHDOG_INTERVAL_MS = 60_000;     // check every minute
const WATCHDOG_MAX_DOWN_MS = 5 * 60_000; // 5 min of being not-ready → force reconnect
let lastReadySeenAt = Date.now();

setInterval(async () => {
  if (shuttingDown) return;

  // Bound the quota module's in-memory Maps. They only ever pruned entries for
  // users who came back, so a bot in many guilds leaked one entry per user seen.
  quota.sweepAll();

  if (client.isReady()) {
    lastReadySeenAt = Date.now();
    return;
  }
  const downFor = Date.now() - lastReadySeenAt;
  if (downFor > WATCHDOG_MAX_DOWN_MS) {
    console.warn(`[watchdog] client not-ready for ${Math.round(downFor / 1000)}s — destroying and re-logging in.`);
    try { await client.destroy(); } catch { /* ignore */ }
    lastReadySeenAt = Date.now(); // reset so we don't thrash
    stats.reconnects++;
    loginWithRetry().catch(e => console.error('[watchdog] relogin failed:', e));
  }
}, WATCHDOG_INTERVAL_MS);

// ═══════════════════════════════════════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════

const shutdown = (sig) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${sig} received — shutting down gracefully…`);
  try { httpServer.close(); } catch { /* ignore */ }
  try { client.destroy(); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 1500);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Boot ──────────────────────────────────────────────────────────────────
loginWithRetry();
