import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import ThemeSelector from '../ThemeSelector';
import UserProfile from '../UserProfile';
import ChatContainer from '../ChatContainer';
import ChatInput from '../ChatInput';
import PriceBadge from '../PriceBadge';
import LoadingScreen from '../LoadingScreen';
import FeedbackButton from '../FeedbackButton';
import CodexBackdrop from './CodexBackdrop';
import ContextPill from './ContextPill';
import StealthSweep from './StealthSweep';
import useGameAmbience from '../../hooks/useGameAmbience';
import { latestSpoilerMeta } from '../../utils/gameContext';
import '../../styles/codex.css';

/**
 * The chat screen — "Living Codex". When a game is in context the whole
 * screen takes on its key art and an accent sampled from it; answers are set
 * like a guide page. Owns layout only: conversation state lives in useChat
 * (App), game art in useGameAmbience.
 */
export default function CodexShell({
  user, chat, theme, onThemeChange, onHome, navigate, showLoader, exitingLoader,
}) {
  const {
    messages, isLoading, sendMessage, cancelRequest, redditActive, wikiActive, webActive,
    priceActive, priceData, SLASH_COMMANDS, stealthMode, stealthFx, streamStage,
  } = chat;
  const inputRef = useRef(null);

  const ambience = useGameAmbience({ messages, streamStage, isLoading, stealthMode });
  const spoiler = latestSpoilerMeta(messages);
  const intel = { wiki: wikiActive, community: redditActive, web: webActive };

  // Stable across renders so memoised messages don't re-render per token.
  const sendRef = useRef(sendMessage);
  useLayoutEffect(() => { sendRef.current = sendMessage; });
  const ask = useCallback((q) => sendRef.current(q, []), []);
  const draft = useCallback((t) => inputRef.current?.setDraft(t), []);
  const attach = useCallback(() => inputRef.current?.openFilePicker(), []);

  // A cover picked on the landing arrives as a one-shot draft: typed into the
  // bar for the player to edit or send, never sent on their behalf.
  useEffect(() => {
    let text = null;
    try {
      text = sessionStorage.getItem('gg.startDraft');
      sessionStorage.removeItem('gg.startDraft');
    } catch { /* storage blocked: nothing was stashed either */ }
    if (text && text.length <= 200) inputRef.current?.setDraft(text);
  }, []);

  const style = ambience.accent ? { '--codex-accent': ambience.accent } : undefined;

  return (
    <div className={`codex${stealthMode ? ' is-stealth' : ''}${ambience.hero ? ' has-art' : ''}`} style={style}>
      {showLoader && <LoadingScreen isExiting={exitingLoader} />}
      <CodexBackdrop src={stealthMode ? null : ambience.hero} />
      {stealthFx && <StealthSweep key={stealthFx.id} dir={stealthFx.dir} />}

      <header className="cx-top">
        <button type="button" className="cx-brand" onClick={onHome} aria-label="GameGuide — return to home">
          <span className="cx-mark cx-mark--lg" aria-hidden="true" />
          <span className="cx-brand__name">GameGuide</span>
        </button>
        <ContextPill
          stealth={stealthMode}
          game={ambience.name}
          spoiler={spoiler}
          wiki={wikiActive}
          community={redditActive}
          web={webActive}
          price={priceActive}
        />
        <div className="cx-top__end">
          <ThemeSelector currentTheme={theme} onThemeChange={onThemeChange} />
          <UserProfile />
        </div>
      </header>

      {/* Persistent incognito cue. The /stealth confirmation scrolls away; a
          user who can't tell whether they're being recorded has no privacy
          guarantee. */}
      {stealthMode && (
        <div className="cx-stealth" role="status" aria-live="polite">
          <span className="cx-stealth__rec" aria-hidden="true" />
          <span className="cx-stealth__kicker">Off the record</span>
          <span className="cx-stealth__text">Nothing here is saved, learned or logged.</span>
          <button type="button" className="cx-stealth__leave" onClick={() => ask('/stealth')} disabled={isLoading}>
            Leave<span className="cx-stealth__leave-hint"> and discard</span>
          </button>
        </div>
      )}

      <main className="cx-main">
        <ChatContainer
          messages={messages}
          isLoading={isLoading}
          streamStage={streamStage}
          onFollowUpClick={ask}
          gameName={ambience.name}
          intel={intel}
          onAsk={ask}
          onDraft={draft}
          onAttach={attach}
          stealthMode={stealthMode}
        />
      </main>

      <div className="cx-dock">
        {priceActive && <PriceBadge priceData={priceData} />}
        <ChatInput
          ref={inputRef}
          onSendMessage={sendMessage}
          onCancel={cancelRequest}
          isLoading={isLoading}
          SLASH_COMMANDS={SLASH_COMMANDS}
          stealthMode={stealthMode}
          gameName={ambience.name}
        />
        <nav className="cx-foot" aria-label="Site">
          <button type="button" onClick={() => navigate('about')}>About</button>
          <button type="button" onClick={() => navigate('terms')}>Terms</button>
          <button type="button" onClick={() => navigate('contacts')}>Contact</button>
          <FeedbackButton sessionId={user?.id || null} inline />
          <span>© 2026 GameGuide-AI</span>
        </nav>
      </div>
    </div>
  );
}
