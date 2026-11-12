import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listView } from "../src/lib/loadStatus.ts";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const page = read("src/pages/AutoMatch.tsx");
const scene = read("src/components/find/AutoMatchScene.tsx");
const css = read("src/components/find/AutoMatchScene.css");

test("Auto-Match has its own scene for both data waits and the lazy route", () => {
  assert.equal(page.match(/<AutoMatchLoader \/>/g)?.length, 2);
  assert.doesNotMatch(page, /GolfMeLoader/);
  assert.match(read("src/App.tsx"), /location.pathname === "\/auto-match" \? <AutoMatchLoader \/> : <GolfMeLoader/);
});

test("cached rounds and demo data never wait for the animation", () => {
  assert.equal(listView({ count: 1, isDemo: false, hasLoaded: false, loadError: false, isLoading: true }), "list");
  assert.equal(listView({ count: 0, isDemo: true, hasLoaded: false, loadError: false, isLoading: true }), "empty");
  assert.match(page, /roundsView === "loading" \? \(\s*<AutoMatchLoader/);
  assert.match(page, /\) : golfersPending \? \(\s*<AutoMatchLoader/);
  assert.doesNotMatch(scene + page, /setTimeout|setInterval|onAnimationEnd|requestAnimationFrame|animationComplete/);
});

test("error and missing-location states remain ahead of golfer loading", () => {
  const loading = page.indexOf(') : golfersPending ?');
  assert.ok(page.indexOf(') : roundsView === "error" ?') < loading);
  assert.ok(page.indexOf(') : plan.kind === "needsLocation" ?') < loading);
  assert.match(page, /<LoadErrorState onRetry=\{rounds.retry\}/);
});

test("decorative SVG is hidden while the real wait has a localized status", () => {
  assert.match(scene, /aria-hidden="true"/);
  assert.match(scene, /focusable="false"/);
  assert.match(scene, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(scene, /t\("autoMatch.searching"\)/);
  assert.doesNotMatch(scene, /progressbar|aria-valuenow|Math.random|fetch\(/);
  for (const locale of ["en", "zh-CN", "zh-TW", "es", "ko", "ja"]) {
    assert.match(read("src/i18n/locales/" + locale + ".ts"), /"autoMatch.searching": ".+"/, locale);
  }
});

test("the selected radar keeps the header static and loops only during a real wait", () => {
  assert.match(page, /<AutoMatchScene compact \/>/);
  assert.match(scene, /<AutoMatchScene searching \/>/);
  assert.match(css, /\.gm-automatch-searching \.gm-automatch-sweep\s*\{\s*animation: gm-automatch-radar 4s linear infinite;/);
  assert.match(css, /\.gm-automatch-searching \.gm-automatch-ball\s*\{\s*animation: gm-automatch-signal 4s ease-in-out infinite;/);
  assert.doesNotMatch(css, /\.gm-automatch-mark[^{]*\{/);
  assert.doesNotMatch(css + scene, /gm-automatch-gather|gm-automatch-arriv/);
});

test("coexisting radar scenes have unique gradients and retain static ball positions", () => {
  assert.match(scene, /const sweepId = useId\(\)/);
  assert.match(scene, /<linearGradient id=\{sweepId\}/);
  assert.match(scene, /transform=\{\x60translate\(/);
  assert.match(css, /transform-origin: 120px 100px/);
  assert.doesNotMatch(css, /\.gm-automatch-scene \*/);
});

test("reduced motion is static, including preference changes mid-animation", () => {
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]+animation: none !important;[\s\S]+transform: none;[\s\S]+opacity: 1;/);
});

test("matching motion uses only transform and opacity and cannot intercept input", () => {
  const keyframes = css.slice(css.indexOf("@keyframes"));
  assert.doesNotMatch(keyframes, /\b(width|height|top|left|filter|box-shadow):/);
  assert.match(css, /pointer-events: none/);
  assert.doesNotMatch(css, /animation-delay|visibility: hidden|display: none|position: fixed/);
});

test("results animate on entry without remounting cards or disabling their controls", () => {
  assert.equal(page.match(/gm-automatch-results flex flex-col gap-4/g)?.length, 2);
  assert.match(page, /<GolfCallCard call=\{current.call\} showSharedPreferences=\{false\} \/>/);
  assert.match(page, /setResultIndex\(\(i\) => \(i \+ 1\) % results.length\)/);
  assert.doesNotMatch(page, /key=\{current.call.id\}|disabled=\{.*animat/i);
});

test("the header preserves full-width subtitle copy and wraps long localized titles", () => {
  assert.match(page, /<h1 className="min-w-0[^"]+\[overflow-wrap:anywhere\]"/);
  const heading = page.indexOf('<h1 className="min-w-0');
  const subtitle = page.indexOf('when && plan.kind === "rounds" && plan.widened.date === null', heading);
  assert.ok(page.slice(heading, subtitle).includes("</h1>\n        </div>"), "subtitle is outside the icon/title flex row");
});
