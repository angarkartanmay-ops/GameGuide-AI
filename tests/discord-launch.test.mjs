// Discord bot — public-launch invariants.
//
// Every assertion here pins something that was wrong before the pre-launch
// audit and would get the bot declined or removed by a server admin:
//
//   * the invite requested Mute/Deafen Members, Manage Messages and Manage
//     Expressions while omitting Read Message History and Attach Files;
//   * model output could ping @everyone, roles and arbitrary users;
//   * @everyone / @here announcements triggered a reply (billed to the poster);
//   * the privileged Message Content intent was requested for no benefit;
//   * /clear claimed a wipe that could have failed;
//   * a registered slash command with no handler times out silently.
//
// The permission integer is derived from discord.js's own PermissionFlagsBits,
// never re-typed — a hand-computed value is how the original went wrong.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BOT = join(ROOT, 'discord-bot');
const botRequire = createRequire(join(BOT, 'package.json'));
const { PermissionFlagsBits: P } = botRequire('discord.js');

const INDEX = readFileSync(join(BOT, 'index.js'), 'utf8');
const REGISTER = readFileSync(join(BOT, 'register-commands.js'), 'utf8');
const README = readFileSync(join(BOT, 'README.md'), 'utf8');
const INFO = readFileSync(join(ROOT, 'src', 'components', 'InfoPage.jsx'), 'utf8');
const LANDING = readFileSync(join(ROOT, 'src', 'components', 'LandingPage.jsx'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

// ── invite permissions ─────────────────────────────────────────────────────
const REQUIRED = ['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'EmbedLinks',
  'AttachFiles', 'ReadMessageHistory', 'UseApplicationCommands'];
const FORBIDDEN = ['Administrator', 'ManageMessages', 'MuteMembers', 'DeafenMembers',
  'ManageGuildExpressions', 'MentionEveryone', 'ManageRoles', 'ManageChannels',
  'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageWebhooks', 'ManageGuild'];

const MINIMAL = REQUIRED.reduce((v, k) => v | P[k], 0n);

const inviteInts = [
  ...[...INFO.matchAll(/permissions=(\d+)/g)].map(m => ['InfoPage.jsx', m[1]]),
  ...[...LANDING.matchAll(/permissions=(\d+)/g)].map(m => ['LandingPage.jsx', m[1]]),
  ...[...README.matchAll(/permissions=(\d+)/g)].map(m => ['discord-bot/README.md', m[1]]),
];
check('invite links exist on the site and in the README', inviteInts.length >= 3, String(inviteInts.length));
for (const [file, raw] of inviteInts) {
  const v = BigInt(raw);
  check(`${file}: invite is exactly the minimal set`, v === MINIMAL, `${raw} vs ${MINIMAL}`);
  for (const k of FORBIDDEN) check(`${file}: invite does not request ${k}`, (v & P[k]) === 0n);
  for (const k of REQUIRED) check(`${file}: invite includes ${k}`, (v & P[k]) === P[k]);
}

// ── intents ────────────────────────────────────────────────────────────────
check('no privileged Message Content intent', !/GatewayIntentBits\.MessageContent/.test(INDEX));
check('no privileged Guild Members intent', !/GatewayIntentBits\.GuildMembers/.test(INDEX));
check('no privileged Presence intent', !/GatewayIntentBits\.GuildPresences/.test(INDEX));
check('DM intent still present for DM chat', /GatewayIntentBits\.DirectMessages/.test(INDEX));

// ── mentions ───────────────────────────────────────────────────────────────
check('client default suppresses every ping',
  /allowedMentions:\s*\{\s*parse:\s*\[\]\s*,\s*repliedUser:\s*false\s*\}/.test(
    INDEX.slice(INDEX.indexOf('new Client('), INDEX.indexOf('new Client(') + 1600)));
{
  // A per-message allowedMentions REPLACES the client default, so each one must
  // restate parse: [] or it silently re-enables pings for that message.
  const perMessage = [...INDEX.matchAll(/allowedMentions:\s*\{([^}]*)\}/g)].map(m => m[1]);
  check('found per-message allowedMentions', perMessage.length > 0);
  perMessage.forEach((body, i) =>
    check(`allowedMentions #${i + 1} keeps parse: []`, /parse:\s*\[\]/.test(body), body.trim()));
}
check('@everyone / @here / role pings do not trigger a reply',
  /mentions\.has\(client\.user,\s*\{\s*ignoreEveryone:\s*true,\s*ignoreRoles:\s*true\s*\}\)/.test(INDEX));
check('DMs are answered without a mention', /isDM\s*=\s*!message\.inGuild\(\)/.test(INDEX));
check('guild turns check send permission before spending quota',
  /permissionsFor\?\.\(client\.user\)/.test(INDEX) && /PermissionFlagsBits\.SendMessages/.test(INDEX));

// ── correctness ────────────────────────────────────────────────────────────
check('no deprecated `ephemeral:` option', !/\bephemeral:\s*true/.test(INDEX));
{
  const fn = INDEX.slice(INDEX.indexOf('async function clearUserHistory'),
    INDEX.indexOf('async function bumpStats'));
  check('/clear inspects the supabase error instead of assuming success', /if \(error\)/.test(fn));
  check('/clear has a distinct failure outcome', /'failed'/.test(fn));
}
check('/konami has no markdown table (Discord cannot render them)', !/\|-{3,}/.test(INDEX));
check('/konami no longer carries the invented Wingdings claim', !/wingdings/i.test(INDEX));
check('/stats aggregates server-side', /rpc\('gg_discord_global_stats'\)/.test(INDEX));

// ── registered commands ↔ handlers ─────────────────────────────────────────
// A registered command with no `case` makes Discord show "The application did
// not respond"; a handler with no registration is unreachable dead code.
{
  const registered = new Set([...REGISTER.matchAll(/SlashCommandBuilder\(\)\s*\.setName\('([a-z0-9_-]+)'\)/g)].map(m => m[1]));
  const handlerBlock = INDEX.slice(INDEX.indexOf("client.on('interactionCreate'"));
  const handled = new Set([...handlerBlock.matchAll(/case '([a-z0-9_-]+)':/g)].map(m => m[1]));
  check('found registered commands', registered.size >= 5, [...registered].join(','));
  for (const c of registered) check(`/${c} has a handler`, handled.has(c));
  for (const c of handled) check(`handler '${c}' is registered`, registered.has(c));

  const help = INDEX.slice(INDEX.indexOf("case 'help'"), INDEX.indexOf("case 'help'") + 2500);
  for (const c of registered) {
    if (c === 'help') continue;
    check(`/help lists /${c}`, help.includes('`/' + c));
  }
}

// ── Watchtower is an admin tool ────────────────────────────────────────────
// /watch posts into channels on the server's behalf. Visible to every member,
// anyone could point patch spam at #general.
{
  const def = REGISTER.slice(REGISTER.indexOf(".setName('watch')"), REGISTER.indexOf(".setName('watch')") + 600);
  check('/watch defaults to Manage Server', def.includes('.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)'));
  check('/watch is server-only', def.includes('.setContexts(InteractionContextType.Guild)'));
  check('/watch checks the bot can post before saving', INDEX.includes('WATCH_POST_PERMS.filter'));
  check('leaving a server deletes its watches', INDEX.includes("client.on('guildDelete'") && INDEX.includes('deleteGuild('));
  check('deleting a channel deletes its watches', INDEX.includes("client.on('channelDelete'") && INDEX.includes('deleteChannel('));
}

console.log(`discord-launch: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
