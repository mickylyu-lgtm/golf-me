// Run: npm run test:caddie  (node --test, built-in type stripping)
// Caddie renders entirely in the Caddie feedback language (Micky,
// 2026-11-05: "the language switcher should switch all languages within
// Caddie", "all parts within Caddie should be fully translated"):
// - a LocaleScope changes `t`/`locale` for its subtree only;
// - no Caddie screen carries hard-coded English (source scan below);
// - server error sentences reach the golfer translated;
// - the Translate button hides when the feedback is already in the language.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTranslator, scopeLocaleValue } from "../src/i18n/translate.ts";
import { en } from "../src/i18n/locales/en.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { translateOffer } from "../src/lib/caddieLanguage.ts";
import { caddieErrorText } from "../src/lib/caddieErrorText.ts";
import { demoLegacyFeedback, buildDemoCaddieAnalyses } from "../src/data/caddie.ts";

type Key = keyof typeof en;
const LOCALES: Record<string, Record<string, string>> = { en, "zh-CN": zhCN, "zh-TW": zhTW, es, ko, ja };

// ── Locale scope ────────────────────────────────────────────────────────

test("a scope overrides t and locale for its subtree, keeping the parent's setLocale", () => {
  const calls: string[] = [];
  const parent = { locale: "en", t: makeTranslator<Key>(en, en), setLocale: (l: string) => calls.push(l) };
  const before = { ...parent };
  const scoped = scopeLocaleValue(parent, "zh-CN", makeTranslator<Key>(zhCN, en));

  assert.equal(scoped.locale, "zh-CN");
  assert.equal(scoped.t("caddie.workOnNext"), zhCN["caddie.workOnNext"]);
  assert.notEqual(scoped.t("caddie.workOnNext"), en["caddie.workOnNext"]);
  // The global (parent) value is untouched.
  assert.deepEqual(parent, before);
  assert.equal(parent.locale, "en");
  assert.equal(parent.t("caddie.workOnNext"), "Work on this next");
  // setLocale inside the scope is still the app's own switch.
  assert.equal(scoped.setLocale, parent.setLocale);
  scoped.setLocale("ja");
  assert.deepEqual(calls, ["ja"]);
});

test("the scoped translator fills variables and falls back to English per key", () => {
  const t = makeTranslator<Key>({ "caddie.scoreOutOf100": "{score} 分" } as Partial<Record<Key, string>>, en);
  assert.equal(t("caddie.scoreOutOf100", { score: 72 }), "72 分");
  assert.equal(t("caddie.workOn"), en["caddie.workOn"]);
  assert.equal(makeTranslator<Key>(undefined, en)("caddie.drill"), "Drill");
});

test("LocaleScope never writes the app locale or its storage key", () => {
  const src = fs.readFileSync("src/i18n/LocaleContext.tsx", "utf8");
  const scope = src.slice(src.indexOf("export function LocaleScope"), src.indexOf("export function useLocale"));
  assert.ok(scope.length > 0);
  assert.doesNotMatch(scope, /localStorage|LOCALE_STORAGE_KEY|setLocaleState/);
  // Always one provider, so loading the dictionary never remounts Caddie.
  assert.equal((scope.match(/<LocaleContext\.Provider/g) ?? []).length, 1);
  assert.doesNotMatch(scope, /return\s+(null|<>)/);
});

test("every Caddie route and the Caddie tab panel are inside CaddieLocaleScope", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  for (const page of ["Caddie", "AnalyzeSwing", "CaddieAnalysisDetail"]) {
    assert.match(app, new RegExp(`element=\\{<CaddieLocaleScope><${page} /></CaddieLocaleScope>\\}`), page);
  }
  assert.doesNotMatch(app, /element=\{<(Caddie|AnalyzeSwing|CaddieAnalysisDetail) \/>\}/);
  const carousel = fs.readFileSync("src/components/layout/RootTabCarousel.tsx", "utf8");
  assert.match(carousel, /<CaddieLocaleScope><Caddie \/><\/CaddieLocaleScope>/);
});

// ── New keys exist in all 6 locales ─────────────────────────────────────

const NEW_KEYS: Key[] = [
  "caddie.shareCaption",
  "caddie.error.unavailable",
  "caddie.error.signedOut",
  "caddie.error.postNotFound",
  "caddie.error.ownPostsOnly",
  "caddie.error.videoUnusable",
  "caddie.error.tooSoon",
  "caddie.error.dailyLimit",
  "caddie.error.analysisNotFound",
  "caddie.error.translateNotReady",
  "caddie.error.translateTooSoon",
  "caddie.error.translateFailed",
  "caddie.error.shareFailed",
  "caddie.demo.one.summary",
  "caddie.demo.one.strength1",
  "caddie.demo.one.strength2",
  "caddie.demo.one.issue1",
  "caddie.demo.one.issue2",
  "caddie.demo.one.rec1",
  "caddie.demo.one.rec2",
  "caddie.demo.two.summary",
  "caddie.demo.two.strength1",
  "caddie.demo.two.strength2",
  "caddie.demo.two.issue1",
  "caddie.demo.two.rec1",
  "caddie.demo.two.rec2",
];

test("the new Caddie keys are translated in all 6 locales, with the same placeholders", () => {
  for (const key of NEW_KEYS) {
    const placeholders = (en[key].match(/\{\w+\}/g) ?? []).sort();
    for (const [name, dict] of Object.entries(LOCALES)) {
      const value = dict[key];
      assert.ok(typeof value === "string" && value.trim().length > 0, `${name} ${key}`);
      assert.deepEqual((value.match(/\{\w+\}/g) ?? []).sort(), placeholders, `${name} ${key} placeholders`);
      if (name !== "en" && name !== "es") assert.notEqual(value, en[key], `${name} ${key} is untranslated`);
    }
    assert.notEqual(es[key], en[key], `es ${key} is untranslated`);
  }
});

// Every key a Caddie screen reads, in every locale, is not the English
// string (beyond a few that are legitimately the same word or a number).
const SAME_AS_ENGLISH_OK = new Set(["caddie.title", "caddie.scoreOutOf100", "coachReplay.title"]);
// Spanish golf vocabulary that is spelled like the English (standard in
// Spanish-language golf coaching), and "Original", which is Spanish too.
const SAME_IN_SPANISH = new Set(["caddie.scoreBackswing", "club.driver", "club.category.driver", "club.category.wedge", "swingAnalysis.backswing", "swingAnalysis.downswing", "caddie.replayOriginal"]);
test("every key the Caddie screens use is translated in the 5 other locales", () => {
  const keys = new Set<string>();
  for (const file of caddieFiles()) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(/"((?:caddie|coachReplay|swingAssessment|club|swingAnalysis|common|composer)\.[A-Za-z0-9_.]+)"/g)) {
      if (m[1] in en) keys.add(m[1]);
    }
  }
  assert.ok(keys.size > 100, `found ${keys.size} keys`);
  const untranslated: string[] = [];
  for (const key of keys) {
    if (SAME_AS_ENGLISH_OK.has(key)) continue;
    const english = en[key as Key];
    if (!/[A-Za-z]{3,}/.test(english)) continue;
    for (const [name, dict] of Object.entries(LOCALES)) {
      if (name === "en" || (name === "es" && SAME_IN_SPANISH.has(key))) continue;
      if (dict[key] === english) untranslated.push(`${name} ${key}`);
    }
  }
  assert.deepEqual(untranslated, []);
});

// ── No hard-coded English on Caddie screens ─────────────────────────────

// Every file that renders a Caddie screen, plus the libraries whose output
// they render as text.
function caddieFiles(): string[] {
  const dir = "src/components/caddie";
  return [
    "src/pages/Caddie.tsx",
    "src/pages/AnalyzeSwing.tsx",
    "src/pages/CaddieAnalysisDetail.tsx",
    "src/components/icons/CaddieNavIcon.tsx",
    "src/data/caddieCoachDemo.ts",
    "src/lib/coachReplay.ts",
    "src/lib/coachPaging.ts",
    "src/lib/clubLabel.ts",
    "src/lib/caddieFailure.ts",
    "supabase/functions/_shared/swingAssessment.ts",
    ...fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => path.join(dir, f)),
  ];
}

// Comments out; string contents kept (so "https://x" survives).
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

// Proper nouns allowed anywhere.
const PROPER = /\b(GolfMe|Caddie)\b/g;
// Never words a golfer reads as English:
// - "AI": the lettering on the Caddie cap logo (CaddieNavIcon, loading scenes), a mark like "GolfMe";
// - "Aa": CoachReplayCard's invisible, aria-hidden measuring placeholders (sized, never shown).
const ALLOWED_TEXT = new Set(["AI", "Aa"]);
// Stored values, not display text: AnalyzeSwing's club options are saved
// in English and always shown through clubLabel().
const ALLOWED_LITERALS = new Set(["src/pages/AnalyzeSwing.tsx:Pitching Wedge"]);
const WORDY = /[A-Za-z]{2,}/;

function findings(file: string): string[] {
  const src = stripComments(fs.readFileSync(file, "utf8"));
  const out: string[] = [];
  const lineOf = (i: number) => src.slice(0, i).split("\n").length;
  const isTsx = file.endsWith(".tsx");
  if (isTsx) {
    // JSX text: between a tag's ">" and the next "<"/"{", with letters.
    const jsxish = src.replace(/=>|>=|<=|->/g, "  ");
    for (const m of jsxish.matchAll(/<\/?[A-Za-z][\w.]*(?:\s[^<>]*?)?\/?>([^<>{}]+)(?=[<{])/g)) {
      const text = m[1].replace(PROPER, "").trim();
      // (" : x ?" is a ternary between two elements, not text.)
      if (text && WORDY.test(text) && !/[;()=?]|^[:&|]/.test(text) && !ALLOWED_TEXT.has(text)) out.push(`${file}:${lineOf(m.index!)} JSX text "${m[1].trim()}"`);
    }
    // User-facing attributes written as plain strings.
    for (const m of src.matchAll(/\b(aria-label|aria-description|title|alt|placeholder|label)=(["'])([^"']*)\2/g)) {
      if (WORDY.test(m[3].replace(PROPER, "")) && !ALLOWED_TEXT.has(m[3])) out.push(`${file}:${lineOf(m.index!)} ${m[1]}="${m[3]}"`);
    }
    // Attributes/children from a template or string expression with English.
    for (const m of src.matchAll(/\b(aria-label|title|alt|placeholder|label|text|body)=\{\s*(["'`])([^"'`]*)\2\s*\}/g)) {
      if (WORDY.test(m[3].replace(/\$\{[^}]*\}/g, "").replace(PROPER, ""))) out.push(`${file}:${lineOf(m.index!)} ${m[1]}={"${m[3]}"}`);
    }
  }
  // Toasts: always a translation, never raw text or a server/JS error message.
  for (const m of src.matchAll(/showToast\(([^,\n]+)/g)) {
    const arg = m[1].trim();
    if (/^["'`]/.test(arg) || /\.message\b/.test(arg)) out.push(`${file}:${lineOf(m.index!)} showToast(${arg})`);
  }
  // An error's own message rendered or toasted anywhere.
  for (const m of src.matchAll(/\berr(?:or)?\.message\b/g)) {
    const line = src.split("\n")[lineOf(m.index!) - 1];
    if (!/console\.|throw |new Error|message = /.test(line)) out.push(`${file}:${lineOf(m.index!)} ${line.trim()}`);
  }
  // String literals that read as English sentences or labels ("Top of
  // backswing", "Hold still."), outside imports, keys, classNames and
  // console/throw diagnostics.
  for (const [i, line] of src.split("\n").entries()) {
    if (/^\s*(import|export \* from)|console\.|throw |new Error|className=|class:|data-testid|devLog/.test(line)) continue;
    for (const m of line.matchAll(/(["'`])((?:(?!\1).)*)\1/g)) {
      const s = m[2];
      if (/^[a-z][\w-]*(\.[\w-]+)+$/.test(s)) continue; // i18n key / dotted id
      if (!/[A-Z][a-z]+[ ,.!?']+[A-Za-z]|[a-z]{2,} [a-z]{2,} [a-z]{2,}/.test(s)) continue;
      if (/^\/|^\$\{[^}]+\}\//.test(s)) continue; // a route or storage path
      const tokens = s.split(/\s+/).filter(Boolean);
      if (tokens.filter((tok) => /[-[:/]/.test(tok)).length * 2 > tokens.length && /\b(flex|text|rounded|bg|px|py|p|mt|mb|gap|w|h|ring|shadow|border|items|justify|font|shrink|absolute|relative|inset|z)-/.test(s)) continue; // class list
      if (ALLOWED_LITERALS.has(`${file}:${s}`)) continue;
      const cleaned = s.replace(PROPER, "").replace(/\$\{[^}]*\}/g, "");
      if (WORDY.test(cleaned)) out.push(`${file}:${i + 1} "${s}"`);
    }
  }
  return out;
}

test("no Caddie screen hard-codes English text", () => {
  const all = caddieFiles().flatMap(findings);
  assert.deepEqual(all, []);
});

test("the scan itself catches hard-coded English", () => {
  const tmp = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "caddie-scan-")), "Probe.tsx");
  fs.writeFileSync(
    tmp,
    [
      "export function Probe({ err }) {",
      '  showToast("Saved!");',
      "  showToast(err.message);",
      '  return <div aria-label="Close panel"><p>Score Breakdown</p><span title={"Coach mode"} />{t("caddie.drill")}</div>;',
      "}",
      'const LABEL = "Top of backswing";',
    ].join("\n"),
  );
  const hits = findings(tmp).join("\n");
  for (const needle of ['showToast("Saved!")', "showToast(err.message)", 'aria-label="Close panel"', '"Score Breakdown"', "Coach mode", '"Top of backswing"']) {
    assert.ok(hits.includes(needle), `missed ${needle}\n${hits}`);
  }
  assert.doesNotMatch(hits, /caddie\.drill/);
});

// ── Server error sentences, translated ──────────────────────────────────

const tZh = makeTranslator<Key>(zhCN, en);

test("known server errors map to the screen's language; unknown ones never show raw English", () => {
  assert.equal(caddieErrorText(new Error("Please wait a moment before asking Caddie again."), tZh), zhCN["caddie.error.tooSoon"]);
  assert.equal(
    caddieErrorText(new Error("You've reached today's Caddie analysis limit (10). Try again tomorrow."), tZh),
    zhCN["caddie.error.dailyLimit"].replace("{limit}", "10"),
  );
  assert.equal(caddieErrorText(new Error("Caddie couldn't translate this analysis. Please try again."), tZh), zhCN["caddie.error.translateFailed"]);
  // A coded refusal is read by its code, whatever language its message is in.
  assert.equal(caddieErrorText(Object.assign(new Error("Caddie is busy, try again in a minute."), { code: "provider_busy" }), tZh), zhCN["caddie.failure.providerBusy.body"]);
  // Network / unknown / storage errors.
  assert.equal(caddieErrorText(new Error("Failed to send a request to the Edge Function"), tZh), zhCN["caddie.askCaddieError"]);
  assert.equal(caddieErrorText(new Error("Failed to fetch"), tZh, "caddie.error.shareFailed"), zhCN["caddie.error.shareFailed"]);
  assert.equal(caddieErrorText(Object.assign(new Error("The object exceeded the maximum allowed size"), { name: "StorageApiError" }), tZh), zhCN["caddie.failure.upload.body"]);
  assert.equal(caddieErrorText("boom", tZh), zhCN["caddie.askCaddieError"]);
  // A Postgres error code isn't a Caddie failure code.
  assert.equal(caddieErrorText(Object.assign(new Error("duplicate key"), { code: "23505" }), tZh), zhCN["caddie.askCaddieError"]);
});

test("every server error sentence the Caddie functions send is mapped", () => {
  const sources = ["supabase/functions/analyze-swing/index.ts", "supabase/functions/translate-caddie-analysis/index.ts"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const generic = new Set([
    "Method not allowed",
    "Invalid request body.",
    "Invalid sourceType.",
    "sourcePostId is required for a community_post analysis.",
    "analysisId is required.",
    "A supported locale is required.",
  ]);
  for (const m of sources.matchAll(/jsonResponse\(\{\s*error:\s*"([^"]+)"/g)) {
    if (generic.has(m[1])) {
      assert.equal(caddieErrorText(new Error(m[1]), tZh), zhCN["caddie.askCaddieError"], m[1]);
      continue;
    }
    assert.notEqual(caddieErrorText(new Error(m[1]), tZh), zhCN["caddie.askCaddieError"], `unmapped server error: ${m[1]}`);
  }
});

// ── Translate button ────────────────────────────────────────────────────

test("Translate hides when the feedback is already in the Caddie language", () => {
  assert.equal(translateOffer("zh-CN", "zh-CN"), "none");
  assert.equal(translateOffer("en", "en"), "none");
  assert.equal(translateOffer("en", "zh-CN"), "notice");
  assert.equal(translateOffer("zh-TW", "zh-CN"), "notice");
  // An older row with no recorded language keeps the plain button.
  assert.equal(translateOffer(undefined, "zh-CN"), "button");
});

test("the detail page renders Translate only when translateOffer allows it", () => {
  const src = fs.readFileSync("src/pages/CaddieAnalysisDetail.tsx", "utf8");
  assert.match(src, /const offer = translateOffer\(details\?\.language, locale\);/);
  assert.match(src, /const translateButton = offer !== "none" && \(/);
});

// ── Demo rows read in the screen's language ─────────────────────────────

test("the demo's fixture feedback is translated; other rows show what's stored", () => {
  const [one, two] = buildDemoCaddieAnalyses();
  const english = demoLegacyFeedback(one, makeTranslator<Key>(en, en));
  assert.equal(english.analysisSummary, one.analysisSummary);
  assert.deepEqual(english.strengths, one.strengths);
  assert.deepEqual(english.issues, one.issues);
  assert.deepEqual(english.recommendations, one.recommendations);
  const englishTwo = demoLegacyFeedback(two, makeTranslator<Key>(en, en));
  assert.deepEqual([englishTwo.analysisSummary, englishTwo.strengths, englishTwo.issues, englishTwo.recommendations], [two.analysisSummary, two.strengths, two.issues, two.recommendations]);
  const zh = demoLegacyFeedback(one, tZh);
  assert.equal(zh.analysisSummary, zhCN["caddie.demo.one.summary"]);
  const real = { id: "abc", analysisSummary: "Stored text", strengths: ["a"], issues: [], recommendations: [] };
  assert.deepEqual(demoLegacyFeedback(real, tZh), real);
});
