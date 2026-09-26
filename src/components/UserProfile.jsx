import React, { useState, useRef, useEffect } from 'react';
import { LogIn, LogOut, User as UserIcon } from 'lucide-react';
import useAuth from '../hooks/useAuth';

export default function UserProfile() {
  const { user, loading, signInWithGoogle, signOut, authError } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const avatarRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Esc closes the menu and hands focus back to the avatar.
  useEffect(() => {
    if (!dropdownOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setDropdownOpen(false); avatarRef.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dropdownOpen]);

  if (loading) {
    return <div className="user-profile skeleton" aria-hidden="true"></div>;
  }

  if (!user) {
    return (
      <div className="sign-in-wrap">
        <button type="button" className="glass-panel sign-in-btn" onClick={signInWithGoogle}>
          <LogIn size={16} aria-hidden="true" />
          <span>Sign in</span>
        </button>
        {authError && <span className="sign-in-error" role="alert">{authError}</span>}
      </div>
    );
  }

  const avatarUrl = user.user_metadata?.avatar_url;
  const fullName = user.user_metadata?.full_name || user.email;

  return (
    <div className="user-profile" ref={dropdownRef}>
      <button
        ref={avatarRef}
        type="button"
        className="avatar-btn glass-panel"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        title={fullName}
        aria-haspopup="menu"
        aria-expanded={dropdownOpen}
        aria-label={`Account: ${fullName}`}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="user-avatar" />
        ) : (
          <UserIcon size={18} aria-hidden="true" />
        )}
      </button>

      {dropdownOpen && (
        <div className="user-dropdown glass-panel animate-fade-in" role="menu" aria-label="Account">
          <div className="dropdown-header">
            <strong>{fullName}</strong>
            <span className="user-email">{user.email}</span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="dropdown-item sign-out-btn"
            onClick={() => {
              setDropdownOpen(false);
              signOut();
            }}
          >
            <LogOut size={16} aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
}
