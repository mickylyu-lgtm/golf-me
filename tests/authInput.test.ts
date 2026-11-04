// Run: npm run test:onboarding  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMAIL_DRAFT_KEY, SENT_TTL_MS, authErrorKind, clearEmailDraft, isValidEmail, loadEmailDraft, saveEmailDraft } from "../src/lib/authInput.ts";

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
  assert.equal(authErrorKind({ status: 500, message: "Database error saving new user" }), "generic");
  assert.equal(authErrorKind(null), "generic");
  assert.equal(authErrorKind("boom"), "generic");
});

test("draft: email and open box survive, sent screen only while fresh", () => {
  const s = memoryStore();
  const now = 1_800_000_000_000;
  assert.equal(loadEmailDraft(now, s), null);
  saveEmailDraft({ email: "golfer@example.com", open: true, sentAt: null }, s);
  assert.deepEqual(loadEmailDraft(now, s), { email: "golfer@example.com", open: true, sentAt: null });
  saveEmailDraft({ email: "golfer@example.com", open: true, sentAt: now }, s);
  assert.equal(loadEmailDraft(now + 60_000, s)?.sentAt, now);
  const stale = loadEmailDraft(now + SENT_TTL_MS + 1, s);
  assert.equal(stale?.sentAt, null);
  assert.equal(stale?.email, "golfer@example.com");
  assert.equal(loadEmailDraft(now - 1, s)?.sentAt, null); // clock went backwards
});

test("draft: a sent screen needs a valid email; junk and empty drafts are dropped", () => {
  const s = memoryStore();
  s.setItem(EMAIL_DRAFT_KEY, JSON.stringify({ email: "a@", open: false, sentAt: 5 }));
  assert.deepEqual(loadEmailDraft(10, s), { email: "a@", open: false, sentAt: null });
  s.setItem(EMAIL_DRAFT_KEY, "{not json");
  assert.equal(loadEmailDraft(10, s), null);
  s.setItem(EMAIL_DRAFT_KEY, JSON.stringify({ email: 42 }));
  assert.equal(loadEmailDraft(10, s), null);
  saveEmailDraft({ email: "", open: false, sentAt: null }, s);
  assert.equal(s.m.has(EMAIL_DRAFT_KEY), false);
  saveEmailDraft({ email: "x@y.co", open: true, sentAt: null }, s);
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
  assert.doesNotThrow(() => saveEmailDraft({ email: "a@b.co", open: true, sentAt: 1 }, blocked));
  assert.doesNotThrow(() => clearEmailDraft(blocked));
  assert.equal(loadEmailDraft(1, null), null);
});
