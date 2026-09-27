// The games the site shows off, and the scripted demos built around them.
// Pure data plus two tiny helpers, so the tests can check every accent and
// every URL without a browser.

const CDN = 'https://cdn.akamai.steamstatic.com/steam/apps';

export const heroArt = (appid) => `${CDN}/${appid}/library_hero.jpg`;
export const coverArt = (appid) => `${CDN}/${appid}/library_600x900.jpg`;

// Accents were sampled from each game's Steam art with the chat's own
// sampleAccent (so the landing and the chat agree on a game's colour) and are
// already lifted to 4.5:1 on the site background (#07090d).
export const HERO_GAMES = [
  { appid: 1245620, name: 'Elden Ring', accent: '#c0985b' },
  { appid: 1086940, name: "Baldur's Gate 3", accent: '#398fc6' },
  { appid: 1091500, name: 'Cyberpunk 2077', accent: '#e3dd1c' },
  { appid: 1145350, name: 'Hades II', accent: '#e5302e' },
  { appid: 553850, name: 'Helldivers 2', accent: '#5579b4' },
  { appid: 367520, name: 'Hollow Knight', accent: '#579fa8' },
];

export const SITE_BG = '#07090d';

// The library wall. Appids come from the verified table in api/_steamArt.js;
// every cover was checked to exist on the CDN.
export const LIBRARY = [
  [1245620, 'Elden Ring'], [1086940, "Baldur's Gate 3"], [1091500, 'Cyberpunk 2077'],
  [1145350, 'Hades II'], [553850, 'Helldivers 2'], [367520, 'Hollow Knight'],
  [1030300, 'Hollow Knight: Silksong'], [413150, 'Stardew Valley'], [292030, 'The Witcher 3'],
  [1174180, 'Red Dead Redemption 2'], [814380, 'Sekiro'], [2246340, 'Monster Hunter Wilds'],
  [2358720, 'Black Myth: Wukong'], [1903340, 'Clair Obscur: Expedition 33'], [1627720, 'Lies of P'],
  [1888160, 'Armored Core VI'], [1172620, 'Sea of Thieves'], [548430, 'Deep Rock Galactic'],
  [1966720, 'Lethal Company'], [892970, 'Valheim'], [105600, 'Terraria'],
  [275850, "No Man's Sky"], [264710, 'Subnautica'], [2694490, 'Path of Exile 2'],
].map(([appid, name]) => ({ appid, name }));

// ─── Spoiler Shield demo ────────────────────────────────────────────────────
// Where the player can say they are, and a lore page whose lines unlock as
// they move forward. Line `stage` = the first milestone that may see it.

export const SHIELD_MILESTONES = [
  { label: 'Limgrave', progress: 'just started' },
  { label: 'Stormveil', progress: 'beat Margit' },
  { label: 'Liurnia', progress: 'reached Raya Lucaria' },
  { label: 'Leyndell', progress: 'reached the capital' },
  { label: 'The end', progress: 'finished the game' },
];

export const SHIELD_LINES = [
  { stage: 0, text: 'You arrive in Limgrave as one of the Tarnished, called back to the Lands Between to seek the shattered Elden Ring.' },
  { stage: 1, text: 'Past Margit, the Fell Omen, Godrick the Grafted holds Stormveil Castle and the first Great Rune you can claim.' },
  { stage: 2, text: 'In Liurnia, Rennala, Queen of the Full Moon, still waits in the Academy of Raya Lucaria, cradling an amber egg.' },
  { stage: 3, text: "At Leyndell you learn Margit was a guise all along: he is Morgott, the Omen King, who guards the capital." },
  { stage: 4, text: 'Several endings wait, and the one you reach depends on quests you may already have walked past.' },
];

/** Is this line safe to show a player who is at `milestone`? */
export const isVisibleAt = (line, milestone) => line.stage <= milestone;

/** How many lines a player at `milestone` can read. */
export function visibleCount(lines, milestone) {
  return lines.filter(l => isVisibleAt(l, milestone)).length;
}

// ─── Anatomy of an answer ──────────────────────────────────────────────────

export const ANATOMY = {
  question: 'How do I beat Margit?',
  game: HERO_GAMES[0],
  progress: 'Stormveil',
  title: 'Beating Margit, the Fell Omen',
  points: [
    ['Bring help.', 'The Spirit Jellyfish ashes, from Roderika at Stormhill Shack, pull his attention and stack poison.'],
    ["Use Margit's Shackle.", 'Patches sells it in Murkwater Cave. It pins him to the ground for a few free hits.'],
    ['Wait out the delays.', 'His cane strings are timed to catch early rolls. Dodge late, hit once, back off.'],
    ['Arrive ready.', 'Around level 25–30 with a +3 weapon makes the fight far more forgiving.'],
  ],
  spoiler: 'Margit is Morgott in disguise, and you will face him again in Leyndell.',
  steps: [
    { title: 'Ask', text: 'Type the way you would ask a friend. Screenshots work too.' },
    { title: 'Research', text: 'It reads wikis, official patch notes and the web while you wait, and shows you where it is.' },
    { title: 'Recognise', text: 'It works out which game you mean, and the page takes on that game’s art and colour.' },
    { title: 'Answer', text: 'The answer is set like a strategy-guide page, with the sources it used.' },
    { title: 'Shield', text: 'Anything past where you are in the story waits under a bar until you choose to look.' },
  ],
};
