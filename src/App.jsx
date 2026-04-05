import React, { useState, useEffect } from 'react';
import './App.css';
import { Gamepad2, Radio, BookOpen } from 'lucide-react';
import ThemeSelector from './components/ThemeSelector';
import ChatContainer from './components/ChatContainer';
import ChatInput from './components/ChatInput';
import useChat from './hooks/useChat';

function App() {
  const [theme, setTheme] = useState('default');
  const { messages, isLoading, sendMessage, redditActive, wikiActive } = useChat();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="app-container">
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
        <ThemeSelector currentTheme={theme} onThemeChange={setTheme} />
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
