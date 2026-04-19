import React, { useState, useEffect } from 'react';
import './LoadingScreen.css';

const ANIMATIONS = ['anim-electric-nexus', 'anim-hyper-space', 'anim-data-rain', 'anim-energy-shield'];

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
    }, 80);

    return () => clearInterval(interval);
  }, []);

  const renderAnimation = () => {
    switch (animType) {
      case 'anim-electric-nexus':
        // Generate 24 lightning bolts radiating from center
        return (
          <div className="electric-nexus-container">
            {[...Array(24)].map((_, i) => (
              <div 
                key={i} 
                className="lightning-bolt" 
                style={{ '--rot': `${i * 15}deg`, '--delay': `${Math.random() * 2}s` }}
              />
            ))}
          </div>
        );

      case 'anim-hyper-space':
        // Generate 50 warp particles 
        return (
          <div className="hyper-space-container">
            {[...Array(50)].map((_, i) => (
              <div 
                key={i} 
                className="warp-particle" 
                style={{ 
                  '--angle': `${Math.random() * 360}deg`, 
                  '--dist': `${Math.random() * 100 + 20}vw`,
                  '--dur': `${Math.random() * 1.5 + 0.5}s`,
                  '--delay': `${Math.random() * 2}s` 
                }}
              />
            ))}
          </div>
        );

      case 'anim-data-rain':
        // Matrix style falling chunks across the screen
        return (
          <div className="data-rain-container">
            {[...Array(40)].map((_, i) => (
              <div 
                key={i} 
                className="rain-drop" 
                style={{ 
                  '--left': `${Math.random() * 100}vw`, 
                  '--dur': `${Math.random() * 1.5 + 0.5}s`,
                  '--delay': `${Math.random() * 2}s` 
                }}
              />
            ))}
          </div>
        );

      case 'anim-energy-shield':
        // Hexagon grid covering massive area
        return (
          <div className="energy-shield-container">
            {[...Array(100)].map((_, i) => (
              <div 
                key={i} 
                className="shield-hex" 
                style={{ '--pulse-delay': `${Math.random() * 3}s` }}
              />
            ))}
          </div>
        );

      default:
        return null;
    }
  };

  if (!animType) return null;

  return (
    <div className={`loading-screen-overlay ${animType} ${isExiting ? 'exiting' : ''}`}>
      {renderAnimation()}
      <div className="loading-content">
        <div className="loading-text">{bootText}</div>
        <div className="loading-subtext">{subText}</div>
      </div>
    </div>
  );
}
