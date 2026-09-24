import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { supabase } from "../lib/supabase";
import { unregisterPushNotifications } from "../lib/push";
import { profileRowToGolferProfile } from "../lib/profile";
import type { ProfileRow } from "../lib/profile";
import type { GolferProfile } from "../types";

// Must match the CFBundleURLTypes scheme registered in
// ios/App/App/Info.plist -- also has to be added to Supabase's Auth ->
// URL Configuration -> Redirect URLs allowlist, same as the https origin.
const NATIVE_OAUTH_REDIRECT = "com.golfme.ios://auth-callback";

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
  // Signed in, but the profile couldn't be loaded at all (no previous row to
  // fall back on). Rendered as a retry screen by AppGate — never treated as
  // "not onboarded", which would route into /profile-setup.
  profileLoadFailed: boolean;
  isDemo: boolean;
  authUser: Session["user"] | null;
  profile: GolferProfile | null;
  // Raw row, for the rare caller that must tell "unset" (null/empty column)
  // apart from a value — GolferProfile's mapping fills in UI defaults that
  // hide that distinction. Read-only; write through saveProfile.
  profileRow: ProfileRow | null;
  hasOnboarded: boolean;
  onboardingTutorialCompleted: boolean;
  // Not part of GolferProfile (that type is UI-shaped, never had a language
  // field) — exposed separately for the device-locale<->profile sync in
  // App.tsx.
  profileLanguage: string | null;
  // Not part of GolferProfile, same reasoning as profileLanguage — an
  // account-level setting the UI type was never shaped to carry. Defaults
  // true so a not-yet-loaded/demo profile doesn't read as opted out.
  pushEnabled: boolean;
  isAuthenticated: boolean;

  signInWithGoogle: () => Promise<void>;
  signInWithEmailOtp: (email: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
  refreshProfile: () => Promise<void>;
  saveProfile: (patch: Record<string, unknown>) => Promise<void>;
  // Set when a sign-in link/redirect comes back with an error instead of a
  // session (expired or already-used magic link is the common case — email
  // clients/security scanners that prefetch links can consume a one-time
  // link before the person actually taps it). Previously this failed
  // completely silently: the app just sat there with no feedback at all.
  // Whoever renders the sign-in UI is responsible for surfacing this (as a
  // toast, say) and calling clearAuthError once shown.
  authError: string | null;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isDemo, setIsDemo] = useState(readDemoFlag);
  const [authUser, setAuthUser] = useState<Session["user"] | null>(null);
  const [profileRow, setProfileRow] = useState<ProfileRow | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // True when the most recent profiles fetch failed (network/API error) —
  // distinct from "fetched fine, no row exists". A failed fetch must never
  // be read as "not onboarded" (that used to route a fully onboarded golfer
  // into /profile-setup, whose submit then overwrote their preferences).
  const [profileFetchFailed, setProfileFetchFailed] = useState(false);
  const clearAuthError = useCallback(() => setAuthError(null), []);
  // The user id the profile state currently belongs to. Lets the auth
  // listener tell a genuine identity change (sign-in/sign-out/switch) apart
  // from same-user events (TOKEN_REFRESHED, USER_UPDATED, a repeat
  // SIGNED_IN on tab refocus), and lets fetchProfile drop a response that
  // resolves after the user has already changed.
  const currentUserIdRef = useRef<string | null>(null);
  const profileFetchFailedRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string) => {
    // profileChecked must flip to true no matter what happens here — a
    // network-level throw (not just an API error in `error`) must never
    // leave a signed-in visitor stuck on the loading screen forever.
    let failed = false;
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (currentUserIdRef.current !== userId) return; // stale response for a previous user
      if (error) {
        console.error("GolfMe: failed to load profile.", error);
        failed = true;
      } else {
        setProfileRow(data as ProfileRow | null);
      }
    } catch (err) {
      if (currentUserIdRef.current !== userId) return;
      console.error("GolfMe: failed to load profile.", err);
      failed = true;
    }
    // On failure the previous row (if any) is deliberately kept as-is —
    // it's still this same user's last known-good profile.
    profileFetchFailedRef.current = failed;
    setProfileFetchFailed(failed);
    setProfileChecked(true);
  }, []);

  useEffect(() => {
    // Web/PWA equivalent of the native appUrlOpen error handling below — a
    // magic link that came back invalid/expired lands here as
    // #error=...&error_description=... in the URL instead of tokens, and
    // Supabase's own client-side redirect handling doesn't surface that to
    // app code on its own. Runs once on mount (Supabase already consumes
    // any real session tokens from the hash before this fires); the
    // replaceState clears it so a refresh doesn't re-show a stale error.
    if (typeof window === "undefined" || Capacitor.isNativePlatform()) return;
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const description = params.get("error_description") || params.get("error_code") || params.get("error");
    if (description) {
      setAuthError(description);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
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
    //
    // Only a real identity change (user id differs from the one the
    // profile state belongs to) resets the profile and re-gates the app
    // behind the full-screen loader. Same-user events — TOKEN_REFRESHED
    // (hourly, and on resume after the access token expired), USER_UPDATED,
    // a repeat SIGNED_IN on refocus — used to do that too, which unmounted
    // the whole router and threw away unsent drafts, attached videos, the
    // swing trimmer and the host wizard mid-use.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const nextUser = session?.user ?? null;
      const nextId = nextUser?.id ?? null;
      const sameUser = nextId !== null && nextId === currentUserIdRef.current;
      currentUserIdRef.current = nextId;
      setSessionChecked(true);

      if (sameUser && nextUser) {
        // Keep the existing user object reference unless something a
        // consumer actually reads changed — a fresh object on every token
        // refresh would re-fire every effect keyed on authUser (refetches,
        // the language save in App.tsx) for no reason.
        setAuthUser((prev) =>
          prev && prev.updated_at === nextUser.updated_at && prev.email_confirmed_at === nextUser.email_confirmed_at && prev.email === nextUser.email
            ? prev
            : nextUser,
        );
        // Silent background retry if the last profile fetch failed — never
        // flips profileChecked, so the router stays mounted.
        if (profileFetchFailedRef.current) fetchProfile(nextId);
        return;
      }

      setAuthUser(nextUser);
      setProfileRow(null);
      profileFetchFailedRef.current = false;
      setProfileFetchFailed(false);
      if (nextId) {
        setProfileChecked(false);
        fetchProfile(nextId);
      } else {
        setProfileChecked(true);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [fetchProfile]);

  useEffect(() => {
    // Google refuses to sign in from inside an embedded WKWebView (the
    // native app's own content view), so signInWithGoogle below hands the
    // OAuth flow to a real system browser instead. That browser has no way
    // to navigate back into the app on its own once Google redirects to
    // NATIVE_OAUTH_REDIRECT -- iOS itself does that hand-off (because the
    // scheme is registered in Info.plist), landing here as an appUrlOpen
    // event with the session tokens Supabase appended as a URL fragment
    // (implicit flow, this client's default -- no flowType override in
    // lib/supabase.ts).
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapacitorApp.addListener("appUrlOpen", async ({ url }) => {
      if (!url.startsWith(NATIVE_OAUTH_REDIRECT)) return;
      await Browser.close().catch(() => {});
      const fragment = url.split("#")[1] ?? "";
      const params = new URLSearchParams(fragment);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        await supabase.auth.setSession({ access_token, refresh_token });
      } else {
        // Supabase redirects here with an error instead of tokens when the
        // link was invalid, expired, or already used — previously silent.
        const description = params.get("error_description") || params.get("error_code") || params.get("error");
        if (description) setAuthError(description);
      }
    });
    return () => {
      listener.then((l) => l.remove());
    };
  }, []);

  // prompt: "select_account" forces Google's account chooser every time,
  // instead of Google silently reusing whichever Google account last
  // authorized this app on the device — the default behavior otherwise, and
  // not what you want when you're deliberately testing/switching accounts.
  const signInWithGoogle = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: NATIVE_OAUTH_REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
      });
      if (error) throw error;
      if (data.url) await Browser.open({ url: data.url });
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin, queryParams: { prompt: "select_account" } },
    });
    if (error) throw error;
  }, []);

  // Same native-vs-web redirect split as signInWithGoogle, and for the same
  // reason: on the native app, window.location.origin is still just
  // "https://golfme.app" (the WKWebView is displaying that live URL), so a
  // magic link built from it opens in Safari on tap instead of handing back
  // to the app -- there's no Associated Domains/Universal Link wiring for
  // that https origin, only the com.golfme.ios:// custom scheme (registered
  // for Google's OAuth callback). Reusing that same scheme here needs no new
  // native config or listener code: appUrlOpen above already parses
  // access_token/refresh_token out of any com.golfme.ios://auth-callback
  // URL's fragment, and Supabase puts the session there the same way
  // regardless of whether the sign-in was a magic link or OAuth.
  const signInWithEmailOtp = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: Capacitor.isNativePlatform() ? NATIVE_OAUTH_REDIRECT : window.location.origin },
    });
    if (error) throw error;
  }, []);

  // Password sign-in, alongside (not instead of) Google/magic-link -- exists
  // for accounts that specifically need a fixed, typeable credential rather
  // than an inbox or a Google account, e.g. Apple's App Review reviewer.
  // onAuthStateChange above is still the single source of truth for what
  // happens after this resolves.
  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    // Must run BEFORE supabase.auth.signOut() — the delete-own RLS policy
    // on device_push_tokens requires auth.uid() to still equal this row's
    // user_id, so this device's token has to be removed while the session
    // is still live, not after. A previous account must never keep
    // receiving pushes on a device it's signed out of.
    await unregisterPushNotifications();
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
      if (!authUser) throw new Error("GolfMe: cannot save a profile with no signed-in user.");
      const { error } = await supabase.from("profiles").update(patch).eq("id", authUser.id);
      if (error) throw error;
      // The write succeeded — reflect it locally right away, so a failed
      // follow-up fetch below can't leave stale state (e.g. has_onboarded
      // still false right after ProfileSetup saved it true).
      setProfileRow((prev) => (prev ? ({ ...prev, ...patch } as ProfileRow) : prev));
      await fetchProfile(authUser.id);
    },
    [authUser, fetchProfile],
  );

  const profile = useMemo(() => (profileRow ? profileRowToGolferProfile(profileRow) : null), [profileRow]);

  const value: AuthContextValue = {
    authLoading: !sessionChecked || (Boolean(authUser) && !profileChecked),
    profileLoadFailed: Boolean(authUser) && profileChecked && !profileRow && profileFetchFailed,
    isDemo,
    authUser,
    profile,
    profileRow,
    hasOnboarded: profileRow?.has_onboarded ?? false,
    onboardingTutorialCompleted: profileRow?.onboarding_tutorial_completed ?? false,
    profileLanguage: profileRow?.language ?? null,
    pushEnabled: profileRow?.push_enabled ?? true,
    isAuthenticated: isDemo || Boolean(authUser),
    signInWithGoogle,
    signInWithEmailOtp,
    signInWithPassword,
    signOut,
    enterDemoMode,
    exitDemoMode,
    refreshProfile,
    saveProfile,
    authError,
    clearAuthError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
