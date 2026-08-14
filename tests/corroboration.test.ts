import { corroborate } from '../supabase/functions/chat-proxy/corroboration.ts';
import type { CorroborationInput } from '../supabase/functions/chat-proxy/corroboration.ts';

const mk = (url: string, text: string, authority = 5, source = 'web-search', publishedISO?: string): CorroborationInput =>
  ({ source, text, url, authority, publishedISO });

const today = new Date().toISOString().slice(0, 10);
let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`FAIL ${name}\n  want=${JSON.stringify(want)}\n  got =${JSON.stringify(got)}`); };
};

// No sources -> low confidence, explicit training-only directive
const none = corroborate([], false);
check('empty/confidence', none.confidence, 'low');
check('empty/mentions training', none.block.includes('TRAINING DATA ALONE'), true);

// Three independent domains, no conflicts -> high
const three = corroborate([
  mk('https://ign.com/a', 'Season 12 launched with new maps', 6, 'web-search', today),
  mk('https://pcgamer.com/b', 'Season 12 is live now', 6, 'web-search', today),
  mk('https://eurogamer.net/c', 'Season 12 brings changes', 6, 'web-search', today),
], false);
check('three-domains/confidence', three.confidence, 'high');
check('three-domains/count', three.independentDomains, 3);

// Same story republished by aggregators -> NOT independent corroboration
const aggregated = corroborate([
  mk('https://msn.com/a', 'Season 12 launched', 5, 'web-search', today),
  mk('https://news.google.com/b', 'Season 12 launched', 5, 'web-search', today),
  mk('https://reddit.com/c', 'Season 12 launched', 4, 'reddit', today),
], false);
check('aggregators/not-independent', aggregated.independentDomains, 0);
check('aggregators/confidence', aggregated.confidence, 'low');

// Official source alone -> high
const official = corroborate([
  mk('https://store.steampowered.com/news', 'Patch 3.4 released', 10, 'official-news', today),
], false);
check('official/confidence', official.confidence, 'high');

// Conflicting patch versions -> surfaced, and confidence drops off high
const conflict = corroborate([
  mk('https://ign.com/a', 'The current patch is 3.4', 6, 'web-search', today),
  mk('https://pcgamer.com/b', 'Now on patch 3.7', 6, 'web-search', today),
  mk('https://eurogamer.net/c', 'Patch 3.4 details', 6, 'web-search', today),
], false);
check('conflict/detected', conflict.conflicts.length > 0, true);
check('conflict/not-high', conflict.confidence !== 'high', true);
check('conflict/block-warns', conflict.block.includes('CONFLICTING CLAIMS'), true);

// Temporal question answered from stale pages -> demoted from high
const stale = corroborate([
  mk('https://ign.com/a', 'Season 12 is the newest', 6, 'web-search', '2020-01-01'),
  mk('https://pcgamer.com/b', 'Season 12 live', 6, 'web-search', '2020-01-02'),
  mk('https://eurogamer.net/c', 'Season 12', 6, 'web-search', '2020-01-03'),
], true);
check('stale-temporal/demoted', stale.confidence, 'medium');
check('stale-temporal/warns', stale.block.includes('days old'), true);

// Subdomains of one site count once
const subdomains = corroborate([
  mk('https://news.ign.com/a', 'Thing happened', 6, 'web-search', today),
  mk('https://www.ign.com/b', 'Thing happened', 6, 'web-search', today),
], false);
check('subdomains/collapse', subdomains.independentDomains, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
