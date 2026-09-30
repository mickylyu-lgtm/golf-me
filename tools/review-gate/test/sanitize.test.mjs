import { test } from "node:test";
import assert from "node:assert/strict";
import { fitPayload, isExcludedPath, redact, sanitizeWork, SECRET_PATTERNS } from "../lib/sanitize.mjs";

// FAKE credentials, assembled at runtime so no secret-looking literal exists in source.
const FAKE = {
  openai: "sk-" + "proj-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4",
  supabaseSecret: "sb_" + "secret_" + "Zz9Yy8Xx7Ww6Vv5Uu4",
  serviceRole: "service_role" + "_key = '" + "e".repeat(40) + "'",
  jwt: "eyJ" + "hbGciOiJIUzI1NiJ9" + ".eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0" + "." + "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  telegram: "1234567890" + ":" + "AAH" + "x".repeat(32),
  aws: "AK" + "IA" + "ABCDEFGHIJKLMNOP",
  privateKey: "-----BEGIN " + "PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END " + "PRIVATE KEY-----",
  generic: 'api_key = "' + "q".repeat(24) + '"',
};
const LIMITS = { maxFileContentsFiles: 3, maxFileContentsChars: 40000 };

const section = (path, body) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${body}\n`;

for (const [name, value] of Object.entries(FAKE)) {
  test(`secret pattern removed and send blocked: ${name}`, () => {
    const r = sanitizeWork({ diff: section("src/config.ts", `const x = ${JSON.stringify(value)};`) }, LIMITS);
    assert.equal(r.blocked, true, JSON.stringify(r.blockReasons));
    assert.ok(!r.diff.includes(value.slice(4, 20)), "secret text must not survive");
    assert.match(r.diff, /‹REDACTED:/);
  });
}

// ---------- published contact address: redact, don't block (hash-listed only) ----------
{
  const { createHash } = await import("node:crypto");
  const PUBLISHED = "owner.contact" + "@" + "gmail.com"; // fake, assembled at runtime
  const OTHER = "someone.else" + "@" + "gmail.com";
  const HASH = createHash("sha256").update(PUBLISHED).digest("hex");
  const opts = { publishedContactEmailSha256: [HASH] };

  test("published contact: redacted with a placeholder, send not blocked", () => {
    const r = sanitizeWork({ diff: section("src/pages/PrivacyPolicy.tsx", `const CONTACT = "${PUBLISHED}"; // legal text stays`) }, LIMITS, opts);
    assert.equal(r.blocked, false, JSON.stringify(r.blockReasons));
    assert.ok(!r.diff.includes(PUBLISHED));
    assert.match(r.diff, /‹REDACTED:published-contact›/);
    assert.match(r.diff, /legal text stays/);
    assert.equal(r.publishedContactRedactions, 1);
  });
  test("published contact: case-insensitive match", () => {
    const r = sanitizeWork({ diff: section("a.ts", PUBLISHED.toUpperCase()) }, LIMITS, opts);
    assert.equal(r.blocked, false);
    assert.ok(!r.diff.toLowerCase().includes(PUBLISHED));
  });
  test("published contact: any OTHER email still blocks (general detection unchanged)", () => {
    const r = sanitizeWork({ diff: section("a.ts", `${PUBLISHED} and ${OTHER}`) }, LIMITS, opts);
    assert.equal(r.blocked, true);
    assert.ok(!r.diff.includes(OTHER));
    assert.ok(!r.diff.includes(PUBLISHED));
  });
  test("published contact: without the hash list the address blocks as before", () => {
    assert.equal(sanitizeWork({ diff: section("a.ts", PUBLISHED) }, LIMITS).blocked, true);
    assert.equal(sanitizeWork({ diff: section("a.ts", PUBLISHED) }, LIMITS, { publishedContactEmailSha256: ["not-a-hash", ""] }).blocked, true);
  });
  test("published contact: secrets and phone numbers next to it still block", () => {
    const r = sanitizeWork({ diff: section("a.ts", `${PUBLISHED} ${FAKE.openai} (415) 555-0134`) }, LIMITS, opts);
    assert.equal(r.blocked, true);
  });
}

test(".env and .env.local are excluded, .env.example is allowed", () => {
  assert.equal(isExcludedPath(".env"), true);
  assert.equal(isExcludedPath(".env.local"), true);
  assert.equal(isExcludedPath("apps/x/.env.production"), true);
  assert.equal(isExcludedPath(".env.example"), false);
  const r = sanitizeWork({ diff: section(".env.local", "VITE_X=1") + section("src/a.ts", "ok") }, LIMITS);
  assert.deepEqual(r.excluded, [".env.local"]);
  assert.ok(!r.diff.includes("VITE_X"));
});

test("Claude Telegram channel env/config never included", () => {
  assert.equal(isExcludedPath(".claude/channels/telegram/.env"), true);
  assert.equal(isExcludedPath(".claude/settings.local.json"), true);
  const r = sanitizeWork({ diff: section(".claude/channels/telegram/.env", "TELEGRAM_BOT_TOKEN=x") }, LIMITS);
  assert.equal(r.diff, "");
});

test("signing keys and key files excluded", () => {
  for (const p of ["ios/AuthKey_ABC123.p8", "certs/server.pem", "secrets/app.key", "x.p12"]) assert.equal(isExcludedPath(p), true, p);
});

test("media / video / image files are refused and block the send", () => {
  const diff = section("public/swing.mov", "binary") + section("src/a.ts", "ok") + "diff --git a/assets/p.jpg b/assets/p.jpg\nBinary files /dev/null and b/assets/p.jpg differ\n";
  const r = sanitizeWork({ diff }, LIMITS);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.media.sort(), ["assets/p.jpg", "public/swing.mov"]);
  assert.ok(!r.diff.includes("swing.mov"));
});

test("binary content detected even with a code-looking extension", () => {
  const r = sanitizeWork({ diff: "diff --git a/src/x.ts b/src/x.ts\nGIT binary patch\nliteral 12\n" }, LIMITS);
  assert.equal(r.blocked, true);
});

test("Storage listings (user-id/caddie-*.mov paths) are redacted and block", () => {
  const listing = "0b6e3a4c-1d2e-4f5a-8b9c-0d1e2f3a4b5c/caddie-973e0399-0189-4f12-962a-001e676d20b7.mov";
  const r = sanitizeWork({ diff: section("notes/objects.txt", listing) }, LIMITS);
  assert.equal(r.blocked, true);
  assert.ok(r.piiHits["storage-listing"] >= 1);
  assert.ok(!r.diff.includes("caddie-973e0399"));
});

test("private user content (emails, phone numbers) redacted and blocks", () => {
  const r = sanitizeWork({ diff: section("scratch/users.json", '{"name":"Jane Golfer","email":"jane.golfer@gmail.com","phone":"(415) 555-0134"}') }, LIMITS);
  assert.equal(r.blocked, true);
  assert.equal(r.piiHits.email, 1);
  assert.equal(r.piiHits.phone, 1);
  assert.ok(!r.diff.includes("jane.golfer@gmail.com"));
});

test("allowed placeholder emails (example.com / noreply) do not block", () => {
  const r = sanitizeWork({ diff: section("src/a.ts", "// contact dev@example.com or noreply@anthropic.com") }, LIMITS);
  assert.equal(r.blocked, false);
});

test("clean code passes untouched", () => {
  const r = sanitizeWork({ diff: section("src/a.ts", "export const total = items.reduce((s, i) => s + i.price, 0);") }, LIMITS);
  assert.equal(r.blocked, false);
  assert.match(r.diff, /items\.reduce/);
});

test("file_contents are sanitized and limited to 3 files / 40k chars", () => {
  const big = "x".repeat(30000);
  const r = sanitizeWork({ diff: "", fileContents: [1, 2, 3, 4].map((i) => ({ path: `src/f${i}.ts`, content: i === 1 ? big : "ok" })) }, LIMITS);
  assert.ok(r.file_contents.length <= 3);
  assert.ok(r.file_contents.reduce((s, c) => s + c.content.length, 0) <= 40000);
  const s = sanitizeWork({ diff: "", fileContents: [{ path: "src/k.ts", content: FAKE.openai }] }, LIMITS);
  assert.equal(s.blocked, true);
});

test("oversized payload is trimmed, then refused if still too big", () => {
  const req = { protocol: "golfme-review/1", diff: section("src/a.ts", "y".repeat(100000)), file_contents: [{ path: "a", content: "z".repeat(10000), reason: "r" }] };
  const fitted = fitPayload(req, 60000);
  assert.equal(fitted.fitted, true);
  assert.equal(fitted.trimmed, true);
  assert.equal(fitted.request.file_contents.length, 0);
  assert.ok(JSON.stringify(fitted.request).length <= 60000);
  const hopeless = fitPayload({ ...req, objective: "o".repeat(70000) }, 60000);
  assert.equal(hopeless.fitted, false);
});

test("redact reports counts per type", () => {
  const { hits } = redact(`${FAKE.openai} ${FAKE.openai} ${FAKE.aws}`, SECRET_PATTERNS);
  assert.equal(hits["openai-key"], 2);
  assert.equal(hits["aws-access-key"], 1);
});
