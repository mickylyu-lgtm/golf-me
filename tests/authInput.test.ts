// Run: npm run test:onboarding  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_ERROR_MESSAGE_KEY,
  EMAIL_DRAFT_KEY,
  SENT_TTL_MS,
  authErrorKind,
  clearEmailDraft,
  isPrivateRelayEmail,
  isValidEmail,
  loadEmailDraft,
  noteIntentionalSignOut,
  placeholderNameFromEmail,
  saveEmailDraft,
  sendCodeErrorKey,
  wasIntentionalSignOut,
} from "../src/lib/authInput.ts";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";

const LOCALES: Record<string, Record<string, string>> = { en, es, ja, ko, zhCN, zhTW };
const SIGN_IN_KEYS = [
  "auth.welcome.headline",
  "auth.welcome.subheadline",
  "auth.email.title",
  "auth.email.body",
  "auth.email.send",
  "auth.code.sentTo",
  "auth.code.didntGet",
  "auth.code.resendCode",
  "auth.code.resendCodeIn",
  "auth.code.verifying",
  "auth.code.sendFailed",
  "auth.code.changeEmail",
  "auth.code.linkExpiredCodeBody",
  "auth.accountConflict",
  "auth.appleFailed",
  "auth.sessionExpired",
  ...Object.values(AUTH_ERROR_MESSAGE_KEY),
];

test("sign-in strings: in all 6 languages, same placeholders as English", () => {
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  for (const key of SIGN_IN_KEYS) {
    for (const [name, table] of Object.entries(LOCALES)) {
      const value = table[key];
      assert.equal(typeof value, "string", `${name} ${key}`);
      assert.ok(value.trim().length > 0, `${name} ${key}`);
      assert.equal(placeholders(value), placeholders((en as Record<string, string>)[key]), `${name} ${key}`);
    }
  }
});

test("send errors: a server error means the email didn't go out", () => {
  assert.equal(sendCodeErrorKey("serverError"), "auth.code.sendFailed");
  assert.equal(sendCodeErrorKey("network"), "auth.networkError");
  assert.equal(sendCodeErrorKey("rateLimited"), "auth.code.rateLimited");
  assert.equal(AUTH_ERROR_MESSAGE_KEY.accountConflict, "auth.accountConflict");
});

test("Hide My Email relay addresses are recognised and never become a name", () => {
  assert.equal(isPrivateRelayEmail("abc123xyz@privaterelay.appleid.com"), true);
  assert.equal(isPrivateRelayEmail(" X@PrivateRelay.AppleID.com "), true);
  assert.equal(isPrivateRelayEmail("golfer@icloud.com"), false);
  assert.equal(isPrivateRelayEmail(null), false);
  assert.equal(placeholderNameFromEmail("abc123xyz@privaterelay.appleid.com"), "Golfer");
  assert.equal(placeholderNameFromEmail("micky@example.com"), "micky");
  assert.equal(placeholderNameFromEmail(undefined), "Golfer");
  assert.equal(placeholderNameFromEmail("@example.com"), "Golfer");
});

test("intentional sign-out is remembered briefly, so only a lapsed session shows a notice", () => {
  const t0 = 1_800_000_000_000;
  assert.equal(wasIntentionalSignOut(t0), false);
  noteIntentionalSignOut(t0);
  assert.equal(wasIntentionalSignOut(t0 + 1000), true);
  assert.equal(wasIntentionalSignOut(t0 + 31_000), false);
  assert.equal(wasIntentionalSignOut(t0 - 1), false);
});

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

test("email check: real addresses pass, typos that can't arrive don't", () => {
  for (const ok of ["a@b.co", "micky.l+golf@gmail.com", "  name@sub.example.org  ", "x@münchen.de"]) assert.equal(isValidEmail(ok), true, ok);
  for (const bad of ["", "a@", "@b.com", "a@b", "a@b.", "a@.com", "a@b.c", "a b@c.com", "a@@b.com", "name@gmail"]) assert.equal(isValidEmail(bad), false, bad);
});

test("errors map to translated kinds, never raw text", () => {
  assert.equal(authErrorKind(new TypeError("Load failed")), "network");
  assert.equal(authErrorKind(new TypeError("Failed to fetch")), "network");
  assert.equal(authErrorKind({ name: "AuthRetryableFetchError", status: 0, message: "{}" }), "network");
  assert.equal(authErrorKind({ status: 429, code: "over_email_send_rate_limit" }), "rateLimited");
  assert.equal(authErrorKind({ status: 400, code: "over_request_rate_limit" }), "rateLimited");
  assert.equal(authErrorKind({ status: 400, code: "email_address_invalid" }), "invalidEmail");
  assert.equal(authErrorKind({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" }), "invalidCredentials");
  assert.equal(authErrorKind({ status: 500, message: "Database error saving new user" }), "serverError");
  // supabase-js reports 5xx as AuthRetryableFetchError with the real status.
  assert.equal(authErrorKind({ name: "AuthRetryableFetchError", status: 500, message: "Error sending magic link email" }), "serverError");
  assert.equal(authErrorKind({ status: 422, code: "identity_already_exists" }), "accountConflict");
  assert.equal(authErrorKind({ status: 422, code: "email_exists" }), "accountConflict");
  assert.equal(authErrorKind({ status: 422, code: "email_provider_disabled" }), "generic");
  assert.equal(authErrorKind(null), "generic");
  assert.equal(authErrorKind("boom"), "generic");
});

test("draft: email and open box survive, sent screen only while fresh", () => {
  const s = memoryStore();
  const now = 1_800_000_000_000;
  assert.equal(loadEmailDraft(now, s), null);
  saveEmailDraft({ email: "golfer@example.com", open: true, sentAt: null, sentTo: null }, s);
  assert.deepEqual(loadEmailDraft(now, s), { email: "golfer@example.com", open: true, sentAt: null, sentTo: null });
  saveEmailDraft({ email: "golfer@example.com", open: true, sentAt: now, sentTo: "golfer@example.com" }, s);
  assert.equal(loadEmailDraft(now + 60_000, s)?.sentAt, now);
  const stale = loadEmailDraft(now + SENT_TTL_MS + 1, s);
  assert.equal(stale?.sentAt, null);
  assert.equal(stale?.sentTo, null);
  assert.equal(stale?.email, "golfer@example.com");
  assert.equal(loadEmailDraft(now - 1, s)?.sentAt, null); // clock went backwards
});

test("draft: a sent screen needs a valid email; junk and empty drafts are dropped", () => {
  const s = memoryStore();
  s.setItem(EMAIL_DRAFT_KEY, JSON.stringify({ email: "a@", open: false, sentAt: 5 }));
  assert.deepEqual(loadEmailDraft(10, s), { email: "a@", open: false, sentAt: null, sentTo: null });
  s.setItem(EMAIL_DRAFT_KEY, "{not json");
  assert.equal(loadEmailDraft(10, s), null);
  s.setItem(EMAIL_DRAFT_KEY, JSON.stringify({ email: 42 }));
  assert.equal(loadEmailDraft(10, s), null);
  saveEmailDraft({ email: "", open: false, sentAt: null, sentTo: null }, s);
  assert.equal(s.m.has(EMAIL_DRAFT_KEY), false);
  saveEmailDraft({ email: "x@y.co", open: true, sentAt: null, sentTo: null }, s);
  clearEmailDraft(s);
  assert.equal(s.m.has(EMAIL_DRAFT_KEY), false);
});

test("draft: blocked storage never throws", () => {
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.equal(loadEmailDraft(1, blocked), null);
  assert.doesNotThrow(() => saveEmailDraft({ email: "a@b.co", open: true, sentAt: 1, sentTo: "a@b.co" }, blocked));
  assert.doesNotThrow(() => clearEmailDraft(blocked));
  assert.equal(loadEmailDraft(1, null), null);
});
