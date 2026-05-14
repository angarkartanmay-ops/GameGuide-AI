// ═══════════════════════════════════════════════════════════════════════════
//  GameGuide-AI :: Discord Bot v2.0 (production)
//  ───────────────────────────────────────────────────────────────────────
//  Full feature-parity with the web app + monetization hooks.
//
//  Slash commands:    /ask /price /tip /lore /redpill /noclip /konami
//                     /loading /clear /history /stats /premium /help
//  Mention chat:      @GameGuide <question> [+ image attachments]
//  Vision:            up to 3 images per message, GODMODE pipeline
//  History:           per-user, persistent in Supabase (table: discord_chat_messages)
//  Tiers:             FREE 5/min · PRO 30/min · PREMIUM_SERVER 60/min
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
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { fetchPriceDirect } = require('./cheapshark');

// ─── Native fetch sanity ───────────────────────────────────────────────────
if (typeof fetch !== 'function') {
  throw new Error('Native fetch not available. Upgrade Node to 18+.');
}

// ─── Env ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // for bot-side writes
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PREMIUM_USER_IDS = (process.env.PREMIUM_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const PREMIUM_GUILD_IDS = (process.env.PREMIUM_GUILD_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const PATREON_URL = process.env.PATREON_URL || '';
const KOFI_URL = process.env.KOFI_URL || '';
const STRIPE_PAYMENT_LINK = process.env.STRIPE_PAYMENT_LINK || '';
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
const MAX_HISTORY_PER_USER = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_FREE = 5;
const RATE_LIMIT_PRO = 30;
const RATE_LIMIT_PREMIUM_SERVER = 60;
const PROXY_TIMEOUT_MS = 60_000;
const TYPING_PULSE_MS = 8_000;
const VOTE_REWARD_HOURS = 12; // free PRO tier for 12h after voting

// ─── In-memory state ───────────────────────────────────────────────────────
const rateLimits = new Map();        // userId → [timestamps]
const premiumCacheUser = new Map();  // userId → { tier, expiresAt, fetchedAt }
const premiumCacheGuild = new Map(); // guildId → { tier, expiresAt, fetchedAt }
const PREMIUM_CACHE_MS = 5 * 60_000;
const historyCache = new Map();      // userId → { history: [], fetchedAt }
const HISTORY_CACHE_MS = 30_000;     // small cache to dedupe rapid replies

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers — tier resolution + rate limiting
// ═══════════════════════════════════════════════════════════════════════════

async function resolveUserTier(userId) {
  // Env override always wins (zero-DB hot config for the operator).
  if (PREMIUM_USER_IDS.includes(userId)) return 'pro';

  const cached = premiumCacheUser.get(userId);
  if (cached && Date.now() - cached.fetchedAt < PREMIUM_CACHE_MS) {
    if (!cached.expiresAt || new Date(cached.expiresAt) > new Date()) return cached.tier;
    return 'free';
  }

  try {
    const { data } = await supabase
      .from('discord_premium')
      .select('tier, expires_at')
      .eq('user_id', userId)
      .maybeSingle();
    const tier = data && (!data.expires_at || new Date(data.expires_at) > new Date()) ? data.tier : 'free';
    premiumCacheUser.set(userId, { tier, expiresAt: data?.expires_at, fetchedAt: Date.now() });
    return tier;
  } catch {
    return 'free';
  }
}

async function resolveGuildTier(guildId) {
  if (!guildId) return 'free';
  if (PREMIUM_GUILD_IDS.includes(guildId)) return 'premium-server';

  const cached = premiumCacheGuild.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < PREMIUM_CACHE_MS) {
    if (!cached.expiresAt || new Date(cached.expiresAt) > new Date()) return cached.tier;
    return 'free';
  }

  try {
    const { data } = await supabase
      .from('discord_premium_servers')
      .select('expires_at')
      .eq('guild_id', guildId)
      .maybeSingle();
    const tier = data && (!data.expires_at || new Date(data.expires_at) > new Date()) ? 'premium-server' : 'free';
    premiumCacheGuild.set(guildId, { tier, expiresAt: data?.expires_at, fetchedAt: Date.now() });
    return tier;
  } catch {
    return 'free';
  }
}

async function effectiveLimit(userId, guildId) {
  const [userTier, guildTier] = await Promise.all([
    resolveUserTier(userId),
    resolveGuildTier(guildId),
  ]);
  if (guildTier === 'premium-server') return { tier: 'premium-server', limit: RATE_LIMIT_PREMIUM_SERVER };
  if (userTier === 'pro' || userTier === 'lifetime') return { tier: userTier, limit: RATE_LIMIT_PRO };
  return { tier: 'free', limit: RATE_LIMIT_FREE };
}

function checkRateLimit(userId, limit) {
  const now = Date.now();
  const stamps = (rateLimits.get(userId) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (stamps.length >= limit) {
    return { allowed: false, waitSec: Math.ceil((RATE_LIMIT_WINDOW_MS - (now - stamps[0])) / 1000), limit };
  }
  stamps.push(now);
  rateLimits.set(userId, stamps);
  return { allowed: true, remaining: limit - stamps.length, limit };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers — chat history (Supabase persistent + in-memory cache)
// ═══════════════════════════════════════════════════════════════════════════

async function getHistory(userId) {
  const cached = historyCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < HISTORY_CACHE_MS) return cached.history;
  try {
    const { data } = await supabase
      .from('discord_chat_messages')
      .select('text, sender, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_PER_USER);
    const history = (data || []).reverse().map(r => ({ sender: r.sender, text: r.text }));
    historyCache.set(userId, { history, fetchedAt: Date.now() });
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
    await supabase.from('discord_chat_messages').insert({
      user_id: userId,
      guild_id: guildId || null,
      sender,
      text: text.slice(0, 4000),
    });
  } catch (e) {
    console.warn('[history] write failed:', e.message);
  }
}

async function clearUserHistory(userId) {
  historyCache.delete(userId);
  if (!supabaseHasServiceRole) return false;
  try {
    await supabase.from('discord_chat_messages').delete().eq('user_id', userId);
    return true;
  } catch (e) {
    console.warn('[history] clear failed:', e.message);
    return false;
  }
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

// Cap each Discord message at 1900 chars (under the 2000 limit, leaves room for source line).
function splitForDiscord(text, max = 1900) {
  if (!text) return [];
  const chunks = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if ((buf + line + '\n').length > max) {
      if (buf) chunks.push(buf.trimEnd());
      if (line.length > max) {
        for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
        buf = '';
      } else {
        buf = line + '\n';
      }
    } else {
      buf += line + '\n';
    }
  }
  if (buf.trim()) chunks.push(buf.trimEnd());
  return chunks;
}

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

async function fetchAttachmentAsBase64(att) {
  if (!att.contentType || !att.contentType.startsWith('image/')) return null;
  if (att.size > 8 * 1024 * 1024) return null;
  try {
    const res = await fetch(att.url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { mimeType: att.contentType, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

async function callChatProxy({ prompt, history, attachments }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
  try {
    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        prompt,
        chatHistory: history,
        attachments: attachments || [],
      }),
    });
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

async function sendLongResponse(replyTarget, text, footer = '') {
  const finalText = footer ? `${text}\n\n${footer}` : text;
  const chunks = splitForDiscord(finalText);
  if (chunks.length === 0) {
    if (replyTarget.editReply) return replyTarget.editReply('*(empty response)*');
    if (replyTarget.reply) return replyTarget.reply('*(empty response)*');
    return replyTarget.send('*(empty response)*');
  }
  if (replyTarget.editReply) {
    await replyTarget.editReply({ content: chunks[0] });
  } else if (replyTarget.reply) {
    await replyTarget.reply({ content: chunks[0], allowedMentions: { repliedUser: false } });
  } else {
    await replyTarget.send(chunks[0]);
  }
  for (let i = 1; i < chunks.length; i++) {
    if (replyTarget.followUp) await replyTarget.followUp({ content: chunks[i] });
    else if (replyTarget.channel) await replyTarget.channel.send(chunks[i]);
  }
}

function userFacingError(err) {
  const msg = (err.message || String(err)).toLowerCase();
  if (msg.includes('timeout')) return '⏱️ **The Neural Net is taking longer than expected.** Try again in a few seconds.';
  if (msg.includes('429') || msg.includes('rate')) return '⚠️ **API rate limit reached.** Please wait 15–30 seconds.';
  if (msg.includes('503') || msg.includes('502') || msg.includes('500')) return '🛠️ **Backend is temporarily overloaded.** Try again in 30 seconds.';
  if (msg.includes('401') || msg.includes('403')) return '🔒 **Authentication problem.** The bot operator should check the Supabase keys.';
  return '❌ **Connection issue.** Try again shortly.';
}

// ═══════════════════════════════════════════════════════════════════════════
//  CORE — handle a chat-style request (mention or /ask)
// ═══════════════════════════════════════════════════════════════════════════

async function handleChatRequest({ userId, guildId, prompt, attachments, replyTarget, channel, skipRateLimit }) {
  const cleaned = prompt.trim();
  if (!cleaned && (!attachments || attachments.length === 0)) {
    const msg = 'Please give me a question, or attach an image to analyse.';
    return replyTarget.editReply ? replyTarget.editReply(msg) : replyTarget.reply(msg);
  }

  // Rate limit (tier-aware) — skip when caller already counted the request (e.g. /price fallback)
  const { tier, limit } = await effectiveLimit(userId, guildId);
  const rl = skipRateLimit ? { allowed: true, limit } : checkRateLimit(userId, limit);
  if (!rl.allowed) {
    const tierLabel = tier === 'premium-server' ? '🌟 Premium Server'
      : tier === 'pro' || tier === 'lifetime' ? '⭐ Pro'
      : '🆓 Free';
    const upsell = tier === 'free'
      ? `\n\nUpgrade with \`/premium\` to lift the cap to ${RATE_LIMIT_PRO}/min.`
      : '';
    const out = `⏳ **Rate limit reached** (${tierLabel}: ${rl.limit}/min). Try again in **${rl.waitSec}s**.${upsell}`;
    return replyTarget.editReply ? replyTarget.editReply(out) : replyTarget.reply(out);
  }

  // Typing indicator
  let typingTimer = null;
  if (channel?.sendTyping) {
    channel.sendTyping().catch(() => {});
    typingTimer = setInterval(() => channel.sendTyping().catch(() => {}), TYPING_PULSE_MS);
  }

  try {
    const history = await getHistory(userId);
    const data = await callChatProxy({ prompt: cleaned, history, attachments });

    // Persist history + bump stats (fire-and-forget)
    pushHistory(userId, guildId, 'user', cleaned).catch(() => {});
    pushHistory(userId, guildId, 'ai', data.text).catch(() => {});
    bumpStats(userId, !!attachments?.length).catch(() => {});

    // Build telemetry footer (no model/provider leak — server already redacts).
    const sources = (data._meta?.sources || []).filter(Boolean);
    const uniqueSources = [...new Set(sources)];
    const persona = data._meta?.persona ? `${data._meta.personaEmoji || '🤖'} ${data._meta.persona}` : '';
    const sourceLine = uniqueSources.length > 0
      ? `*— ${persona ? persona + ' · ' : ''}📡 ${uniqueSources.length} live source${uniqueSources.length > 1 ? 's' : ''}: ${uniqueSources.join(', ')}*`
      : (persona ? `*— ${persona}*` : '');

    // Apply affiliate decoration when CheapShark / store URLs appear
    const decorated = decorateWithAffiliate(data.text);
    await sendLongResponse(replyTarget, decorated, sourceLine);
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
//  CLIENT
// ═══════════════════════════════════════════════════════════════════════════

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once('clientReady', () => {
  console.log(`🎮 GameGuide-AI Bot online as ${client.user.tag}`);
  console.log(`   Proxy: ${CHAT_PROXY_URL}`);
  console.log(`   Premium users (env): ${PREMIUM_USER_IDS.length}`);
  console.log(`   Premium guilds (env): ${PREMIUM_GUILD_IDS.length}`);
  console.log(`   Service role key: ${supabaseHasServiceRole ? 'configured' : 'NOT configured (history disabled)'}`);
  client.user.setActivity('🎮 /help · @ me with anything', { type: 0 });
});

// ─── Mention listener (free-form chat, mirrors /ask) ──────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();
  const hasAttachments = message.attachments.size > 0;
  if (!prompt && !hasAttachments) return;

  const attachments = [];
  if (hasAttachments) {
    for (const att of message.attachments.values()) {
      const enc = await fetchAttachmentAsBase64(att);
      if (enc) attachments.push(enc);
      if (attachments.length >= 3) break;
    }
  }

  await handleChatRequest({
    userId: message.author.id,
    guildId: message.guildId,
    prompt: prompt || 'Analyze this image.',
    attachments,
    replyTarget: message,
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

        // Rate-limit /price the same way chat is rate-limited.
        const { tier, limit } = await effectiveLimit(userId, guildId);
        const rl = checkRateLimit(userId, limit);
        if (!rl.allowed) {
          const tierLabel = tier === 'premium-server' ? '🌟 Premium Server'
            : tier === 'pro' || tier === 'lifetime' ? '⭐ Pro'
            : '🆓 Free';
          return interaction.editReply(
            `⏳ **Rate limit reached** (${tierLabel}: ${rl.limit}/min). Try again in **${rl.waitSec}s**.`
          );
        }

        // Live CheapShark — mirrors the web app's /price path (no LLM hop).
        const data = await fetchPriceDirect(game);
        if (data && (data.cheapest || data.deals?.length)) {
          bumpStats(userId, false).catch(() => {});
          return interaction.editReply(formatPriceEmbed(data));
        }

        // Fallback: nothing on CheapShark — let the LLM try with web search.
        // (Still rate-limited above, so no double-counting.)
        return handleChatRequest({
          userId, guildId,
          prompt: `What's the current price for "${game}" on PC? Use live data and include store URLs. If you can't find anything, say so directly.`,
          attachments: [],
          replyTarget: interaction, channel: interaction.channel,
          skipRateLimit: true,
        });
      }

      case 'tip': {
        await interaction.deferReply();
        return handleChatRequest({
          userId, guildId,
          prompt: 'Give me ONE elite pro gaming tip — concise, scannable, with **bold key terms**. Open with "💡 Pro Tip Unlocked".',
          attachments: [],
          replyTarget: interaction, channel: interaction.channel,
        });
      }

      case 'lore': {
        const game = interaction.options.getString('game') || '';
        await interaction.deferReply();
        const prompt = game
          ? `Give me a deep-cut lore drop about ${game}. Open with "📜 The Untold Story" — something most players miss. Use blockquotes for in-game text.`
          : 'Give me a deep-cut lore drop about a random iconic game universe. Open with "📜 The Untold Story" — something most players miss.';
        return handleChatRequest({
          userId, guildId, prompt, attachments: [],
          replyTarget: interaction, channel: interaction.channel,
        });
      }

      case 'redpill': {
        await interaction.deferReply();
        return handleChatRequest({
          userId, guildId,
          prompt: 'Drop a hidden gaming-industry secret, accident, or unsolved mystery. Open with "🔴 Truth Unlocked" and use **bold key terms**.',
          attachments: [],
          replyTarget: interaction, channel: interaction.channel,
        });
      }

      case 'noclip':
        return interaction.reply({
          content:
`## 👻 NOCLIP MODE ACTIVATED
\`\`\`
WARNING: You have clipped outside the world boundary.
Physics: DISABLED
Collision: DISABLED
Game Master awareness: ENABLED

You can see the void now.
The dev notes are everywhere.
Someone left a sticky note that says: 'fix this before launch'
They did not fix it before launch.
\`\`\`
*Type anything to re-enter the simulation.*`,
        });

      case 'konami':
        return interaction.reply({
          content:
`## 🎮 ↑ ↑ ↓ ↓ ← → ← → B A
**KONAMI CODE ACCEPTED. 30 LIVES GRANTED.**

> *The Konami Code was created by developer Kazuhisa Hashimoto in 1986 while testing Gradius. He found the game too hard, so he added a cheat. He forgot to remove it before shipping. Players discovered it, and a legend was born.*

| Code Origin | Game | Effect |
|-------------|------|--------|
| 1986 | Gradius | Full power-up |
| 1988 | Contra | 30 lives |
| 2007 | ESPN.com | Unicorn confetti |
| 2013 | Google | Searches in Wingdings |

**One of the most recognized button combinations in human history.** 🎖️`,
        });

      case 'loading':
        return interaction.reply({
          content:
`## ⏳ Loading...
\`███████████████████░░░░░░\` 74%

*Estimated time remaining: Soon™*

> *While you wait, the developers added a loading screen tip: "Have you tried turning it off and on again?"*

**Fun fact:** Players collectively spend over **500 million hours per year** watching loading screens. That's 57,000 years of human time. Yearly. Just waiting.`,
        });

      case 'clear': {
        const ok = await clearUserHistory(userId);
        return interaction.reply({
          content: ok
            ? '🗑️ **Your chat history with me has been wiped.**'
            : '🗑️ **Memory cleared.** (History persistence is currently disabled — only this session\'s in-memory cache was cleared.)',
          ephemeral: true,
        });
      }

      case 'history': {
        const history = await getHistory(userId);
        if (history.length === 0) {
          return interaction.reply({ content: 'You have no chat history yet. Try `/ask` or @-mention me.', ephemeral: true });
        }
        const lines = history.slice(-MAX_HISTORY_PER_USER).map(m => {
          const tag = m.sender === 'user' ? '🧑' : '🤖';
          return `${tag} ${m.text.slice(0, 250)}${m.text.length > 250 ? '…' : ''}`;
        });
        const embed = new EmbedBuilder()
          .setColor(0x00FFD1)
          .setTitle('📚 Your Recent Chat History')
          .setDescription(lines.join('\n\n').slice(0, 4000))
          .setFooter({ text: `Showing last ${history.length} message(s) · use /clear to wipe` });
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      case 'stats': {
        let global = { total: '?', vision: '?', users: '?' };
        try {
          const { data } = await supabase.from('discord_usage_stats').select('total_calls, vision_calls');
          if (data) {
            global = {
              total: data.reduce((s, r) => s + (r.total_calls || 0), 0).toLocaleString(),
              vision: data.reduce((s, r) => s + (r.vision_calls || 0), 0).toLocaleString(),
              users: data.length.toLocaleString(),
            };
          }
        } catch { /* fine */ }

        let userRow = null;
        try {
          const { data } = await supabase.from('discord_usage_stats').select('total_calls, vision_calls, last_call_at').eq('user_id', userId).maybeSingle();
          userRow = data;
        } catch { /* fine */ }

        const tier = await resolveUserTier(userId);
        const guildTier = await resolveGuildTier(guildId);
        const effLimit = guildTier === 'premium-server' ? RATE_LIMIT_PREMIUM_SERVER
          : (tier === 'pro' || tier === 'lifetime') ? RATE_LIMIT_PRO : RATE_LIMIT_FREE;

        const embed = new EmbedBuilder()
          .setColor(0x00FFD1)
          .setTitle('📊 GameGuide-AI Stats')
          .addFields(
            { name: '🌍 Global', value: `**${global.total}** answers across **${global.users}** users\n**${global.vision}** vision queries`, inline: false },
            { name: '👤 You', value: userRow
                ? `**${(userRow.total_calls || 0).toLocaleString()}** calls · **${(userRow.vision_calls || 0).toLocaleString()}** vision\nLast call: <t:${Math.floor(new Date(userRow.last_call_at).getTime() / 1000)}:R>`
                : 'No calls yet — try `/ask`!',
              inline: false },
            { name: '🎟️ Your tier', value: `${guildTier === 'premium-server' ? '🌟 Premium Server' : (tier === 'pro' || tier === 'lifetime' ? '⭐ Pro' : '🆓 Free')} · **${effLimit}/min** rate limit`, inline: false },
          );
        return interaction.reply({ embeds: [embed] });
      }

      case 'premium': {
        const tier = await resolveUserTier(userId);
        const guildTier = await resolveGuildTier(guildId);
        const isPremium = tier === 'pro' || tier === 'lifetime' || guildTier === 'premium-server';
        const embed = new EmbedBuilder()
          .setColor(isPremium ? 0xFFD700 : 0x00FFD1)
          .setTitle(isPremium ? '⭐ You\'re already on Premium' : '⭐ Upgrade to GameGuide Premium')
          .setDescription(isPremium
            ? `Thank you for supporting GameGuide-AI! You have access to:\n\n• **${RATE_LIMIT_PRO}/min** rate limit (free tier is ${RATE_LIMIT_FREE})\n• Priority routing\n• Persistent chat history\n• Early access to new features`
            : `Free tier: **${RATE_LIMIT_FREE} calls/min** · Pro tier: **${RATE_LIMIT_PRO} calls/min**\n\n**What you get with Pro:**\n• 6× more queries per minute\n• Priority during peak hours\n• Persistent chat history\n• Early access to new features\n• Support a solo dev keeping the bot free for everyone`);

        const buttons = [];
        if (STRIPE_PAYMENT_LINK) buttons.push(new ButtonBuilder().setLabel('💳 Upgrade ($3/mo)').setStyle(ButtonStyle.Link).setURL(STRIPE_PAYMENT_LINK));
        if (PATREON_URL) buttons.push(new ButtonBuilder().setLabel('🎨 Patreon').setStyle(ButtonStyle.Link).setURL(PATREON_URL));
        if (KOFI_URL) buttons.push(new ButtonBuilder().setLabel('☕ Ko-fi').setStyle(ButtonStyle.Link).setURL(KOFI_URL));
        if (TOPGG_VOTE_URL) buttons.push(new ButtonBuilder().setLabel(`🗳️ Vote for ${VOTE_REWARD_HOURS}h free Pro`).setStyle(ButtonStyle.Link).setURL(TOPGG_VOTE_URL));

        const components = buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];
        return interaction.reply({ embeds: [embed], components });
      }

      case 'help': {
        const embed = new EmbedBuilder()
          .setColor(0x00FFD1)
          .setTitle('🎮 GameGuide-AI Command Reference')
          .setDescription('**@mention** me for free-form chat (with image support), or use these slash commands:')
          .addFields(
            { name: '🎯 Core', value:
                '`/ask <question> [image]` — ask anything\n' +
                '`/price <game>` — live multi-store prices\n' +
                '`/tip` — random elite pro gaming tip\n' +
                '`/lore [game]` — deep-cut lore drop\n' +
                '`/redpill` — hidden gaming-industry secret', inline: false },
            { name: '🛠️ Utility', value:
                '`/history` — show your recent chat with me\n' +
                '`/clear` — wipe your chat history\n' +
                '`/stats` — global + your usage stats\n' +
                '`/premium` — upgrade for higher rate limits', inline: false },
            { name: '🎉 Fun', value:
                '`/noclip` · `/konami` · `/loading` — vibe commands', inline: false },
          )
          .setFooter({ text: `Free: ${RATE_LIMIT_FREE}/min · Pro: ${RATE_LIMIT_PRO}/min · Premium Server: ${RATE_LIMIT_PREMIUM_SERVER}/min` });
        return interaction.reply({ embeds: [embed] });
      }
    }
  } catch (err) {
    console.error(`[interaction] ${interaction.commandName} failed:`, err);
    const friendly = userFacingError(err);
    if (interaction.deferred) await interaction.editReply(friendly).catch(() => {});
    else if (!interaction.replied) await interaction.reply({ content: friendly, ephemeral: true }).catch(() => {});
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
app.use(express.json());

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

    const expiresAt = new Date(Date.now() + (isWeekend ? VOTE_REWARD_HOURS * 2 : VOTE_REWARD_HOURS) * 3600_000).toISOString();
    try {
      await supabase.from('discord_votes').insert({
        user_id: user, bot_id: bot || null, source: 'topgg', is_weekend: !!isWeekend,
      });
      await supabase.from('discord_premium').upsert({
        user_id: user, tier: 'pro', source: 'topgg-vote', expires_at: expiresAt,
      });
      premiumCacheUser.delete(user);
      console.log(`[topgg] vote rewarded → user=${user} expires=${expiresAt}`);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[topgg] vote handling failed:', e);
      return res.status(500).json({ error: 'internal' });
    }
  });
}

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
