// Offline cold start: is there still a signed-in session on this device?
// Kept free of React/Supabase imports so tests/authSession.test.ts runs
// under plain node --test.
//
// supabase-js keeps the session in localStorage under
// `sb-<project ref>-auth-token`. When the app starts with an expired access
// token and the refresh can't reach Supabase (offline, flaky network, 5xx),
// auth-js still reports INITIAL_SESSION with no session, but it KEEPS the
// stored session (it only removes it when Supabase actually rejects the
// refresh token). So "INITIAL_SESSION was empty but a session with a refresh
// token is still stored" means "signed in, just can't reach Supabase yet":
// AuthContext holds the loader instead of showing the sign-in screen.

type ReadableStorage = Pick<Storage, "length" | "key" | "getItem">;

const AUTH_TOKEN_KEY = /^sb-.+-auth-token$/;

export function hasStoredSession(storage: ReadableStorage | null | undefined): boolean {
  if (!storage) return false;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !AUTH_TOKEN_KEY.test(key)) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      const value = JSON.parse(raw) as { refresh_token?: unknown } | null;
      if (value && typeof value.refresh_token === "string" && value.refresh_token.length > 0) return true;
    }
  } catch {
    // Blocked storage or junk: treat as no session (the sign-in screen shows).
  }
  return false;
}

export function browserStorage(): ReadableStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// How often the held loader asks Supabase again, besides online/resume.
// auth-js answers repeat attempts within 60 s of a failed refresh from a
// cached failure, so recovery after the network returns can take up to a
// minute; the loader's own Retry (a reload) is the immediate path.
export const RESTORE_RETRY_MS = 15_000;
