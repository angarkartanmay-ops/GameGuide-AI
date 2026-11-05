// ═══════════════════════════════════════════════════════════════════════════
//  REASONING-TRACE STRIPPING
//  ───────────────────────────────────────────────────────────────────────
//  Reasoning models (Qwen3.x, DeepSeek-R1, Nemotron reasoning variants, and
//  a growing share of what the free tiers actually offer) emit their scratchpad
//  inline, wrapped in <think>…</think>, before the real answer.
//
//  Nothing downstream stripped it. Measured 2026-09-05: a single reply came
//  back 8,178 characters, of which the user-facing answer was ~430 — the rest
//  was the model narrating "Check Rules & Guidelines… User Correction
//  Handling…" straight to the player, exposing the system prompt's structure
//  along the way.
//
//  This is not optional polish: the model catalog is discovered at runtime, so
//  a reasoning model can enter the rotation at any time without a code change.
//  The stripping has to be unconditional and provider-agnostic.
// ═══════════════════════════════════════════════════════════════════════════

/** Tags used by the reasoning models seen across these providers. */
const OPEN_TAGS = ['<think>', '<thinking>', '<reasoning>', '<scratchpad>'];
const CLOSE_TAGS = ['</think>', '</thinking>', '</reasoning>', '</scratchpad>'];

const BLOCK_RX = /<(think|thinking|reasoning|scratchpad)>[\s\S]*?<\/\1>/gi;
/** An unclosed block — the model hit its token limit mid-thought. */
const DANGLING_OPEN_RX = /<(think|thinking|reasoning|scratchpad)>[\s\S]*$/i;
/** A stray close with no open, which happens when a stream is resumed. */
const ORPHAN_CLOSE_RX = /^[\s\S]*?<\/(think|thinking|reasoning|scratchpad)>/i;

/**
 * Remove reasoning traces from a complete response.
 *
 * Order matters: strip well-formed pairs first, then an orphaned close tag
 * (everything before it was thought), then a dangling open (everything after
 * it was thought and never finished).
 */
export function stripReasoning(text: string): string {
  if (!text) return text;
  let out = text;

  if (BLOCK_RX.test(out)) {
    BLOCK_RX.lastIndex = 0;
    out = out.replace(BLOCK_RX, '');
  }
  if (CLOSE_TAGS.some(t => out.toLowerCase().includes(t))) {
    out = out.replace(ORPHAN_CLOSE_RX, '');
  }
  if (OPEN_TAGS.some(t => out.toLowerCase().includes(t))) {
    out = out.replace(DANGLING_OPEN_RX, '');
  }

  out = out.trim();

  // If stripping consumed everything, the model produced only a scratchpad.
  // Returning "" would surface as an empty bubble, so signal failure instead
  // and let the mesh fall through to another model.
  return out;
}

/**
 * Planning text written as the answer, with no tags around it.
 *
 * Some models (Gemini flash-tier on a long system prompt is the one seen in
 * prod, 2026-11-05) skip the <think> wrapper and write their drafting plan
 * straight into the reply: "5. **Drafting final text:** …", "Follow-up
 * suggestions at the bottom (2-4 in user's voice)". No tag means nothing to
 * strip, so the whole reply is unusable and should go to the next model.
 *
 * The markers are deliberately narrow, the kind of phrasing a real answer
 * about a game never contains. A false positive costs one retry. A false
 * negative shows the player our prompt.
 */
const PLAN_LEAK_RX: RegExp[] = [
  /\bdrafting\s+(?:the\s+)?(?:final\s+)?(?:text|answer|response|reply|output)\s*\**\s*:/i,
  /\bconstraint\s+checklist\b/i,
  /\bmental\s+sandbox\b/i,
  /\bconfidence\s+score\s*:\s*\d/i,
  /\(\s*2\s*[-–]\s*4\s+in\s+(?:the\s+)?user'?s\s+voice\s*\)/i,
  /\bfollow[-\s]?up\s+suggestions\s+at\s+the\s+bottom\b/i,
];

export function looksLikeLeakedPlan(text: string): boolean {
  if (!text) return false;
  return PLAN_LEAK_RX.some(rx => rx.test(text));
}

/**
 * Streaming filter.
 *
 * A reasoning model streams its scratchpad token by token, so the user would
 * watch it type out its internal monologue in real time. This gates deltas:
 * nothing inside a reasoning block is forwarded, and a partial tag at a chunk
 * boundary is buffered rather than emitted (otherwise a delta ending in
 * "<thi" would leak the fragment).
 */
export function createReasoningFilter() {
  let inside = false;
  let pending = '';        // holds a possible partial tag across chunk boundaries
  let sawAny = false;

  const longestTag = Math.max(...[...OPEN_TAGS, ...CLOSE_TAGS].map(t => t.length));

  return {
    /** Feed a raw delta; returns the text that is safe to show (may be ''). */
    push(delta: string): string {
      pending += delta;
      let emit = '';

      // Consume the buffer whenever a complete tag is present.
      for (;;) {
        const hay = pending.toLowerCase();
        const tags = inside ? CLOSE_TAGS : OPEN_TAGS;
        let idx = -1, hit = '';
        for (const t of tags) {
          const i = hay.indexOf(t);
          if (i !== -1 && (idx === -1 || i < idx)) { idx = i; hit = t; }
        }
        if (idx === -1) break;

        if (!inside) emit += pending.slice(0, idx);   // text before <think>
        pending = pending.slice(idx + hit.length);
        inside = !inside;
        sawAny = true;
      }

      if (!inside) {
        // Hold back only enough to cover a tag split across chunks.
        const keep = Math.min(pending.length, longestTag - 1);
        const safeUpTo = pending.length - keep;
        if (safeUpTo > 0) {
          emit += pending.slice(0, safeUpTo);
          pending = pending.slice(safeUpTo);
        }
      } else if (pending.length > 8192) {
        // Inside a long scratchpad: drop it so the buffer can't grow unbounded,
        // but keep a tail in case a close tag straddles the boundary.
        pending = pending.slice(-longestTag);
      }

      return emit;
    },

    /** Flush whatever is safe at end of stream. */
    finish(): string {
      if (inside) { pending = ''; return ''; }   // never closed — it was all thought
      const rest = pending;
      pending = '';
      return rest;
    },

    get sawReasoning() { return sawAny; },
  };
}
