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

require('dotenv').config();
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

  new SlashCommandBuilder()
    .setName('tip')
    .setDescription('Random elite pro gaming tip'),

  new SlashCommandBuilder()
    .setName('lore')
    .setDescription('Deep-cut lore drop on an iconic game universe')
    .addStringOption(o => o.setName('game').setDescription('Pin to a specific game (optional)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('redpill')
    .setDescription('Hidden gaming-industry secret or unsolved mystery'),

  // ─── Utility ────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show your recent chat history with the bot'),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Wipe your chat history'),

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
  new SlashCommandBuilder()
    .setName('noclip')
    .setDescription('Secret glitch mode activated 👻'),

  new SlashCommandBuilder()
    .setName('konami')
    .setDescription('Unlock the legendary Konami cheat code Easter Egg'),

  new SlashCommandBuilder()
    .setName('loading')
    .setDescription('The eternal gamer struggle'),
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
