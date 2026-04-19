import React, { useState, useEffect } from 'react';
import './LoadingScreen.css';

const ANIMATIONS = ['anim-cyber-glitch', 'anim-radar-sweep', 'anim-hex-grid', 'anim-pulse-neon'];

const BOOT_TEXTS = [
  "INITIALIZING NEURAL NET...",
  "ESTABLISHING GAMER UPLINK...",
  "LOADING PROCEDURAL ASSETS...",
  "DECRYPTING GAME DATA...",
  "CONNECTING TO MAINFRAME...",
  "SYNCING TO CLOUD DB...",
  "BYPASSING SECURITY PROTOCOLS...",
  "MOUNTING KNOWLEDGE BASE..."
];

export default function LoadingScreen({ isExiting }) {
  const [animType, setAnimType] = useState('');
  const [bootText, setBootText] = useState('');
  const [subText, setSubText] = useState('0x000000');

  useEffect(() => {
    // Randomize on mount
    setAnimType(ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)]);
    setBootText(BOOT_TEXTS[Math.floor(Math.random() * BOOT_TEXTS.length)]);

    // Simulate fast hacker text for subtext
    const interval = setInterval(() => {
      const randomHex = '0x' + Math.floor(Math.random() * 16777215).toString(16).toUpperCase().padStart(6, '0');
      setSubText(randomHex);
    }, 80); // Fast hex ticking

    return () => clearInterval(interval);
  }, []);

  const renderAnimation = () => {
    switch (animType) {
      case 'anim-cyber-glitch':
        return <div className="glitch-box"></div>;
      case 'anim-radar-sweep':
        return <div className="radar-circle"></div>;
      case 'anim-hex-grid':
        return (
          <div className="hex-spinner">
            <div className="hex"></div>
            <div className="hex"></div>
            <div className="hex"></div>
            <div className="hex"></div>
          </div>
        );
      case 'anim-pulse-neon':
        return (
          <div className="ring-container">
            <div className="ring"></div>
            <div className="ring"></div>
          </div>
        );
      default:
        // Render a safe default if state is somehow slow
        return <div className="glitch-box"></div>;
    }
  };

  if (!animType) return null; // Avoid empty render

  return (
    <div className={`loading-screen-overlay ${animType} ${isExiting ? 'exiting' : ''}`}>
      <div className="loading-content">
        {renderAnimation()}
        <div className="loading-text">{bootText}</div>
        <div className="loading-subtext">{subText}</div>
      </div>
    </div>
  );
}
