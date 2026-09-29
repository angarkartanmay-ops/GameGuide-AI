import React, { createContext, memo, useContext, useId, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, ChevronDown, Copy, Share2, Shield } from 'lucide-react';
import FollowUpChips, { parseFollowUps } from './FollowUpChips';
import { toSpoilerMarkdown, SPOILER_HREF } from '../utils/spoilerText';
import { track } from '../utils/analytics';
// Shared with the edge function so both apply exactly the same rule.
import { guardStreaming } from '../../supabase/functions/chat-proxy/spoilerGuard.ts';

// The plain text inside a spoiler's rendered children (strings, or inline
// markdown like **bold**), for sizing its stand-in.
function plainText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(plainText).join('');
  return node?.props?.children != null ? plainText(node.props.children) : '';
}

/**
 * A hidden span the reader reveals on purpose (click, Enter or Space).
 * Rendered from [text](#spoiler), which toSpoilerMarkdown produces from the
 * server's Discord-style ||spoiler|| syntax.
 *
 * While hidden, the real words aren't in the page at all — a blank stand-in
 * of the same shape holds the bar's size. Transparent text still turned up in
 * find-in-page, in a text selection, and to anything reading the page.
 */
function Spoiler({ children }) {
  const [shown, setShown] = useState(false);
  const toggle = () => setShown(s => !s);
  return (
    <span
      className={`spoiler${shown ? ' is-revealed' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={shown}
      aria-label={shown ? undefined : 'Hidden spoiler — activate to reveal'}
      title={shown ? 'Click to hide' : 'Spoiler — click to reveal'}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      }}
    >
      {shown
        ? <span className="spoiler__text">{children}</span>
        // Two no-break spaces come to about one letter's width and never
        // break; the real spaces between words do, so the bar wraps like the
        // sentence would and doesn't jump when it's revealed.
        : <span className="spoiler__text" aria-hidden="true">{plainText(children).replace(/\S/g, '  ')}</span>}
    </span>
  );
}

// ── Tables that survive a phone ──────────────────────────────────────────
// A six-column comparison squeezed into 390px turns every heading into
// "SCA / LIN / G". Below 640px the CSS stacks each row into a small card,
// which only reads if every cell carries its column's name — so the header
// row is passed down and each cell labels itself.
const TableHeaders = createContext([]);

function hastText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value || '';
  return (node.children || []).map(hastText).join('');
}

// Both layouts need `display` off `table` — block for the horizontal scroll
// on a desktop, stacked rows on a phone — and that quietly strips the
// browser's own table semantics, leaving a screen reader a run of loose text.
// The roles below put the structure back by hand.
function MarkdownTable({ node, children, ...rest }) {
  const headers = useMemo(() => {
    const out = [];
    const walk = (n) => {
      if (!n) return;
      if (n.tagName === 'th') { out.push(hastText(n).trim()); return; }
      (n.children || []).forEach(walk);
    };
    walk(node);
    return out;
  }, [node]);
  return (
    <TableHeaders.Provider value={headers}>
      <table role="table" {...rest}>{children}</table>
    </TableHeaders.Provider>
  );
}

/** react-markdown hands every renderer its AST node; it must not reach the DOM. */
const domProps = (props) => {
  const rest = { ...props };
  delete rest.node;
  delete rest.children;
  return rest;
};

function MarkdownCell(props) {
  return <td role="cell" {...domProps(props)}>{props.children}</td>;
}

function MarkdownRow({ children, ...rest }) {
  const headers = useContext(TableHeaders);
  delete rest.node;   // react-markdown's AST node must not reach the DOM
  let col = 0;
  const labelled = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;   // stray whitespace nodes
    const label = headers[col++];
    if (child.type !== MarkdownCell || !label) return child;
    return React.cloneElement(child, { 'data-label': label });
  });
  return <tr role="row" {...rest}>{labelled}</tr>;
}

const MARKDOWN_COMPONENTS = {
  table: MarkdownTable,
  tr: MarkdownRow,
  td: MarkdownCell,
  thead: (p) => <thead role="rowgroup" {...domProps(p)}>{p.children}</thead>,
  tbody: (p) => <tbody role="rowgroup" {...domProps(p)}>{p.children}</tbody>,
  th: (p) => <th role="columnheader" {...domProps(p)}>{p.children}</th>,
  a(props) {
    if (props.href === SPOILER_HREF) return <Spoiler>{props.children}</Spoiler>;
    // react-markdown passes its AST `node`; it must not reach the DOM.
    const rest = { ...props };
    delete rest.node;
    // nofollow/ugc: answers (and especially shared ones) aren't our editorial links.
    return <a {...rest} target="_blank" rel="noopener noreferrer nofollow ugc" />;
  },
};

const SOURCE_LABELS = {
  'supercell-api': 'Official Supercell API',
  'wikipedia': 'Wikipedia (live revision)',
  'steam-news': 'Steam official news',
  'youtube': 'YouTube (recent uploads)',
  'rss': 'Gaming news (IGN, Polygon and others)',
  'fandom-wiki': 'Fandom wiki',
  'reddit': 'Reddit (live threads)',
  'cheapshark': 'CheapShark (current prices)',
  'official-api': 'Official game API',
  'official-news': 'Official news page',
  'web-search': 'Live web search',
  'agentic-websearch': 'Live web search',
};

// Browsers refuse to open a data: URL as a top-level page, so the old
// window.open(previewUrl) did nothing for attached screenshots.
async function openImage(url) {
  try {
    const target = url.startsWith('data:') ? URL.createObjectURL(await (await fetch(url)).blob()) : url;
    window.open(target, '_blank', 'noopener');
  } catch { /* nothing to open */ }
}

function MessageImages({ images, isUser }) {
  return (
    <div className={`cx-images${isUser ? ' is-user' : ''}`}>
      {images.map((img, index) => (
        <button key={index} type="button" className="cx-image" onClick={() => openImage(img.previewUrl)}
          aria-label={`Open ${isUser ? 'attached screenshot' : 'generated image'} ${index + 1} full size`}>
          <img
            src={img.previewUrl}
            alt={isUser ? `Attached screenshot ${index + 1}` : `Generated image ${index + 1}`}
            loading="lazy"
          />
          {!isUser && <span className="cx-image__badge">AI generated</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Copy / Share under a finished answer. Share builds a spoiler-safe link
 * (the answer travels in the URL fragment; nothing is stored) and uses the
 * phone share sheet where there is one, the clipboard otherwise. If the
 * clipboard is blocked, the link is shown to copy by hand.
 */
function AnswerActions({ text, copyText, question, game, sources }) {
  const [state, setState] = useState('idle'); // idle | working | copied | linked | manual
  const [manualUrl, setManualUrl] = useState('');

  const settle = (next) => {
    setState(next);
    if (next === 'copied' || next === 'linked') setTimeout(() => setState('idle'), 2200);
  };

  const copy = async () => {
    try {
      // Server spoiler syntax (||…||) is kept on purpose: pasted into Discord
      // it becomes Discord's own spoiler, so nothing gets spoiled there either.
      await navigator.clipboard.writeText((copyText || text).trim());
      settle('copied');
    } catch { settle('idle'); }
  };

  const share = async () => {
    setState('working');
    let url;
    try {
      const { buildShareUrl } = await import('../utils/share');
      url = await buildShareUrl({ q: question || '', a: text, g: game || null, s: sources || [] });
    } catch {
      settle('idle');
      return;
    }
    track('share_created');
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (coarse && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'GameGuide', text: question ? `“${question}” — spoiler-safe answer` : 'A spoiler-safe GameGuide answer', url });
        settle('idle');
        return;
      } catch (err) {
        if (err?.name === 'AbortError') { settle('idle'); return; }
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      settle('linked');
    } catch {
      setManualUrl(url);
      settle('manual');
    }
  };

  const said = state === 'copied' ? 'Answer copied' : state === 'linked' ? 'Share link copied' : '';

  return (
    <div className="cx-actions">
      <button type="button" className={`cx-action${state === 'copied' ? ' is-done' : ''}`} onClick={copy}>
        {state === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        {state === 'copied' ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        className={`cx-action${state === 'linked' ? ' is-done' : ''}`}
        onClick={share}
        disabled={state === 'working'}
        title="A link to this answer. Spoilers stay hidden for whoever opens it."
      >
        {state === 'linked' ? <Check size={13} aria-hidden="true" /> : <Share2 size={13} aria-hidden="true" />}
        {state === 'linked' ? 'Link copied' : 'Share'}
      </button>
      {state === 'manual' && (
        <input
          className="cx-action__link"
          readOnly
          value={manualUrl}
          aria-label="Share link — copy it from here"
          onFocus={(e) => e.currentTarget.select()}
          ref={(el) => el?.select()}
        />
      )}
      <span className="sr-only" role="status" aria-live="polite">{said}</span>
    </div>
  );
}

function MessageBubble({ message, question = '', onFollowUpClick, followUpsDisabled = false, actions = true }) {
  const isUser = message.sender === 'user';
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesId = useId();

  // Mid-stream the server's spoiler guard hasn't run yet (it runs on the final
  // text), so apply its passes here: a name the reply already hid stays
  // hidden when it comes up again. Chips wait for the final text — they are
  // plain buttons, and the server drops the ones that would spoil.
  const streaming = !isUser && !!message.streaming;
  const bodyText = streaming ? guardStreaming(message.text || '') : message.text;
  const { cleanText, followUps } = isUser
    ? { cleanText: message.text, followUps: [] }
    : parseFollowUps(bodyText);
  const hasImages = message.images && message.images.length > 0;

  if (isUser) {
    return (
      <div className="cx-entry cx-entry--user">
        <span className="cx-label">You</span>
        <div className="cx-query">
          {hasImages && <MessageImages images={message.images} isUser />}
          {cleanText && <p>{cleanText}</p>}
        </div>
      </div>
    );
  }

  const meta = message.meta && !message.meta.error ? message.meta : null;
  const uniqueSources = [...new Set((meta?.sources || []).filter(Boolean))];
  // Only a complete, real answer: not an error, a rate-limit note, an answer
  // cut off by Stop, or a command's canned reply.
  const shareable = actions && !streaming && !message.isCommand && !!cleanText?.trim()
    && !message.meta?.error && !message.meta?.partial && !message.meta?.rateLimited;
  const persona = meta?.persona || null;

  // Spoiler Shield: what it held back, shown under the answer.
  const shield = meta?.spoiler;
  const shieldLabel = shield?.active
    ? (shield.mode === 'progress' && shield.progress
        ? `Hidden past: ${shield.progress}`
        : shield.mode === 'unknown'
          ? 'Spoiler Shield on — tell me where you are'
          : null)
    : null;

  return (
    <article className={`cx-entry cx-entry--ai${message.isCommand ? ' is-command' : ''}`} aria-busy={streaming || undefined}>
      <div className="cx-overline">
        <span className="cx-mark" aria-hidden="true" />
        <span>{persona ? `GameGuide · ${persona}` : 'GameGuide'}</span>
        <span className="cx-overline__rule" aria-hidden="true" />
      </div>

      {hasImages && <MessageImages images={message.images} isUser={false} />}

      <div className="cx-prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {toSpoilerMarkdown(cleanText)}
        </ReactMarkdown>
      </div>

      {meta && (shieldLabel || meta.vision || meta.cached || uniqueSources.length > 0) && (
        <div className="cx-meta">
          {shieldLabel && (
            <span className="cx-chip is-accent" title="Spoiler Shield: nothing past this point is shown unless you reveal it">
              <Shield size={12} aria-hidden="true" />{shieldLabel}
            </span>
          )}
          {meta.vision && <span className="cx-chip" title="Screenshot analysis">Vision</span>}
          {meta.cached && <span className="cx-chip" title="Served from a recent identical answer">Cached</span>}
          {uniqueSources.length > 0 && (
            <button
              type="button"
              className="cx-chip cx-chip--button"
              aria-expanded={sourcesOpen}
              aria-controls={sourcesId}
              onClick={() => setSourcesOpen(o => !o)}
            >
              {uniqueSources.length} live source{uniqueSources.length > 1 ? 's' : ''}
              <ChevronDown size={12} aria-hidden="true" className={sourcesOpen ? 'is-flipped' : undefined} />
            </button>
          )}
        </div>
      )}
      {sourcesOpen && (
        <ol className="cx-sources" id={sourcesId} aria-label="Live data used in this answer">
          {uniqueSources.map((src, i) => (
            <li key={src}><span className="cx-sources__n">{i + 1}</span>{SOURCE_LABELS[src] || src}</li>
          ))}
        </ol>
      )}

      {shareable && (
        <AnswerActions
          text={message.text}
          copyText={cleanText}
          question={question}
          game={meta?.game}
          sources={uniqueSources}
        />
      )}

      {!streaming && followUps.length > 0 && (
        <FollowUpChips followUps={followUps} onChipClick={onFollowUpClick} disabled={followUpsDisabled} />
      )}
    </article>
  );
}

// Streaming re-renders the transcript on every token; memo keeps every
// finished answer (same message object, same props) out of that work.
export default memo(MessageBubble);
