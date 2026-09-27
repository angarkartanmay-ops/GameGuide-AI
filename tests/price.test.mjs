// /price game detection — pure logic, no network. Both the website
// (src/services/priceScraper.js) and the Discord bot (discord-bot/cheapshark.js)
// carry the same alias table and resolver, ported by hand, so every check
// here runs against BOTH copies to catch the two drifting apart.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as web from '../src/services/priceScraper.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const botRequire = createRequire(join(ROOT, 'discord-bot', 'package.json'));
const bot = botRequire(join(ROOT, 'discord-bot', 'cheapshark.js'));

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

// ── Run every case on both platforms ────────────────────────────────────
const PLATFORMS = [['web', web], ['discord', bot]];

for (const [name, mod] of PLATFORMS) {
  // Abbreviations resolve to the storefront's actual title, not the literal
  // text CheapShark's own fuzzy search would otherwise be handed.
  check(`${name}: "gta 5" → Grand Theft Auto V`, mod.resolvePriceQuery('gta 5').query === 'Grand Theft Auto V');
  check(`${name}: "gta v" → Grand Theft Auto V`, mod.resolvePriceQuery('gta v').query === 'Grand Theft Auto V');
  check(`${name}: "gta 6" → Grand Theft Auto VI (not swallowed by "gta 5")`, mod.resolvePriceQuery('gta 6').query === 'Grand Theft Auto VI');
  check(`${name}: "gta vi" → Grand Theft Auto VI`, mod.resolvePriceQuery('gta vi').query === 'Grand Theft Auto VI');
  check(`${name}: "bg3" → Baldur's Gate 3`, mod.resolvePriceQuery('bg3').query === "Baldur's Gate 3");
  check(`${name}: "cs2"/"csgo" agree`, mod.resolvePriceQuery('cs2').query === mod.resolvePriceQuery('csgo').query);

  // The bug this whole thing exists to fix: a short, generic key ("final
  // fantasy") must never win over a longer, more specific one that is also
  // present in the text ("final fantasy vii remake"). Both digit and roman
  // numeral spellings must resolve to the SAME title.
  check(
    `${name}: "final fantasy 7 remake" is not swallowed by the bare "final fantasy" alias`,
    mod.resolvePriceQuery('final fantasy 7 remake').query === 'FINAL FANTASY VII REMAKE',
  );
  check(
    `${name}: roman-numeral spelling resolves the same as digits`,
    mod.resolvePriceQuery('final fantasy vii remake').query === mod.resolvePriceQuery('final fantasy 7 remake').query,
  );
  check(`${name}: bare "final fantasy" still falls back to the flagship MMO`, mod.resolvePriceQuery('final fantasy').alias === 'FINAL FANTASY XIV Online');
  check(
    `${name}: "resident evil 4 remake" and "resident evil 4" agree`,
    mod.resolvePriceQuery('resident evil 4 remake').query === mod.resolvePriceQuery('resident evil 4').query,
  );
  check(`${name}: "diablo 4" and "diablo iv" agree`, mod.resolvePriceQuery('diablo 4').query === mod.resolvePriceQuery('diablo iv').query);
  check(
    `${name}: "elden ring nightreign" is a different product from "elden ring"`,
    mod.resolvePriceQuery('elden ring nightreign').query !== mod.resolvePriceQuery('elden ring').query,
  );
  check(`${name}: bare "nightreign" alone still finds it`, mod.resolvePriceQuery('nightreign').alias === 'Elden Ring Nightreign');

  // Free-form chat phrasing — filler stripped, title kept.
  check(
    `${name}: "how much is elden ring nightreign" extracts the title, not the sentence`,
    mod.resolvePriceQuery('how much is elden ring nightreign').query === 'Elden Ring Nightreign',
  );
  check(`${name}: "whats the price of cyberpunk 2077"`, mod.resolvePriceQuery('whats the price of cyberpunk 2077').query === 'Cyberpunk 2077');
  check(`${name}: "how much does gta 5 cost right now"`, mod.resolvePriceQuery('how much does gta 5 cost right now').query === 'Grand Theft Auto V');
  check(`${name}: "is bg3 on sale"`, mod.resolvePriceQuery('is bg3 on sale').query === "Baldur's Gate 3");
  check(`${name}: "is minecraft worth buying"`, mod.resolvePriceQuery('is minecraft worth buying').query === 'Minecraft');

  // No title at all → nothing to search for.
  check(`${name}: empty input resolves to nothing`, mod.resolvePriceQuery('').query === '');
  check(`${name}: whitespace-only input resolves to nothing`, mod.resolvePriceQuery('   ').query === '');

  // ── Price-intent gate ───────────────────────────────────────────────
  check(`${name}: "how much is elden ring" reads as a price question`, mod.looksLikePriceQuestion('how much is elden ring'));
  check(`${name}: "is cyberpunk on sale" reads as a price question`, mod.looksLikePriceQuestion('is cyberpunk 2077 on sale'));
  check(`${name}: "what's the best build for X" does not`, !mod.looksLikePriceQuestion("what's the best build for a mage"));
  check(`${name}: plain chat does not`, !mod.looksLikePriceQuestion('this game is really fun'));

  // ── Subject extraction (what the implicit chat trigger actually uses) ─
  check(`${name}: extracts "Elden Ring Nightreign" from a full question`, mod.extractPriceSubject('how much is elden ring nightreign') === 'Elden Ring Nightreign');
  check(`${name}: no usable subject → empty string, not a garbage query`, mod.extractPriceSubject('is this worth it') === '');
  check(`${name}: a long non-alias sentence is rejected rather than sent verbatim`, mod.extractPriceSubject('what do you think about the story in this game overall') === '');

  // ── Context formatting has no double-wrapped markers ─────────────────
  const ctx = mod.formatPriceContext([{ title: 'Grand Theft Auto V', cheapest: '14.99', cheapestEver: { price: '9.99' }, deals: [] }]);
  check(`${name}: formatPriceContext carries no wrapper (the server adds its own)`, !/=== .*PRICE INTEL/i.test(ctx));
  check(`${name}: formatPriceContext still includes the price`, ctx.includes('14.99'));
  check(`${name}: formatPriceContext on an empty list is empty`, mod.formatPriceContext([]) === '');
}

// ── Cross-platform parity ──────────────────────────────────────────────
// The whole point of porting instead of sharing a file: these must never
// silently drift apart. If this fails, the two ALIASES tables (or the
// intent regex) have diverged and need to be brought back in sync by hand.
const PARITY_INPUTS = [
  'gta 5', 'gta v', 'gta 6', 'bg3', 'cs2', 'csgo', 'final fantasy 7 remake', 'final fantasy vii remake',
  'final fantasy', 'resident evil 4 remake', 'resident evil', 'diablo iv', 'elden ring nightreign',
  'nightreign', 'how much is elden ring nightreign', 'is minecraft worth buying', '',
];
for (const input of PARITY_INPUTS) {
  const w = web.resolvePriceQuery(input);
  const b = bot.resolvePriceQuery(input);
  check(`parity — "${input}": web and Discord resolve the same query`, w.query === b.query, `web=${w.query} bot=${b.query}`);
  check(`parity — "${input}": web and Discord agree on the alias`, w.alias === b.alias, `web=${w.alias} bot=${b.alias}`);
}
for (const input of ['how much is elden ring', 'is cyberpunk on sale', 'this is fun', "what's the best build"]) {
  check(
    `parity — "${input}": price-intent gate agrees`,
    web.looksLikePriceQuestion(input) === bot.looksLikePriceQuestion(input),
  );
}

// ── PriceLookupError exists on both, and is a real Error subclass ──────
check('web: PriceLookupError is an Error', new web.PriceLookupError('x') instanceof Error);
check('discord: PriceLookupError is an Error', new bot.PriceLookupError('x') instanceof Error);

// ── The alias table itself: no exact-duplicate keys, no key hides behind
// itself. Read as data so this catches a copy/paste mistake even though
// the table isn't exported directly. ──────────────────────────────────
function checkAliasIntegrity(name, mod) {
  // Probe indirectly: every alias key, resolved alone, must return itself
  // as the alias (i.e. nothing shorter silently wins first).
  const probes = [
    ['final fantasy vii remake', 'FINAL FANTASY VII REMAKE'],
    ['final fantasy vii rebirth', 'FINAL FANTASY VII REBIRTH'],
    ['final fantasy xiv', 'FINAL FANTASY XIV Online'],
    ['resident evil 4', 'Resident Evil 4'],
    ['resident evil 2', 'Resident Evil 2'],
    ['modern warfare 2', 'Call of Duty Modern Warfare II'],
    ['modern warfare 3', 'Call of Duty Modern Warfare III'],
    ['black ops 6', 'Call of Duty Black Ops 6'],
    ['black ops cold war', 'Call of Duty Black Ops Cold War'],
  ];
  for (const [input, expected] of probes) {
    check(`${name}: alias integrity "${input}"`, mod.resolvePriceQuery(input).alias === expected, mod.resolvePriceQuery(input).alias);
  }
}
checkAliasIntegrity('web', web);
checkAliasIntegrity('discord', bot);

console.log(`price: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
