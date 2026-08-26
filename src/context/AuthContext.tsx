import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { profileRowToGolferProfile } from "../lib/profile";
import type { ProfileRow } from "../lib/profile";
import type { GolferProfile } from "../types";

// "Try Demo" is a deliberately separate, entirely local concept from real
// Supabase auth — it never touches supabase.auth, so it can't leak into or
// be confused with a real session. Persisted so a demo session survives a
// refresh the same way a real one does (Phase 1 requirement: session
// restoration applies to both).
const DEMO_FLAG_KEY = "golfme:isDemo";

function readDemoFlag(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEMO_FLAG_KEY) === "1";
}

interface AuthContextValue {
  // True while the initial session/profile restore is still in flight —
  // gates the app behind GolfMeLoader so it never flickers Welcome->Home.
  authLoading: boolean;
  isDemo: boolean;
  authUser: Session["user"] | null;
  profile: GolferProfile | null;
  hasOnboarded: boolean;
  onboardingTutorialCompleted: boolean;
  // Not part of GolferProfile (that type is UI-shaped, never had a language
  // field) — exposed separately for the device-locale<->profile sync in
  // App.tsx.
  profileLanguage: string | null;
  isAuthenticated: boolean;

  signInWithGoogle: () => Promise<void>;
  signInWithEmailOtp: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
  refreshProfile: () => Promise<void>;
  saveProfile: (patch: Record<string, unknown>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isDemo, setIsDemo] = useState(readDemoFlag);
  const [authUser, setAuthUser] = useState<Session["user"] | null>(null);
  const [profileRow, setProfileRow] = useState<ProfileRow | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);

  const fetchProfile = useCallback(async (userId: string) => {
    // profileChecked must flip to true no matter what happens here — a
    // network-level throw (not just an API error in `error`) must never
    // leave a signed-in visitor stuck on the loading screen forever.
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (error) {
        console.error("Golf Me: failed to load profile.", error);
        setProfileRow(null);
      } else {
        setProfileRow(data as ProfileRow | null);
      }
    } catch (err) {
      console.error("Golf Me: failed to load profile.", err);
      setProfileRow(null);
    } finally {
      setProfileChecked(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Single source of truth — onAuthStateChange fires an INITIAL_SESSION
    // event immediately on subscription with whatever session is currently
    // stored, then real events after that (sign-in, sign-out, token
    // refresh). This used to run ALONGSIDE a separate getSession() call,
    // which raced it: getSession() resolving first could let a logged-out
    // visitor reach a guest-only page (e.g. Login) before this listener's
    // own initial event landed a moment later with a stale cached session
    // and flipped them to logged-in mid-visit — reported live as "Back"
    // suddenly jumping to Home right after the Login page had already
    // rendered, with no login action taken in between. One listener, one
    // state update path, no race.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setAuthUser(session?.user ?? null);
      setSessionChecked(true);
      if (session?.user) {
        setProfileChecked(false);
        fetchProfile(session.user.id);
      } else {
        setProfileRow(null);
        setProfileChecked(true);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signInWithEmailOtp = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const enterDemoMode = useCallback(() => {
    window.localStorage.setItem(DEMO_FLAG_KEY, "1");
    setIsDemo(true);
  }, []);

  const exitDemoMode = useCallback(() => {
    window.localStorage.removeItem(DEMO_FLAG_KEY);
    setIsDemo(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (authUser) await fetchProfile(authUser.id);
  }, [authUser, fetchProfile]);

  const saveProfile = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!authUser) throw new Error("Golf Me: cannot save a profile with no signed-in user.");
      const { error } = await supabase.from("profiles").update(patch).eq("id", authUser.id);
      if (error) throw error;
      await fetchProfile(authUser.id);
    },
    [authUser, fetchProfile],
  );

  const profile = useMemo(() => (profileRow ? profileRowToGolferProfile(profileRow) : null), [profileRow]);

  const value: AuthContextValue = {
    authLoading: !sessionChecked || (Boolean(authUser) && !profileChecked),
    isDemo,
    authUser,
    profile,
    hasOnboarded: profileRow?.has_onboarded ?? false,
    onboardingTutorialCompleted: profileRow?.onboarding_tutorial_completed ?? false,
    profileLanguage: profileRow?.language ?? null,
    isAuthenticated: isDemo || Boolean(authUser),
    signInWithGoogle,
    signInWithEmailOtp,
    signOut,
    enterDemoMode,
    exitDemoMode,
    refreshProfile,
    saveProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
