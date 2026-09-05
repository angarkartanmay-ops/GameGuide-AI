// Reasoning-trace stripping.
//
// Caught in the 2026-09-05 audit: qwen3.6-27b entered the rotation and streamed
// its <think> scratchpad straight to the user — an 8,178-character reply whose
// user-facing answer was ~430 characters, with the rest narrating the system
// prompt's own rule names back at the player.
//
// This matters structurally, not just cosmetically: the model catalog is
// discovered at RUNTIME, so a reasoning model can join the rotation any day
// without a code change. Stripping has to hold for models nobody has seen yet.

import { stripReasoning, createReasoningFilter } from '../supabase/functions/chat-proxy/reasoning.ts';

let pass = 0;
const failures: string[] = [];
const check = (label: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else failures.push(`  ${label}\n    expected ${JSON.stringify(want)}\n    got      ${JSON.stringify(got)}`);
};

// ── Whole-response stripping ───────────────────────────────────────────────
check('removes a well-formed think block',
  stripReasoning('<think>internal monologue</think>The real answer.'), 'The real answer.');

check('removes a block with newlines and markup inside',
  stripReasoning('<think>\n1. Check rules\n2. **Decide**\n</think>\n\nBG3 released in 2023.'),
  'BG3 released in 2023.');

check('handles the alternate tag spellings',
  stripReasoning('<thinking>x</thinking>A'), 'A');
check('handles <reasoning>', stripReasoning('<reasoning>x</reasoning>B'), 'B');
check('handles <scratchpad>', stripReasoning('<scratchpad>x</scratchpad>C'), 'C');

check('removes multiple blocks',
  stripReasoning('<think>a</think>One.<think>b</think>Two.'), 'One.Two.');

// Truncated output: the model hit its token cap mid-thought. Everything after
// the open tag is scratchpad and must go.
check('drops a dangling unclosed block',
  stripReasoning('Answer first.<think>then it rambles forever'), 'Answer first.');

// A resumed stream can produce a close with no matching open.
check('drops everything before an orphaned close tag',
  stripReasoning('leftover thinking</think>The answer.'), 'The answer.');

check('leaves ordinary text untouched',
  stripReasoning('Just a normal answer about Elden Ring.'), 'Just a normal answer about Elden Ring.');

check('scratchpad-only response collapses to empty (signals a failed generation)',
  stripReasoning('<think>only thinking, no answer</think>'), '');

check('is case-insensitive', stripReasoning('<THINK>x</THINK>D'), 'D');
check('tolerates empty input', stripReasoning(''), '');

// Must NOT eat legitimate content that merely mentions the word.
check('does not touch prose containing the word think',
  stripReasoning('I think Silksong is harder.'), 'I think Silksong is harder.');

// ── Streaming filter ───────────────────────────────────────────────────────
const streamThrough = (chunks: string[]) => {
  const f = createReasoningFilter();
  let out = '';
  for (const c of chunks) out += f.push(c);
  out += f.finish();
  return out;
};

check('stream: suppresses a think block delivered in one chunk',
  streamThrough(['<think>secret</think>Hello']), 'Hello');

check('stream: suppresses across chunk boundaries',
  streamThrough(['<thi', 'nk>sec', 'ret</thi', 'nk>Hel', 'lo']), 'Hello');

// The dangerous case: a delta ending mid-tag must not leak the fragment.
check('stream: never leaks a partial opening tag',
  streamThrough(['Answer <thi', 'nk>hidden</think>!']), 'Answer !');

check('stream: passes plain text straight through',
  streamThrough(['Elden ', 'Ring ', 'is good']), 'Elden Ring is good');

check('stream: text before and after a block both survive',
  streamThrough(['Before.', '<think>x</think>', 'After.']), 'Before.After.');

check('stream: an unclosed block yields nothing after it',
  streamThrough(['Visible.', '<think>never closes...']), 'Visible.');

check('stream: reports whether reasoning was seen',
  (() => { const f = createReasoningFilter(); f.push('<think>a</think>b'); return f.sawReasoning; })(), true);

check('stream: reports false when no reasoning present',
  (() => { const f = createReasoningFilter(); f.push('plain'); f.finish(); return f.sawReasoning; })(), false);

// A long scratchpad must not be buffered unboundedly, and must still resolve.
check('stream: survives a very long scratchpad and still emits the answer',
  streamThrough(['<think>' + 'x'.repeat(20000), 'more'.repeat(500), '</think>Done']), 'Done');

if (failures.length) console.log(`\nREASONING FAILURES:\n${failures.join('\n')}`);
console.log(`reasoning: ${pass} passed, ${failures.length} failed`);
process.exitCode = failures.length ? 1 : 0;
