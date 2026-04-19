import React, { useState, useEffect } from 'react';
import './App.css';
import { Gamepad2, Radio, BookOpen } from 'lucide-react';
import ThemeSelector from './components/ThemeSelector';
import UserProfile from './components/UserProfile';
import ChatContainer from './components/ChatContainer';
import ChatInput from './components/ChatInput';
import useChat from './hooks/useChat';
import useAuth from './hooks/useAuth';
import LoadingScreen from './components/LoadingScreen';

function App() {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'default');
  const { user, loading: authLoading } = useAuth();
  const { messages, isLoading, sendMessage, redditActive, wikiActive } = useChat(user);

  const [showLoader, setShowLoader] = useState(true);
  const [exitingLoader, setExitingLoader] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Handle manual login/logout triggers or initial auth loading
  useEffect(() => {
    if (authLoading) {
      setShowLoader(true);
      setExitingLoader(false);
      return;
    }

    // Force loader trigger immediately when user explicitly logs in or out
    setShowLoader(true);
    setExitingLoader(false);

    // Artificial animated delay of 1.5s 
    const timer = setTimeout(() => {
      setExitingLoader(true);
      // Wait 500ms for transition CSS to finish before unmounting completely
      setTimeout(() => setShowLoader(false), 500);
    }, 1500);
    
    return () => clearTimeout(timer);
  }, [authLoading, user]);

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
        <ChatInput onSendMessage={sendMessage} isLoading={isLoading} />
      </main>
    </div>
  );
}

export default App;
