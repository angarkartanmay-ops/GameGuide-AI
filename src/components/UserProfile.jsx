import React, { useState, useRef, useEffect } from 'react';
import { LogIn, LogOut, User as UserIcon } from 'lucide-react';
import useAuth from '../hooks/useAuth';

export default function UserProfile() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

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

  if (loading) {
    return <div className="user-profile skeleton"></div>;
  }

  if (!user) {
    return (
      <button className="glass-panel sign-in-btn" onClick={signInWithGoogle}>
        <LogIn size={16} />
        <span>Sign in</span>
      </button>
    );
  }

  const avatarUrl = user.user_metadata?.avatar_url;
  const fullName = user.user_metadata?.full_name || user.email;

  return (
    <div className="user-profile" ref={dropdownRef}>
      <button 
        className="avatar-btn glass-panel" 
        onClick={() => setDropdownOpen(!dropdownOpen)}
        title={fullName}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="User Avatar" className="user-avatar" />
        ) : (
          <UserIcon size={18} />
        )}
      </button>

      {dropdownOpen && (
        <div className="user-dropdown glass-panel animate-fade-in">
          <div className="dropdown-header">
            <strong>{fullName}</strong>
            <span className="user-email">{user.email}</span>
          </div>
          <button 
            className="dropdown-item sign-out-btn" 
            onClick={() => {
              setDropdownOpen(false);
              signOut();
            }}
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
}
