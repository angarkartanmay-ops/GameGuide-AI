// Freshness regressions: answers must be reasoned from TODAY.
//
// Reproduced in production on 2026-11-20, the day after Grand Theft Auto VI
// launched: "is GTA 6 out?" was answered with "it's coming November 19,
// 2026". Each guard below matches one of the causes listed in
// supabase/functions/chat-proxy/freshness.ts.

import {
  normalizeHitDate, ageLabel, isReleaseStatusQuestion, findElapsedFutureDates,
  buildElapsedDatesBlock, buildDateGrounding, humanDate,
} from '../supabase/functions/chat-proxy/freshness.ts';
import { detectTemporal } from '../supabase/functions/chat-proxy/temporalDetector.ts';
import { rankBlocks } from '../supabase/functions/chat-proxy/recencyRanker.ts';
import { canonicalTitle, titleAliases, aliasRegex } from './.generated/titles.ts';
import { TEMPORAL_HINT_RX } from './.generated/detection.ts';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) console.error(`  FAIL: ${name}\n        got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

const TODAY = '2026-11-20';
const NOW = Date.parse('2026-11-20T15:00:00Z');
const DAY = 86_400_000;

// ── 1. Search-result dates: the relative form must parse ──────────────────
// Serper and Brave label their NEWEST results "2 days ago". Unparsed, those
// ranked as undated, below year-old previews that carried a date.
eq('"2 days ago"', normalizeHitDate('2 days ago', NOW), new Date(NOW - 2 * DAY).toISOString());
eq('"5 hours ago"', normalizeHitDate('5 hours ago', NOW), new Date(NOW - 5 * 3_600_000).toISOString());
eq('"1 week ago"', normalizeHitDate('1 week ago', NOW), new Date(NOW - 7 * DAY).toISOString());
eq('"an hour ago"', normalizeHitDate('an hour ago', NOW), new Date(NOW - 3_600_000).toISOString());
eq('"yesterday"', normalizeHitDate('yesterday', NOW), new Date(NOW - DAY).toISOString());
check('"Nov 19, 2026" parses', normalizeHitDate('Nov 19, 2026', NOW)?.startsWith('2026-11-19') === true);
check('ISO passes through', normalizeHitDate('2026-11-19T08:00:00Z', NOW) === '2026-11-19T08:00:00.000Z');
check('RFC 2822 parses', normalizeHitDate('Thu, 19 Nov 2026 08:00:00 GMT', NOW) === '2026-11-19T08:00:00.000Z');
eq('garbage is undefined', normalizeHitDate('sometime soon', NOW), undefined);
eq('non-string is undefined', normalizeHitDate(42 as unknown, NOW), undefined);
eq('age label: yesterday', ageLabel(new Date(NOW - 1.5 * DAY).toISOString(), NOW), 'yesterday');
eq('age label: 3d', ageLabel(new Date(NOW - 3 * DAY).toISOString(), NOW), '3d ago');
eq('age label: unknown', ageLabel(undefined, NOW), '');

// With the dates parsed, launch-day coverage must outrank the old preview.
{
  const ranked = rankBlocks([
    { source: 'web-search', text: 'GTA 6 is set to launch November 19, 2026', url: 'https://example.com/preview', publishedISO: normalizeHitDate('Mar 2, 2026', NOW), baseAuthority: 8 },
    { source: 'web-search', text: 'GTA 6 is out now', url: 'https://example.com/launch', publishedISO: normalizeHitDate('1 day ago', NOW), baseAuthority: 8 },
  ], NOW);
  check('launch-day article outranks the preview', ranked[0].url === 'https://example.com/launch');
}

// ── 2. "Is it out?" is a recency question ────────────────────────────────
for (const q of [
  'is gta 6 out',
  'is GTA 6 out yet?',
  'is gta 6 out on pc',
  'has gta 6 come out',
  'has silksong released',
  'did gta 6 release?',
  'is it available on ps5 yet',
  'can i play gta 6 yet',
  'when does gta 6 come out',
  "when's gta 6 releasing",
  'gta 6 release date',
  'was gta 6 delayed again',
  'is it out',
]) {
  check(`release-status: ${JSON.stringify(q)}`, isReleaseStatusQuestion(q));
  check(`temporal detector: ${JSON.stringify(q)}`, detectTemporal(q).isTemporal);
}
// Guide questions that only share a word must stay evergreen, or they lose
// the older guides that answer them.
for (const q of [
  'is there a way out of this room',
  'how do i get out of the sewers in elden ring',
  'how to reduce input delay',
  'when does the boss release its grab',
  'best build for a strength character',
]) check(`not release-status: ${JSON.stringify(q)}`, !isReleaseStatusQuestion(q));

// ── 3. Dates the sources still call "upcoming" ────────────────────────────
{
  const intel = [
    'Grand Theft Auto VI is Now Set to Launch November 19, 2026 - Rockstar Games newswire.',
    'The game is scheduled to release on 19 November 2026 for PS5 and Xbox Series X|S.',
    'GTA Online for GTA 6 is expected to arrive in 2027.',
    'Grand Theft Auto V released on 17 September 2013.',
    'The PC version is planned for March 2027.',
  ].join('\n');
  const found = findElapsedFutureDates(intel, TODAY);
  check('finds the passed launch date (MDY)', found.some(f => f.iso === '2026-11-19' && /set to launch/i.test(f.snippet)));
  check('finds the passed launch date (DMY)', found.some(f => f.iso === '2026-11-19' && /scheduled to release/i.test(f.snippet)));
  check('launch was 1 day ago', found.every(f => f.iso !== '2026-11-19' || f.daysAgo === 1));
  check('ignores a future date', !found.some(f => f.iso.startsWith('2027')));
  check('ignores a past-tense date', !found.some(f => f.iso === '2013-09-17'));

  const block = buildElapsedDatesBlock(intel, TODAY);
  check('block names the date', block.includes('November 19, 2026'));
  check('block says it happened', /OUT NOW/.test(block) && /YESTERDAY/.test(block));

  // Launch day itself.
  check('today counts as passed', findElapsedFutureDates('It is set to launch on 2026-11-20.', TODAY).some(f => f.daysAgo === 0));
  // A month that is over.
  check('a finished month counts', findElapsedFutureDates('The game was delayed to May 2026.', TODAY).some(f => f.iso === '2026-05-31'));
  // A month still running does not.
  eq('the current month does not count', findElapsedFutureDates('Coming in November 2026.', TODAY).length, 0);
  // "may" the verb is not a month.
  eq('"may 2026" lowercase is not a date', findElapsedFutureDates('it is expected that you may 2026', TODAY).length, 0);
  eq('nothing to flag, no block', buildElapsedDatesBlock('A great game released on 17 September 2013.', TODAY), '');
}

// ── 4. The date is always in the prompt ────────────────────────────────────
{
  const short = buildDateGrounding(TODAY, { full: false });
  const full = buildDateGrounding(TODAY, { full: true });
  check('short grounding has the date', short.includes(TODAY) && short.includes('20 November 2026'));
  check('short grounding says passed dates mean released', /release date has passed is OUT/.test(short));
  check('short grounding carries no live-data rules', !short.includes('RULES FOR CURRENT STATE'));
  check('full grounding has the date', full.includes(TODAY));
  check('full grounding prefers the newest source', /Prefer the NEWEST dated source/.test(full));
  eq('human date', humanDate(TODAY), 'Friday 20 November 2026');
}

// ── 5. Lookups use the full title ──────────────────────────────────────────
// "gta 6" title-cased to "Gta 6" missed the Wikipedia article, and the search
// fallback then returned "GTFO (video game)" as GTA 6's research.
eq('gta 6 → full title', canonicalTitle('gta 6'), 'Grand Theft Auto VI');
eq('gta vi → full title', canonicalTitle('GTA VI'), 'Grand Theft Auto VI');
eq('unknown titles pass through', canonicalTitle('007 first light'), '007 first light');
check('aliases include the other shorthand', titleAliases('gta 6').includes('gta vi'));
check('headline "Grand Theft Auto VI" matches gta 6', aliasRegex('gta 6').test('Grand Theft Auto VI review: a triumph'));
check('headline "GTA VI" matches gta 6', aliasRegex('gta 6').test('GTA VI sells 20 million on day one'));
check('"GTA V" headline does not match gta 6', !aliasRegex('gta 6').test('GTA V gets a new update'));
check('no bare-word alias false positives', !aliasRegex('rainbow six siege').test('Space Marine 2 siege mode'));

// ── 6. The classifier's year pattern ───────────────────────────────────────
// It read 20[3-9]d (a lost backslash): "2031" never counted as a recency word.
check('temporal hint: a 2030s year', TEMPORAL_HINT_RX.test('games coming in 2031'));
check('temporal hint: "out yet"', TEMPORAL_HINT_RX.test('is gta 6 out yet'));

console.log(`freshness: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
