// ═══════════════════════════════════════════════════════════════════════════
//  Discord message splitting — spoiler-safe.
//
//  Discord caps a message at 2000 characters, so long answers go out in
//  pieces. Spoiler Shield answers carry ||hidden|| spans, and a split landing
//  inside one would leave "||The final boss is" in one message and the rest —
//  unhidden — at the top of the next. Every chunk is therefore rebalanced: a
//  span still open at the end of a chunk is closed there and reopened at the
//  start of the next, so both halves stay behind bars.
//
//  Kept free of discord.js so it can be unit tested directly.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

/** Line-aware split into chunks of at most `max` characters. */
function splitRaw(text, max) {
  const chunks = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if ((buf + line + '\n').length > max) {
      if (buf) chunks.push(buf.trimEnd());
      if (line.length > max) {
        for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
        buf = '';
      } else {
        buf = line + '\n';
      }
    } else {
      buf += line + '\n';
    }
  }
  if (buf.trim()) chunks.push(buf.trimEnd());
  return chunks;
}

/**
 * Spoiler bars that Discord will actually honour: code (inline or fenced)
 * shows "||" literally, so bars inside it don't count.
 */
function countBars(text, opener) {
  let n = 0;
  let fence = opener;   // the ``` line that opened the current code block, or null
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { fence = fence ? null : line.trim(); continue; }
    if (fence) continue;
    const outsideCode = line.replace(/`+[^`]*`+/g, '');
    const m = outsideCode.match(/\|\|/g);
    if (m) n += m.length;
  }
  return { n, fence };
}

/**
 * @param {string} text
 * @param {number} [max=1900]  leaves room under Discord's 2000 for the bars
 *                             and fences added here and for a footer line.
 * @returns {string[]}
 */
function splitForDiscord(text, max = 1900) {
  if (!text) return [];
  const raw = splitRaw(text, max);
  let open = false;
  let fence = null;
  return raw.map((chunk) => {
    // A code block cut in two is closed at the end of one message and reopened
    // (same language tag) at the start of the next — otherwise the second half
    // arrived as loose text and every later "*" and "_" became formatting.
    const startFence = fence;
    const counted = countBars(chunk, fence);
    fence = counted.fence;
    const wasOpen = open;
    if (counted.n % 2 === 1) open = !open;
    return (wasOpen ? '||' : '') + (startFence ? `${startFence}\n` : '') + chunk
      + (fence ? '\n```' : '') + (open ? '||' : '');
  });
}

module.exports = { splitForDiscord };
