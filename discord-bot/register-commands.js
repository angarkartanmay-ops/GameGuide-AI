// ═══════════════════════════════════════════════════════════════════════════
//  GameGuide-AI :: Slash Command Registrar
//  ───────────────────────────────────────────────────────────────────────
//  Run ONCE (or whenever you change command definitions) to register the
//  slash commands with Discord.
//
//    npm run register                       ← global (~1h propagation)
//    npm run register -- <GUILD_ID>         ← guild-specific (instant, dev)
//
//  Required .env keys:
//    DISCORD_TOKEN
//    DISCORD_CLIENT_ID  — from https://discord.com/developers/applications
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config({ quiet: true });
const { SlashCommandBuilder, REST, Routes } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.argv[2] || process.env.DISCORD_GUILD_ID || null;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env');
  console.error('   Get CLIENT_ID from https://discord.com/developers/applications → your app → Application ID');
  process.exit(1);
}

const commands = [
  // ─── Core ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask GameGuide-AI anything (supports image attachments)')
    .addStringOption(o => o.setName('question').setDescription('Your gaming question').setRequired(true))
    .addAttachmentOption(o => o.setName('image').setDescription('Optional screenshot for vision analysis').setRequired(false)),

  new SlashCommandBuilder()
    .setName('price')
    .setDescription('Live multi-store prices for a PC game (CheapShark)')
    .addStringOption(o => o.setName('game').setDescription('Game title (e.g. "elden ring")').setRequired(true)),

  // Replaces /tip, /lore and /redpill — three commands that issued three
  // nearly identical prompts and each cost a full quota turn. Discord's native
  // option picker means folding them loses nothing: leave `category` empty for
  // a random pick, or choose one.
  new SlashCommandBuilder()
    .setName('discover')
    .setDescription('Random pro tip, hidden industry secret, or lore drop')
    .addStringOption(o => o
      .setName('category')
      .setDescription('Leave empty for a random pick')
      .setRequired(false)
      .addChoices(
        { name: '💡 Pro tip', value: 'tip' },
        { name: '📜 Lore drop', value: 'lore' },
        { name: '🔴 Industry secret', value: 'secret' },
      ))
    .addStringOption(o => o.setName('game').setDescription('Pin a lore drop to a specific game (optional)').setRequired(false)),

  // ─── Utility ────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show your recent chat history with the bot'),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Wipe your chat history'),

  new SlashCommandBuilder()
    .setName('quota')
    .setDescription('How many messages and screenshots you have left today'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Global + your personal usage stats'),

  new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Upgrade to Pro tier for higher rate limits'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands'),

  // ─── Fun / vibe (parity with the web app) ───────────────────────────────
  // /noclip and /loading were dropped here and on the web: static joke text
  // that cost a command slot and taught users nothing about what the bot does.
  new SlashCommandBuilder()
    .setName('konami')
    .setDescription('Unlock the legendary Konami cheat code Easter Egg'),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    if (GUILD_ID) {
      console.log(`Registering ${commands.length} commands to guild ${GUILD_ID} (instant)...`);
      const data = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands },
      );
      console.log(`✓ Registered ${data.length} guild commands.`);
    } else {
      console.log(`Registering ${commands.length} commands GLOBALLY (~1h to propagate)...`);
      const data = await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands },
      );
      console.log(`✓ Registered ${data.length} global commands.`);
    }
  } catch (err) {
    console.error('❌ Registration failed:', err);
    process.exit(1);
  }
})();
