import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient';

// Auth events that materially change the user identity. We only react to
// these — TOKEN_REFRESHED and INITIAL_SESSION fire on every tab refocus and
// would otherwise cascade into a loading-screen re-mount loop.
const IDENTITY_EVENTS = new Set(['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED']);

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Snapshot of the last user.id we saw — used to detect *real* identity changes
  // without re-rendering on every shallow user-object reference change.
  const lastUserIdRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    // Initial session — runs exactly once on mount.
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      const initialUser = session?.user || null;
      lastUserIdRef.current = initialUser?.id || null;
      setUser(initialUser);
      setLoading(false);
    })();

    // Subsequent events: only react if the user IDENTITY actually changed
    // (signed in, signed out, or user profile updated). Ignore TOKEN_REFRESHED
    // / INITIAL_SESSION — they fire on tab focus and don't change who's logged in.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;
        if (!IDENTITY_EVENTS.has(event)) return;
        const nextId = session?.user?.id || null;
        if (nextId === lastUserIdRef.current) return; // no real change
        lastUserIdRef.current = nextId;
        setUser(session?.user || null);
        // Don't toggle loading on subsequent events — only the initial fetch sets it.
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        }
      });
      if (error) throw error;
    } catch (error) {
      console.error('Error signing in:', error.message);
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Error signing out:', error.message);
    }
  };

  return { user, loading, signInWithGoogle, signOut };
}
