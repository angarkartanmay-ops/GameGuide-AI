import React, { useEffect, useState } from 'react';
import { ArrowRight, Shield } from 'lucide-react';
import MessageBubble from '../MessageBubble';
import CodexBackdrop from './CodexBackdrop';
import { decodeShare } from '../../utils/share';
import { resolveGameArt, firstLoadable, sampleAccent } from '../../utils/gameArt';
import { track } from '../../utils/analytics';
import '../../styles/codex.css';

/**
 * A shared answer, opened from a link (#share/…). Everything shown came out
 * of the link itself — nothing was stored — so the page says plainly that
 * it's a copy someone sent, not something GameGuide vouches for. Spoilers
 * stay behind their bars for whoever opens it; that's the point of sharing
 * from here instead of pasting a screenshot.
 *
 * The follow-up suggestions and the closing call to action both land in the
 * chat, with the question drafted — every shared link is a way in.
 */
export default function SharedAnswer({ encoded, onAsk, onHome }) {
  const [state, setState] = useState({ status: 'loading', share: null });
  const [art, setArt] = useState({ hero: null, accent: null });

  useEffect(() => {
    let cancelled = false;
    decodeShare(encoded).then((share) => {
      if (cancelled) return;
      setState({ status: share ? 'ok' : 'bad', share });
      track(share ? 'share_opened' : 'share_broken');
    });
    return () => { cancelled = true; };
  }, [encoded]);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Shared answer · GameGuide';
    return () => { document.title = prev; };
  }, []);

  // Dress the page in the game's art, same as the chat does. The name came
  // from the link, but /api/game-art only ever puts it in a query string to
  // a fixed host, so a crafted one can't point the lookup anywhere else.
  const game = state.share?.g || null;
  useEffect(() => {
    if (!game) return undefined;
    let cancelled = false;
    (async () => {
      const match = await resolveGameArt(game);
      if (!match || cancelled) return;
      const hero = await firstLoadable([...(match.hero || []), ...(match.header || [])]);
      const accent = match.accent || await sampleAccent([...(match.header || []), ...(match.cover || [])]);
      if (!cancelled) setArt({ hero, accent });
    })();
    return () => { cancelled = true; };
  }, [game]);

  const share = state.share;
  const style = art.accent ? { '--codex-accent': art.accent } : undefined;

  // A follow-up like "best weapon for this fight?" means nothing in the
  // reader's own, empty chat — so it carries the question it followed.
  const withContext = (followUp) => {
    const lead = share?.q && share.q.length <= 90
      ? `Re “${share.q}”${game ? ` (${game})` : ''}: `
      : game ? `${game}: ` : '';
    return lead + followUp;
  };

  return (
    <div className={`codex cx-shared${art.hero ? ' has-art' : ''}`} style={style}>
      <CodexBackdrop src={art.hero} />

      <header className="cx-top">
        <button type="button" className="cx-brand" onClick={onHome} aria-label="GameGuide — home">
          <span className="cx-mark cx-mark--lg" aria-hidden="true" />
          <span className="cx-brand__name">GameGuide</span>
        </button>
        <span className="cx-shared__tag">Shared answer{game ? ` · ${game}` : ''}</span>
        <div className="cx-top__end">
          <button type="button" className="cx-shared__btn is-primary" onClick={() => onAsk()}>
            Ask your own <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="cx-main">
        <div className="cx-scroll">
          <div className="cx-column">
            {state.status === 'loading' && (
              <div className="cx-skeleton cx-skeleton--history" aria-label="Opening the shared answer">
                <span style={{ width: '40%', marginLeft: 'auto' }} />
                <span style={{ width: '92%' }} />
                <span style={{ width: '76%' }} />
              </div>
            )}

            {state.status === 'bad' && (
              <section className="cx-shared__end" aria-labelledby="cx-shared-bad">
                <h1 id="cx-shared-bad" className="cx-shared__title">This link is incomplete.</h1>
                <p>Part of it was probably cut off when it was copied. Ask whoever sent it to share it again — or ask GameGuide yourself.</p>
                <div className="cx-shared__actions">
                  <button type="button" className="cx-shared__btn is-primary" onClick={() => onAsk()}>
                    Open GameGuide <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </section>
            )}

            {state.status === 'ok' && (
              <>
                <p className="cx-shared__note">
                  <Shield size={15} aria-hidden="true" />
                  <span>
                    Someone shared this with you. <strong>Spoilers stay hidden until you tap them.</strong>{' '}
                    It&apos;s a copy of their answer — GameGuide doesn&apos;t store shared links, so it can&apos;t vouch for what&apos;s in one.
                  </span>
                </p>

                {share.q && (
                  <div className="cx-entry cx-entry--user">
                    <span className="cx-label">They asked</span>
                    <div className="cx-query"><p>{share.q}</p></div>
                  </div>
                )}

                <MessageBubble
                  message={{ id: 'shared', sender: 'ai', text: share.a, images: [], meta: { sources: share.s, game } }}
                  actions={false}
                  onFollowUpClick={(q) => onAsk(withContext(q))}
                />

                <section className="cx-shared__end" aria-labelledby="cx-shared-end">
                  <h2 id="cx-shared-end" className="cx-shared__title">Your turn.</h2>
                  <p>
                    Ask about any game — bosses, builds, what&apos;s missable, whether it&apos;s on sale. GameGuide
                    researches it live and keeps the parts you haven&apos;t reached hidden.
                  </p>
                  <div className="cx-shared__actions">
                    <button type="button" className="cx-shared__btn is-primary" onClick={() => onAsk()}>
                      Ask GameGuide <ArrowRight size={15} aria-hidden="true" />
                    </button>
                    <button type="button" className="cx-shared__btn" onClick={onHome}>What is GameGuide?</button>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
