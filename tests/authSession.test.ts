// Run: npm run test:onboarding  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { RESTORE_RETRY_MS, hasStoredSession } from "../src/lib/authSession.ts";

function store(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => entries[k] ?? null };
}

test("a stored Supabase session with a refresh token counts, whatever the project ref", () => {
  assert.equal(hasStoredSession(store({ "sb-abcdefgh-auth-token": JSON.stringify({ access_token: "x", refresh_token: "r1", expires_at: 1 }) })), true);
  assert.equal(hasStoredSession(store({ other: "1", "sb-127-auth-token": JSON.stringify({ refresh_token: "r" }) })), true);
});

test("no session: nothing stored, other keys, the PKCE verifier, an empty or missing refresh token, junk", () => {
  assert.equal(hasStoredSession(store({})), false);
  assert.equal(hasStoredSession(store({ "golfme:isDemo": "1" })), false);
  assert.equal(hasStoredSession(store({ "sb-abc-auth-token-code-verifier": JSON.stringify({ refresh_token: "r" }) })), false);
  assert.equal(hasStoredSession(store({ "sb-abc-auth-token": JSON.stringify({ refresh_token: "" }) })), false);
  assert.equal(hasStoredSession(store({ "sb-abc-auth-token": JSON.stringify({ access_token: "x" }) })), false);
  assert.equal(hasStoredSession(store({ "sb-abc-auth-token": "null" })), false);
  assert.equal(hasStoredSession(store({ "sb-abc-auth-token": "{not json" })), false);
  assert.equal(hasStoredSession(null), false);
});

test("blocked storage never throws", () => {
  const blocked = {
    get length(): number {
      throw new Error("SecurityError");
    },
    key: () => null,
    getItem: () => null,
  };
  assert.equal(hasStoredSession(blocked), false);
});

test("retry interval stays well under auth-js's 60 s failure cooldown", () => {
  assert.ok(RESTORE_RETRY_MS > 0 && RESTORE_RETRY_MS <= 30_000);
});
