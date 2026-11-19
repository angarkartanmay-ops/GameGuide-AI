import { detectGame, detectGames, gamesFromHistory, looksLikeGameTitle, isSmallTalk, KNOWN_GAMES } from './.generated/detection.ts';

const cases: Array<[string, string | null]> = [
  // The actual reported bug: installment number must survive.
  ['But This is from forza horizon 6.', 'forza horizon 6'],
  ['forza horizon 5 best cars', 'forza horizon 5'],
  ['is forza horizon good', 'forza horizon'],

  // Plain allowlist hits stay intact.
  ["what's the best build in elden ring", 'elden ring'],
  ['minecraft bedrock vs java', 'minecraft bedrock'],

  // Prose after a title must NOT be glued on as a roman numeral.
  ['minecraft i love it so much', 'minecraft'],
  ['elden ring is very hard', 'elden ring'],

  // Version strings must not be truncated into an installment.
  ['minecraft 1.20 update', 'minecraft'],

  // Roman numerals that ARE installments.
  ['gta v heists', 'gta v'],

  // Unknown / brand-new titles recovered by the frame heuristic.
  ['how do I beat the second boss in Nine Sols', 'nine sols'],
  ['any tips for playing Blue Prince', 'blue prince'],

  // Must not fire on platform / vendor nouns.
  ["I'm playing on PC", null],
  ['this crashes for me', null],

  // A sentence-initial preposition is not part of the title: "In Hollow
  // Knight" was researched as the game "in hollow knight".
  ['In Hollow Knight, which charm makes you heal faster?', 'hollow knight'],
  // Nor is a possessive.
  ["What changed in Valorant's latest patch?", 'valorant'],

  // Digits have no case, so in a lowercase prompt the Title-Case guess was
  // just "007", and the Bond franchise was researched instead of the game.
  ['is 007 first light worth it', '007 first light'],
  ['Is 007 first light worth it?', '007 first light'],
  ['reviews of 007 first light', '007 first light'],
  ["what's the best weapon in 007 first light?", '007 first light'],
  ['007 first light walkthrough', '007 first light'],
  // ...but a bare "007" is not stretched into the words around it.
  ['tips for 007', '007'],
];

let pass = 0, fail = 0;
for (const [input, expected] of cases) {
  const got = detectGame(input);
  const ok = got === expected;
  if (ok) { pass++; }
  else { fail++; console.log(`FAIL  ${JSON.stringify(input)}\n      expected=${JSON.stringify(expected)}  got=${JSON.stringify(got)}`); }
}
// ── Sentence fragments are never a game ────────────────────────────────────
// "Have Drs Option Still" reached the recent-games shelf: a follow-up was split
// on "and" as if it were a comparison, stopword-stripped to "have drs option
// still", and sent back as meta.game. Whatever the phrasing or casing, an F1
// question yields the allowlist hit "f1" or nothing, and never a clause.
const OK_F1 = new Set(['f1', null]);
const fragments: string[] = [
  'do f1 cars still have the drs option',
  'do f1 cars still have the drs option?',
  'Do F1 cars still have the DRS option?',
  'Do F1 Cars Still Have DRS Option?',
  'ok and do they have the drs option still?',
  'thanks! and do they have the drs option still?',
  'do they Have DRS Option Still?',
  'Have DRS option still?',
  'does it still have drs or not',
  'Do F1 cars still have DRS option or is it removed?',
  'what changed in 2026',
];
for (const input of fragments) {
  const one = detectGame(input);
  if (OK_F1.has(one)) pass++;
  else { fail++; console.log(`FAIL  detectGame(${JSON.stringify(input)}) expected "f1" or null, got ${JSON.stringify(one)}`); }
  // detectGames feeds the scrape subjects, and its first entry becomes
  // profile.game when detectGame found nothing.
  const all = detectGames(input, 3);
  if (all.every(g => g === 'f1')) pass++;
  else { fail++; console.log(`FAIL  detectGames(${JSON.stringify(input)}) expected no fragment, got ${JSON.stringify(all)}`); }
}

// Nor can a fragment be carried into the next turn, from the player's words or
// from the bold lead of our own reply ("**No — DRS is gone in 2026.**").
{
  const carried = gamesFromHistory([
    { sender: 'user', text: 'ok and do they have the drs option still?' },
    { sender: 'ai', text: '**No — DRS is gone in 2026.** It was replaced by an overtake mode.' },
  ], 3);
  if (carried.length === 0) pass++;
  else { fail++; console.log(`FAIL  gamesFromHistory carried a fragment: ${JSON.stringify(carried)}`); }
}

// The guard is lexical, not a lookup: real titles whose words overlap with
// question words, and titles with no Steam art, are untouched.
const keepers: Array<[string, string]> = [
  ['any tips for Still Wakes the Deep', 'still wakes the deep'],
  ['Is Life Is Strange worth it', 'life is strange'],
  ['is grand theft auto vi out yet', 'grand theft auto vi'],
  ['best tanks in war thunder', 'war thunder'],
  ['reviews about 007 First Light', '007 first light'],
  ['Is Hollow Knight Silksong hard', 'hollow knight silksong'],
];
for (const [input, expected] of keepers) {
  const got = detectGame(input);
  if (got === expected) pass++;
  else { fail++; console.log(`FAIL  ${JSON.stringify(input)}\n      expected=${JSON.stringify(expected)}  got=${JSON.stringify(got)}`); }
}
// A comparison's stripped-down sides still count, even from a question-shaped
// side: it is how a lowercase title absent from the allowlist gets researched.
// Only a lone leftover word from a question ("…or is it removed?") is dropped.
for (const [input, title] of [
  ['is blue prince worth it or should i get hades', 'blue prince'],
  ['compare balatro and hades', 'balatro'],
] as const) {
  const g = detectGames(input, 3);
  if (g.includes(title)) pass++;
  else { fail++; console.log(`FAIL  detectGames(${JSON.stringify(input)}) lost ${JSON.stringify(title)}: ${JSON.stringify(g)}`); }
}

const rejectedAllowlist = KNOWN_GAMES.filter((g: string) => !looksLikeGameTitle(g));
if (rejectedAllowlist.length === 0) pass++;
else { fail++; console.log(`FAIL  looksLikeGameTitle rejects allowlist entries: ${JSON.stringify(rejectedAllowlist)}`); }
for (const t of ['have drs option still', 'still have drs', 'f1 cars still have drs option', 'Have Drs Option Still', '2026']) {
  if (!looksLikeGameTitle(t)) pass++;
  else { fail++; console.log(`FAIL  looksLikeGameTitle(${JSON.stringify(t)}) should be false`); }
}

// ── Small talk skips live retrieval ────────────────────────────────────────
// "what can you do" used to run a web search for "what can you do 2026",
// inherit GTA VI from history, and sit under "Thinking in depth".
const smallTalk: Array<[string, boolean]> = [
  ['what can you do', true],
  ['What can you do?', true],
  ['hi', true],
  ['heyyy', true],
  ['thanks bro', true],
  ['thank you so much!', true],
  ['who are you?', true],
  ['how can you help me', true],
  ['what is gameguide ai', true],
  // Real questions, even short ones, still get retrieval.
  ['what can you do in elden ring', false],
  ['when is it coming out?', false],
  ['help me beat malenia', false],
  ['hi, best build for elden ring?', false],
  ['thanks, and what about the dlc?', false],
  ['minecraft', false],
];
for (const [input, expected] of smallTalk) {
  const got = isSmallTalk(input);
  if (got === expected) pass++;
  else { fail++; console.log(`FAIL  isSmallTalk(${JSON.stringify(input)}) expected=${expected} got=${got}`); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
