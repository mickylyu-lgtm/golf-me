// "Open a shared round link while signed out -> sign in / sign up -> land on
// that round." The path is kept in localStorage (not in the OAuth/magic-link
// redirect URL), because:
//   * every sign-in path comes back to the site root: Google on the web
//     redirects to window.location.origin, the native app's Google/email
//     link returns through com.golfme.ios://auth-callback, the 6-digit code
//     and password never leave the page -- and the Supabase redirect
//     allowlist would need changing to carry a path;
//   * a brand-new account goes through /profile-setup and /ready first.
// localStorage survives all of that on the same device. A magic link opened
// on a different device/browser lands on Home there (nothing stored), which
// is the safe default.
//
// Only a real round path is accepted (no open redirect), and it expires.

const KEY = "golfme:returnTo";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ROUND_PATH_RE = /^\/golf-calls\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAllowedReturnPath(path: string): boolean {
  return ROUND_PATH_RE.test(path);
}

export function saveReturnTo(path: string): void {
  if (!isAllowedReturnPath(path)) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ path, savedAt: Date.now() }));
  } catch {
    // Storage unavailable: they'll land on Home after signing in instead.
  }
}

export function clearReturnTo(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored either.
  }
}

// Non-destructive read: AuthedLayout redirects "/" to the stored round
// during render (before Home mounts and could auto-start the tutorial), and
// ReturnToArrival clears it once that round is on screen.
export function peekReturnTo(): string | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { path?: unknown; savedAt?: unknown };
    if (
      typeof parsed.path === "string" &&
      typeof parsed.savedAt === "number" &&
      Date.now() - parsed.savedAt <= MAX_AGE_MS &&
      isAllowedReturnPath(parsed.path)
    ) {
      return parsed.path;
    }
  } catch {
    // Corrupt value: dropped below.
  }
  clearReturnTo();
  return null;
}

const APP_HOSTS = new Set(["golfme.app", "www.golfme.app"]);

// Maps a Universal Link (https://golfme.app/golf-calls/<id>) delivered to the
// native app via appUrlOpen onto the in-app route. Anything else -- the
// com.golfme.ios:// auth callback, other hosts, paths outside the AASA
// allowlist -- returns null and is left alone.
export function routeForAppUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !APP_HOSTS.has(parsed.hostname)) return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  return isAllowedReturnPath(path) ? path : null;
}
