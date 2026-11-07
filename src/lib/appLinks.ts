// Which https://golfme.app links open the iPhone app (Universal Links), and
// where the app routes them. Kept free of React/Capacitor imports so
// tests/appLinks.test.ts runs under plain node --test.
//
// APP_LINK_COMPONENTS is the exact `components` list served in
// public/.well-known/apple-app-site-association (the test checks they are
// identical), so the router below claims precisely what iOS hands the app.
// iOS walks the list top to bottom and the FIRST match wins, so every
// exclusion sits above the includes it carves out of.
//
// Auth safety: sign-in results come back to golfme.app on the web (Google /
// Apple web redirect to "/", Supabase's Site URL fallback, a future
// token_hash email link). Those must stay in the browser that started them
// (its PKCE verifier / session lives there), so any URL carrying an auth
// parameter is excluded on every path, before anything else. Sign-in pages
// and token links (/auth/*, /login, /coach-invite, ...) are excluded too.
//
// When fix/auth-universal-link is merged, its `/auth/app` include must go at
// the very TOP of both lists (above the token_hash exclusion), and the
// router still ignores /auth/* (AuthContext handles those links itself).

export interface AppLinkComponent {
  "/"?: string;
  "?"?: Record<string, string>;
  "#"?: string;
  exclude?: true;
}

// Query items / fragment keys that mean "this is a sign-in result".
const AUTH_QUERY_KEYS = ["code", "token_hash", "access_token", "refresh_token", "error", "error_code", "error_description"];
// "?*" = at least one character, so a URL without the item never matches.
const authQueryExcludes: AppLinkComponent[] = AUTH_QUERY_KEYS.map((key) => ({ "/": "*", "?": { [key]: "?*" }, exclude: true }));
const authFragmentExcludes: AppLinkComponent[] = ["*access_token=*", "*refresh_token=*", "*token_hash=*", "*error=*"].map((hash) => ({
  "/": "*",
  "#": hash,
  exclude: true,
}));

// Never in the app: sign-in/sign-up flow, token links, legal/support pages
// (App Store listing + sign-in consent links), server routes, static files.
const EXCLUDED_PATHS = [
  "/auth/*",
  "/login",
  "/login/*",
  "/signup",
  "/signup/*",
  "/welcome",
  "/splash",
  "/onboarding",
  "/profile-setup",
  "/ready",
  "/coach-invite/*",
  "/privacy",
  "/terms",
  "/support",
  "/admin/*",
  "/__dev/*",
  "/api/*",
  "/.well-known/*",
  "/assets/*",
  "/icons/*",
  "/splash/*",
  "/golf-calls/new",
];
const STATIC_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg", "ico", "json", "js", "css", "map", "txt", "xml", "webmanifest", "mp4", "mov", "pdf"];

// Opens in the app. Exact paths and "/x/*" subtrees, never a bare "/x*"
// prefix (that would also claim "/xyz").
const INCLUDED_PATHS = [
  "/",
  "/discover",
  "/find",
  "/auto-match",
  "/golf-calls",
  "/golf-calls/*",
  "/my-rounds",
  "/profile",
  "/profile/*",
  "/settings",
  "/settings/*",
  "/help",
  "/about",
  "/golfer/*",
  "/messages",
  "/messages/*",
  "/community",
  "/community/*",
  "/saved-posts",
  "/coach-reviews",
  "/tee-times",
  "/tee-times/*",
  "/courses/*",
  "/caddie",
  "/caddie/*",
];

export const APP_LINK_COMPONENTS: AppLinkComponent[] = [
  ...authQueryExcludes,
  ...authFragmentExcludes,
  ...EXCLUDED_PATHS.map((path): AppLinkComponent => ({ "/": path, exclude: true })),
  ...STATIC_EXTENSIONS.map((ext): AppLinkComponent => ({ "/": `*.${ext}`, exclude: true })),
  ...INCLUDED_PATHS.map((path): AppLinkComponent => ({ "/": path })),
];

// Apple's pattern syntax: "*" = any run of characters (including "/" and
// none), "?" = exactly one character. Case-sensitive, like the AASA default.
function patternToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("")
    .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}$`, "s");
}

// First matching component decides, as on iOS; no match = not claimed.
// A query item missing from the URL is matched as "" (so "?*" never
// matches it).
export function isClaimedByComponents(components: AppLinkComponent[], pathname: string, search: string, hash: string): boolean {
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const fragment = hash.replace(/^#/, "");
  for (const component of components) {
    if (component["/"] !== undefined && !patternToRegExp(component["/"]).test(pathname)) continue;
    if (component["#"] !== undefined && !patternToRegExp(component["#"]).test(fragment)) continue;
    const items = component["?"];
    if (items && !Object.entries(items).every(([key, pattern]) => patternToRegExp(pattern).test(query.get(key) ?? ""))) continue;
    return !component.exclude;
  }
  return false;
}

const APP_HOSTS = new Set(["golfme.app", "www.golfme.app"]);

function hasAuthParams(search: string, hash: string): boolean {
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  return AUTH_QUERY_KEYS.some((key) => query.has(key) || fragment.has(key));
}

// Maps a Universal Link delivered to the native app via appUrlOpen (or the
// Smart App Banner's app-argument) onto the in-app route, keeping its query
// and hash (/find?tab=rounds). null = leave it alone: the
// com.golfme.ios:// auth callback (AuthContext's), other hosts, anything
// the AASA doesn't claim, and -- belt and braces -- any sign-in URL even if
// the list above were ever reordered. A claimed path with no matching
// screen (e.g. /courses/a/b) still routes, and the app's NotFound page
// offers the way Home.
export function routeForAppUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !APP_HOSTS.has(parsed.hostname)) return null;
  const { pathname, search, hash } = parsed;
  if (hasAuthParams(search, hash) || pathname === "/auth" || pathname.startsWith("/auth/")) return null;
  if (!isClaimedByComponents(APP_LINK_COMPONENTS, pathname, search, hash)) return null;
  const path = pathname.replace(/\/+$/, "") || "/";
  return path + search + hash;
}
