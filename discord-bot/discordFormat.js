// ═══════════════════════════════════════════════════════════════════════════
//  Making an answer readable in Discord — especially on a phone.
//
//  The model is told to compare things in a table, and on the website that's
//  right. Discord has no tables at all: it prints the pipes, so a six-column
//  comparison arrives as a wall of "| D/D | 6.5 | 11 STR |" that wraps three
//  times on a phone screen and reads like a corrupted file.
//
//  So tables are rewritten here, into the same shape the website falls back
//  to on a narrow screen: one short block per row, every value wearing its
//  column's name. Two-column tables (the most common — thing and effect)
//  collapse to a single line each, which is what they always wanted to be.
//
//  Cell text is moved verbatim, never rewritten, so ||spoiler|| bars stay
//  balanced and in the same order for splitForDiscord to rebalance.
//
//  Kept free of discord.js so it can be unit tested directly.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

/**
 * A row of cells from one "| a | b |" line. Outer pipes are optional in GFM.
 *
 * "||" is read as a spoiler bar, never as two cell borders. Strict GFM says
 * a literal pipe must be escaped, but the model writes ||hidden|| inside a
 * cell anyway — and splitting there would tear the bars apart and print the
 * secret in the open. An ambiguous "| a || b |" therefore loses an empty
 * cell rather than risking a spoiler: worst case here is a merged column,
 * worst case there is the twist.
 */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|') && s[1] !== '|') s = s.slice(1);
  if (/[^\\|]\|$/.test(s)) s = s.replace(/\|$/, '');
  const cells = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { buf += '|'; i++; continue; }
    if (c === '|' && s[i + 1] === '|') { buf += '||'; i++; continue; }
    if (c === '|') { cells.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  cells.push(buf.trim());
  return cells;
}

/** The "| --- | :--: |" line directly under a table's header. */
function isDelimiter(line) {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

const looksLikeRow = (line) => line.includes('|') && line.trim() !== '';

/**
 * One parsed table → Discord-friendly lines.
 * Empty cells are dropped rather than printed as "Weight: —": on a phone,
 * blank labels are pure noise.
 */
function renderTable(headers, rows) {
  const out = [];
  const twoCol = headers.length === 2;

  for (const cells of rows) {
    const title = (cells[0] || '').trim();
    const rest = [];
    for (let i = 1; i < headers.length; i++) {
      const value = (cells[i] || '').trim();
      if (!value) continue;
      const label = (headers[i] || '').trim();
      rest.push(label ? `${label}: ${value}` : value);
    }

    if (!title && rest.length === 0) continue;
    const head = title ? `**${title}**` : '';

    if (twoCol) {
      // "**Rivers of Blood** — Corpse Piler, 20 arcane" reads in one glance.
      out.push(head && rest.length ? `${head} — ${rest[0]}` : head || rest[0]);
      continue;
    }
    if (head) out.push(head);
    for (const line of rest) out.push(line);
    out.push('');   // one blank line between rows, so they read as blocks
  }

  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/** A line Discord would print as literal dashes or stars: it has no rules. */
const isRule = (line) => /^[ \t]*(?:-{3,}|_{3,}|(?:\*[ \t]*){3,})[ \t]*$/.test(line);

/**
 * One fence-aware pass over the text. Fenced code is passed through
 * untouched — a table drawn inside ``` is deliberate ASCII art, and Discord
 * renders it fine in a monospace block.
 *
 * @param {string} text
 * @param {{dropRules?: boolean}} [opts]
 * @returns {string}
 */
function rewrite(text, { dropRules = false } = {}) {
  if (typeof text !== 'string') return text;

  const lines = text.split('\n');
  const out = [];
  let fenced = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; out.push(line); continue; }
    if (fenced) { out.push(line); continue; }
    if (dropRules && isRule(line)) continue;

    const next = lines[i + 1];
    if (!looksLikeRow(line) || next === undefined || !isDelimiter(next)) {
      out.push(line);
      continue;
    }

    const headers = splitRow(line);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      if (!looksLikeRow(lines[j]) || isDelimiter(lines[j])) break;
      rows.push(splitRow(lines[j]));
    }

    // A header with no body is not worth a heading of its own; drop it.
    if (rows.length) out.push(...renderTable(headers, rows));
    i = j - 1;
  }

  return out.join('\n');
}

/** Tables only — kept separate so it can be tested on its own. */
const tablesToLines = (text) => rewrite(text);

/**
 * Everything Discord needs before a chat answer is sent, phone first.
 *  - tables become blocks (above)
 *  - "---" rules print literally in Discord, so they go
 *  - runs of blank lines collapse: on a phone every one is a wasted line
 */
function forDiscord(text) {
  if (typeof text !== 'string') return text;
  return rewrite(text, { dropRules: true }).replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { forDiscord, tablesToLines, _internals: { splitRow, isDelimiter, renderTable, isRule } };
