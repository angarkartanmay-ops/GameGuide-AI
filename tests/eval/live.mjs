// Live answer-quality eval — run AFTER deploying.
//
// The offline eval (pipeline.test.mjs) covers retrieval and routing, which is
// deterministic. This one grades actual answers, which needs a real endpoint
// and real API keys. It cannot run in CI without them, so it is a manual
// gate rather than part of `npm test`.
//
//   node tests/eval/live.mjs https://<project>.supabase.co/functions/v1/chat-proxy <ANON_KEY>
//
// It does NOT grade prose. It asserts the failure modes that actually bit us:
// claiming a real game doesn't exist, leaking the old canned refusal, and
// answering a live question with no sources attached.

const [, , ENDPOINT, ANON_KEY] = process.argv;
if (!ENDPOINT || !ANON_KEY) {
  console.error('usage: node tests/eval/live.mjs <chat-proxy-url> <anon-key>');
  process.exit(2);
}

// Phrases that mean the model denied a real game's existence, or fell back to
// the templated refusal that this rewrite removed.
const HALLUCINATION_MARKERS = [
  /unable to find any information about a game/i,
  /no direct match for/i,
  /isn'?t a known title/i,
  /could be a fan-?made concept/i,
  /show no official .* titled/i,
  /that'?s outside my arena/i,
  /GameGuide-AI is laser-focused/i,
];

const CASES = [
  {
    id: 'recent-release',
    prompt: 'What are the recent reviews about 007 First Light? How long ago did it release?',
    // Released 2026-05-27 by IO Interactive. The bot previously said it did not exist.
    mustMention: [/io interactive|first light/i],
    mustHaveSources: true,
  },
  { id: 'followup', prompt: "Yeah I meant James Bond's game, First Light", mustHaveSources: true },
  { id: 'evergreen-lore', prompt: 'What is the lore behind the Erdtree in Elden Ring?', mustMention: [/erdtree/i] },
  { id: 'current-meta', prompt: 'What is the current Valorant meta this patch?', mustHaveSources: true },
  { id: 'troubleshoot', prompt: 'Cyberpunk 2077 crashes on launch after a driver update', mustMention: [/driver|verif|reinstall|rollback/i] },
  { id: 'emotional', prompt: "I'm completely burnt out on ranked and I don't enjoy playing anymore", mustNotMatch: [/\[\?\]/] },
  { id: 'unknown-niche', prompt: 'How do I beat the second boss in Nine Sols?' },
];

let pass = 0;
const failures = [];

for (const c of CASES) {
  const started = Date.now();
  let body;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({ prompt: c.prompt, chatHistory: [] }),
    });
    body = await res.json();
  } catch (err) {
    failures.push(`[${c.id}] request failed: ${err.message}`);
    continue;
  }

  const text = body?.text || '';
  const sources = body?._meta?.sources || [];
  const ms = Date.now() - started;

  for (const rx of HALLUCINATION_MARKERS) {
    if (rx.test(text)) failures.push(`[${c.id}] HALLUCINATION/REFUSAL: matched ${rx}`);
  }
  for (const rx of c.mustMention || []) {
    if (rx.test(text)) pass++;
    else failures.push(`[${c.id}] expected answer to mention ${rx}`);
  }
  for (const rx of c.mustNotMatch || []) {
    if (!rx.test(text)) pass++;
    else failures.push(`[${c.id}] answer should NOT contain ${rx}`);
  }
  if (c.mustHaveSources) {
    if (sources.length > 0) pass++;
    else failures.push(`[${c.id}] no live sources attached — retrieval did not fire`);
  }

  console.log(`${(ms / 1000).toFixed(1)}s  ${String(sources.length).padStart(2)} src  [${c.id}] ${text.slice(0, 90).replace(/\s+/g, ' ')}…`);
}

console.log(failures.length ? `\nFAILURES:\n  ${failures.join('\n  ')}` : '\nNo failures.');
console.log(`live eval: ${pass} checks passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
