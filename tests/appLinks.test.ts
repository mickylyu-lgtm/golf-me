// Run: node --test tests/appLinks.test.ts  (also part of npm run test)
// Universal Links: the served AASA file, its order, and the app's router.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_LINK_COMPONENTS, isClaimedByComponents, routeForAppUrl } from "../src/lib/appLinks.ts";
import type { AppLinkComponent } from "../src/lib/appLinks.ts";

const root = new URL("../", import.meta.url);
const aasa = JSON.parse(readFileSync(new URL("public/.well-known/apple-app-site-association", root), "utf8"));
const appTsx = readFileSync(new URL("src/App.tsx", root), "utf8");

const ROUND = "/golf-calls/3f1c2a9e-8b7d-4c6e-9a51-0d2e4f6a8b10";
const UUID = "6b0a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";

function served(): AppLinkComponent[] {
  const detail = aasa.applinks.details[0];
  return detail.components.map((c: Record<string, unknown>) => {
    const { comment, ...rest } = c;
    void comment;
    return rest as AppLinkComponent;
  });
}

function claimedByAasa(url: string): boolean {
  const u = new URL(url);
  return isClaimedByComponents(served(), u.pathname, u.search, u.hash);
}

test("AASA shape: one app, components only, valid keys", () => {
  assert.deepEqual(Object.keys(aasa), ["applinks"]);
  assert.equal(aasa.applinks.details.length, 1);
  const detail = aasa.applinks.details[0];
  assert.deepEqual(detail.appIDs, ["P9M943ULP9.com.golfme.ios"]);
  assert.equal(detail.paths, undefined, "legacy paths key would be read instead of components on old iOS");
  for (const c of detail.components) {
    for (const key of Object.keys(c)) assert.ok(["/", "?", "#", "exclude", "comment"].includes(key), `unknown key ${key}`);
    if ("exclude" in c) assert.equal(c.exclude, true);
    if ("/" in c) assert.ok(c["/"] === "*" || c["/"].startsWith("/") || c["/"].startsWith("*."), c["/"]);
    if ("?" in c) for (const v of Object.values(c["?"])) assert.equal(v, "?*", "a query exclusion must not match an absent item");
  }
});

test("AASA components are exactly the router's list (same order)", () => {
  assert.deepEqual(served(), APP_LINK_COMPONENTS);
});

test("every exclusion comes before every include (first match wins on iOS)", () => {
  const comps = served();
  const firstInclude = comps.findIndex((c) => !c.exclude);
  const lastExclude = comps.map((c) => Boolean(c.exclude)).lastIndexOf(true);
  assert.ok(firstInclude > 0 && lastExclude < firstInclude, `exclude at ${lastExclude} after include at ${firstInclude}`);
  // The auth-parameter exclusions are the very first entries.
  assert.equal(comps[0]["?"]?.code, "?*");
});

const APP = "https://golfme.app";

// Claimed -> routed in-app (query and hash kept, trailing slash dropped).
const ROUTED: [string, string][] = [
  ["/", "/"],
  ["", "/"],
  ["/?ref=notes", "/?ref=notes"],
  ["/discover", "/discover"],
  ["/find?tab=rounds", "/find?tab=rounds"],
  [ROUND + "/", ROUND],
  ["/auto-match", "/auto-match"],
  ["/golf-calls", "/golf-calls"],
  [ROUND, ROUND],
  [ROUND + "#chat", ROUND + "#chat"],
  ["/my-rounds", "/my-rounds"],
  ["/profile", "/profile"],
  ["/profile/reputation", "/profile/reputation"],
  ["/profile/following/find", "/profile/following/find"],
  ["/settings/language", "/settings/language"],
  ["/help", "/help"],
  ["/about", "/about"],
  [`/golfer/${UUID}`, `/golfer/${UUID}`],
  ["/messages", "/messages"],
  [`/messages/${UUID}`, `/messages/${UUID}`],
  [`/messages/round/${UUID}`, `/messages/round/${UUID}`],
  ["/community", "/community"],
  [`/community/${UUID}?comment=1`, `/community/${UUID}?comment=1`],
  ["/community/new", "/community/new"],
  ["/saved-posts", "/saved-posts"],
  ["/coach-reviews", "/coach-reviews"],
  ["/tee-times", "/tee-times"],
  ["/courses/nearby", "/courses/nearby"],
  ["/courses/map", "/courses/map"],
  ["/courses/geo%3A123", "/courses/geo%3A123"],
  ["/caddie", "/caddie"],
  ["/caddie/analyze", "/caddie/analyze"],
  [`/caddie/${UUID}`, `/caddie/${UUID}`],
];

// Never claimed: stays in Safari, and the router ignores it too.
const NOT_CLAIMED = [
  // Sign-in results on any path (web Google/Apple, Site URL fallback, email links)
  "/#access_token=a&refresh_token=b&type=bearer",
  "/#error=access_denied&error_code=otp_expired&error_description=x",
  "/?code=abc",
  "/?token_hash=pkce_abc&type=email",
  "/?error=server_error&error_description=x",
  `${ROUND}?code=abc`,
  "/messages#access_token=x",
  "/auth/confirm?token_hash=abc&type=email",
  "/auth/app?token_hash=abc&type=email",
  "/auth/app",
  // Sign-in pages, App Store reviewer path, token links
  "/login",
  "/login?review=1",
  "/signup",
  "/welcome",
  "/splash",
  "/onboarding",
  "/profile-setup",
  "/ready",
  "/coach-invite/abc123",
  // Legal / support
  "/privacy",
  "/terms",
  "/support",
  // Server, well-known, static, dev, admin
  "/api/chat-video",
  "/.well-known/apple-app-site-association",
  "/assets/index-abc.js",
  "/icons/icon-192.png",
  "/manifest.json",
  "/robots.txt",
  "/sitemap.xml",
  "/og.png",
  "/courses/skyway-aerial.jpg",
  "/splash/launch.png",
  "/admin/dashboard",
  "/__dev/first-round",
  // Hosting form (unchanged rule), unknown top-level paths, look-alikes
  "/golf-calls/new",
  "/nope",
  "/caddiex",
  "/findx",
  "/profiles",
];

test("claimed paths: iOS opens the app and the router lands on the same screen", () => {
  for (const [path, route] of ROUTED) {
    assert.equal(claimedByAasa(APP + path), true, `AASA should claim ${path}`);
    assert.equal(routeForAppUrl(APP + path), route, path);
    assert.equal(routeForAppUrl("https://www.golfme.app" + path), route, `www ${path}`);
  }
});

test("excluded / unclaimed paths: Safari keeps them and the router ignores them", () => {
  for (const path of NOT_CLAIMED) {
    assert.equal(claimedByAasa(APP + path), false, `AASA must not claim ${path}`);
    assert.equal(routeForAppUrl(APP + path), null, path);
  }
});

test("router rejects other schemes, hosts and garbage", () => {
  for (const url of [
    "com.golfme.ios://auth-callback#access_token=x",
    "com.golfme.ios://auth-callback?token_hash=x",
    "http://golfme.app/messages",
    "https://evil.com/messages",
    "https://golfme.app.evil.com/",
    "not a url",
  ]) {
    assert.equal(routeForAppUrl(url), null, url);
  }
});

// Turns App.tsx's <Route path="..."> list into matchers (":param" = one
// segment) so every claimed sample is proven to have a real screen, not
// the NotFound catch-all.
const routePaths = [...appTsx.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "*");
const routePatterns = routePaths.map((p) => new RegExp("^" + p.replace(/:[A-Za-z]+/g, "[^/]+") + "$"));

test("every routed sample has a screen in App.tsx", () => {
  assert.ok(routePatterns.length > 30);
  for (const [, route] of ROUTED) {
    const pathname = route.split(/[?#]/)[0];
    assert.ok(
      routePatterns.some((re) => re.test(pathname)),
      `no <Route> for ${pathname}`,
    );
  }
});

test("every include pattern has at least one screen behind it", () => {
  for (const c of served().filter((c) => !c.exclude)) {
    const pattern = c["/"]!;
    const prefix = pattern.replace(/\/\*$/, "");
    const covered = pattern.endsWith("/*")
      ? routePaths.some((p) => p.startsWith(prefix + "/"))
      : routePatterns.some((re) => re.test(pattern));
    assert.ok(covered, `include ${pattern} has no route`);
  }
});
