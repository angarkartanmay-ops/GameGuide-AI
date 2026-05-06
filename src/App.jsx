import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { Gamepad2, Radio, BookOpen, DollarSign } from 'lucide-react';
import ThemeSelector from './components/ThemeSelector';
import UserProfile from './components/UserProfile';
import ChatContainer from './components/ChatContainer';
import ChatInput from './components/ChatInput';
import PriceBadge from './components/PriceBadge';
import useChat from './hooks/useChat';
import useAuth from './hooks/useAuth';
import LoadingScreen from './components/LoadingScreen';
import LandingPage from './components/LandingPage';

function App() {
  const [showLanding, setShowLanding] = useState(() => sessionStorage.getItem('gg_entered') !== '1');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'default');
  const { user, loading: authLoading } = useAuth();
  const { messages, isLoading, sendMessage, cancelRequest, redditActive, wikiActive, priceActive, priceData, SLASH_COMMANDS } = useChat(user);

  const [showLoader, setShowLoader] = useState(true);
  const [exitingLoader, setExitingLoader] = useState(false);
  // Splash plays exactly ONCE on initial app load — not on tab refocus,
  // token refresh, or any other auth state change.
  const splashShownRef = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Show the splash exactly once — on the first time auth resolves.
  useEffect(() => {
    if (authLoading) return;        // still bootstrapping — keep loader on
    if (splashShownRef.current) return; // already played the splash this session

    splashShownRef.current = true;
    const exitTimer = setTimeout(() => {
      setExitingLoader(true);
      const unmountTimer = setTimeout(() => setShowLoader(false), 500);
      return () => clearTimeout(unmountTimer);
    }, 1500);

    return () => clearTimeout(exitTimer);
  }, [authLoading]);

  if (showLanding) {
    return (
      <LandingPage
        onEnter={() => {
          sessionStorage.setItem('gg_entered', '1');
          setShowLanding(false);
        }}
      />
    );
  }

  return (
    <div className="app-container">
      {showLoader && <LoadingScreen isExiting={exitingLoader} />}
      <header className="main-header">
        <div className="brand">
          <Gamepad2 className="brand-icon" size={32} />
          <h1>GameGuide-AI</h1>
          <div className="intel-badges">
            {redditActive && (
              <div className="community-badge animate-fade-in">
                <Radio size={14} />
                <span>Community Intel</span>
              </div>
            )}
            {wikiActive && (
              <div className="community-badge wiki-badge animate-fade-in">
                <BookOpen size={14} />
                <span>Wiki Intel</span>
              </div>
            )}
            {priceActive && (
              <div className="community-badge price-badge animate-fade-in">
                <DollarSign size={14} />
                <span>Live Prices</span>
              </div>
            )}
          </div>
        </div>
        <div className="header-controls">
          <ThemeSelector currentTheme={theme} onThemeChange={setTheme} />
          <UserProfile />
        </div>
      </header>

      <main className="chat-wrapper">
        
        <ChatContainer
          messages={messages}
          isLoading={isLoading}
          onFollowUpClick={(question) => sendMessage(question, [])}
        />
        {priceActive && <PriceBadge priceData={priceData} />}
        <ChatInput onSendMessage={sendMessage} onCancel={cancelRequest} isLoading={isLoading} SLASH_COMMANDS={SLASH_COMMANDS} />
      </main>
    </div>
  );
}

export default App;
