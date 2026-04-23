import React, { useState, useEffect } from 'react';
import './App.css';
import { Gamepad2, Radio, BookOpen, DollarSign } from 'lucide-react';
import ThemeSelector from './components/ThemeSelector';
import UserProfile from './components/UserProfile';
import MobileMenu from './components/MobileMenu';
import ChatContainer from './components/ChatContainer';
import ChatInput from './components/ChatInput';
import PriceBadge from './components/PriceBadge';
import useChat from './hooks/useChat';
import useAuth from './hooks/useAuth';
import LoadingScreen from './components/LoadingScreen';

function App() {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'default');
  const { user, loading: authLoading } = useAuth();
  const { messages, isLoading, sendMessage, redditActive, wikiActive, priceActive, priceData, SLASH_COMMANDS } = useChat(user);

  const [showLoader, setShowLoader] = useState(true);
  const [exitingLoader, setExitingLoader] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (authLoading) {
      setShowLoader(true);
      setExitingLoader(false);
      return;
    }
    setShowLoader(true);
    setExitingLoader(false);
    const timer = setTimeout(() => {
      setExitingLoader(true);
      setTimeout(() => setShowLoader(false), 500);
    }, 1500);
    return () => clearTimeout(timer);
  }, [authLoading, user]);

  const activeIntelCount = [redditActive, wikiActive, priceActive].filter(Boolean).length;

  return (
    <div className="app-container">
      {showLoader && <LoadingScreen isExiting={exitingLoader} />}

      {/* ── Desktop Header ─────────────────────────────────────── */}
      <header className="main-header desktop-header">
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

      {/* ── Mobile Header ──────────────────────────────────────── */}
      <header className="main-header mobile-header">
        <div className="mobile-brand">
          <Gamepad2 className="brand-icon" size={24} />
          <h1>GameGuide-AI</h1>
        </div>
        {/* Active intel dots */}
        {activeIntelCount > 0 && (
          <div className="mobile-intel-dots">
            {redditActive && <span className="intel-dot intel-dot--reddit" title="Community Intel active" />}
            {wikiActive && <span className="intel-dot intel-dot--wiki" title="Wiki Intel active" />}
            {priceActive && <span className="intel-dot intel-dot--price" title="Live Prices active" />}
          </div>
        )}
        <MobileMenu currentTheme={theme} onThemeChange={setTheme} />
      </header>

      <main className="chat-wrapper">
        <ChatContainer
          messages={messages}
          isLoading={isLoading}
          onFollowUpClick={(question) => sendMessage(question, [])}
        />
        {priceActive && <PriceBadge priceData={priceData} />}
        <ChatInput onSendMessage={sendMessage} isLoading={isLoading} SLASH_COMMANDS={SLASH_COMMANDS} />
      </main>
    </div>
  );
}

export default App;
