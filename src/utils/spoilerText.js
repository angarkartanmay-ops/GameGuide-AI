// ═══════════════════════════════════════════════════════════════════════════
//  Spoiler markup for the web client.
//
//  The server emits Discord's native spoiler syntax — ||hidden|| — so one
//  answer format serves both clients. Markdown has no spoiler syntax, so this
//  rewrites each span into a link to "#spoiler", which MessageBubble renders as
//  a click-to-reveal span. A link keeps any markdown inside the spoiler (bold,
//  italics, inline code) working, and needs no raw HTML.
//
//  Two leaks this must never allow:
//    * STREAMING. Tokens arrive one at a time, so "||The final boss is Ra" is
//      on screen before the closing "||" exists. An unclosed span therefore
//      hides everything after it until it closes.
//    * CODE AND TABLES. "||" inside code is literal, and GFM table rows use
//      "|" as a delimiter — an empty cell is "||". Neither is touched.
// ═══════════════════════════════════════════════════════════════════════════

export const SPOILER_HREF = '#spoiler';

const FENCE_RX = /^\s*(```|~~~)/;
const PIPE_LINE_RX = /^\s*\|/;
// A GFM table always has a delimiter row: | --- | :-: | ---: |
const TABLE_DELIM_RX = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * Indexes of lines that belong to a real GFM table. A line starting with "|"
 * is not enough — "||Radagon|| is the final boss" starts with a pipe too, and
 * treating it as a table row would render the spoiler in plain sight. Only a
 * run of pipe lines that contains a delimiter row is a table.
 */
function tableLines(lines) {
  const protectedIdx = new Set();
  let i = 0;
  while (i < lines.length) {
    if (!PIPE_LINE_RX.test(lines[i])) { i++; continue; }
    let j = i;
    while (j < lines.length && PIPE_LINE_RX.test(lines[j])) j++;
    const run = lines.slice(i, j);
    if (run.some(l => TABLE_DELIM_RX.test(l))) for (let k = i; k < j; k++) protectedIdx.add(k);
    i = j;
  }
  return protectedIdx;
}

// Link text may not contain unescaped brackets.
function escapeLinkText(s) {
  return s.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

// One spoiler per paragraph: link text cannot span a blank line.
function wrap(content) {
  return content
    .split(/\n[ \t]*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    // A spoiler is itself a link, and markdown links cannot nest: an inner
    // [text](url) rendered as raw brackets once revealed. Keep it readable.
    .map(p => p.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, '$1 ($2)'))
    .map(p => `[${escapeLinkText(p)}](${SPOILER_HREF})`)
    .join('\n\n');
}

/** Rewrite one run of ordinary markdown lines, respecting inline code. */
function transformSegment(seg) {
  let out = '';
  let buf = '';        // text since the last opening "||"
  let open = false;
  let i = 0;
  while (i < seg.length) {
    // Inline code: copy the whole span verbatim.
    if (seg[i] === '`') {
      let run = 0;
      while (seg[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      const end = seg.indexOf(fence, i + run);
      const piece = end === -1 ? seg.slice(i) : seg.slice(i, end + run);
      if (open) buf += piece; else out += piece;
      i += piece.length;
      continue;
    }
    if (seg[i] === '|' && seg[i + 1] === '|' && seg[i - 1] !== '\\') {
      if (!open) {
        open = true;
        buf = '';
      } else {
        open = false;
        out += buf.trim() ? wrap(buf) : '';
      }
      i += 2;
      continue;
    }
    if (open) buf += seg[i]; else out += seg[i];
    i++;
  }
  // Unclosed: keep it hidden. During streaming the close is simply still on
  // its way; in a malformed reply, hiding is the safe failure.
  if (open && buf.trim()) out += wrap(buf);
  return out;
}

/**
 * @param {string} text  Markdown that may contain ||spoiler|| spans.
 * @returns {string}     Markdown with each span as [text](#spoiler).
 */
export function toSpoilerMarkdown(text) {
  if (!text || !text.includes('||')) return text || '';
  const lines = text.split('\n');
  const tables = tableLines(lines);
  const out = [];
  let seg = [];
  let inFence = false;

  const flush = () => {
    if (seg.length) { out.push(transformSegment(seg.join('\n'))); seg = []; }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (FENCE_RX.test(line)) {
      flush();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence || tables.has(idx)) {
      flush();
      out.push(line);
      continue;
    }
    seg.push(line);
  }
  flush();
  return out.join('\n');
}
