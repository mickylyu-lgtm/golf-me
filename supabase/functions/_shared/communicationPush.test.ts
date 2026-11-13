// Run: npm run test  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avatarGradient,
  buildApnsPayload,
  communicationSender,
  DEFAULT_GRADIENT,
  isUuid,
  monogramInitials,
  threadIdFor,
  trustedAvatarUrl,
} from "./communicationPush.ts";

const SB = "https://abcdefghijklmnop.supabase.co";
const S = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const own = `${SB}/storage/v1/object/public/avatars/${S}/avatar.jpg?t=1731456000000`;

test("system pushes keep the exact old payload", () => {
  const before = JSON.stringify({ aps: { alert: { title: "Round updated", body: "New tee time" }, sound: "default" }, link_to: "/golf-calls/x" });
  assert.equal(JSON.stringify(buildApnsPayload({ title: "Round updated", body: "New tee time", linkTo: "/golf-calls/x" })), before);
  assert.equal(JSON.stringify(buildApnsPayload({ title: "t", body: "b", linkTo: "/x", sender: null })), JSON.stringify({ aps: { alert: { title: "t", body: "b" }, sound: "default" }, link_to: "/x" }));
  // Missing title / link behave as before (title dropped, link null).
  assert.equal(JSON.stringify(buildApnsPayload({ title: undefined, body: "b", linkTo: undefined })), '{"aps":{"alert":{"body":"b"},"sound":"default"},"link_to":null}');
});

test("person pushes add mutable-content, thread-id and the sender", () => {
  const sender = communicationSender(S, { name: "Daniel Paulson", photo_url: own, avatar_initials: "DP", avatar_color: "from-sky-400 to-blue-600" }, SB);
  const p = buildApnsPayload({ title: "Daniel Paulson", body: "Hi", linkTo: `/messages/${S}`, sender });
  assert.deepEqual(p, {
    aps: { alert: { title: "Daniel Paulson", body: "Hi" }, sound: "default", "mutable-content": 1, "thread-id": `dm-${S}` },
    link_to: `/messages/${S}`,
    sender: { id: S, avatar_url: own, initials: "DP", colors: ["#38bdf8", "#2563eb"] },
  });
  // No name, email, language or anything else from the profile.
  assert.deepEqual(Object.keys(p.sender as object).sort(), ["avatar_url", "colors", "id", "initials"]);
});

test("no photo: no avatar_url, monogram data only", () => {
  const sender = communicationSender(S, { name: "Ann Lee", photo_url: null, avatar_initials: null, avatar_color: null }, SB);
  assert.deepEqual(sender, { id: S, initials: "AL", colors: DEFAULT_GRADIENT });
});

test("avatar URL must be the sender's own object in this project's public avatars bucket", () => {
  assert.equal(trustedAvatarUrl(own, SB, S), own);
  assert.equal(trustedAvatarUrl(own, SB, S.toUpperCase()), own);
  assert.equal(trustedAvatarUrl(`${SB}/storage/v1/object/public/avatars/${OTHER}/avatar.jpg`, SB, S), null);
  assert.equal(trustedAvatarUrl(own.replace("https:", "http:"), SB, S), null);
  assert.equal(trustedAvatarUrl(own.replace("abcdefghijklmnop", "evil"), SB, S), null);
  assert.equal(trustedAvatarUrl(`https://lh3.googleusercontent.com/a/xyz`, SB, S), null);
  assert.equal(trustedAvatarUrl(`${SB}/storage/v1/object/public/avatars/${S}/`, SB, S), null);
  assert.equal(trustedAvatarUrl(`${SB}/storage/v1/object/sign/avatars/${S}/avatar.jpg`, SB, S), null);
  assert.equal(trustedAvatarUrl(`${SB}/storage/v1/object/public/chat-images/${S}/a.jpg`, SB, S), null);
  assert.equal(trustedAvatarUrl(`https://user:pw@abcdefghijklmnop.supabase.co/storage/v1/object/public/avatars/${S}/a.jpg`, SB, S), null);
  assert.equal(trustedAvatarUrl("data:image/png;base64,AAAA", SB, S), null);
  assert.equal(trustedAvatarUrl("not a url", SB, S), null);
  assert.equal(trustedAvatarUrl(own, SB, "not-a-uuid"), null);
  assert.equal(trustedAvatarUrl(null, SB, S), null);
  assert.equal(trustedAvatarUrl(own + "x".repeat(600), SB, S), null);
});

test("thread ids", () => {
  assert.equal(threadIdFor(`/messages/${S.toUpperCase()}`, OTHER), `dm-${S}`);
  assert.equal(threadIdFor(`/community/${OTHER}`, S), `link-community-${OTHER}`);
  assert.equal(threadIdFor(`/golfer/${S}`, S), `link-golfer-${S}`);
  assert.equal(threadIdFor("/profile", S), "link-profile");
  assert.equal(threadIdFor("javascript:alert(1)", S), `person-${S}`);
  assert.equal(threadIdFor(null, S), `person-${S}`);
});

test("monogram initials follow the app's rule", () => {
  assert.equal(monogramInitials("dp", "Daniel Paulson"), "DP");
  assert.equal(monogramInitials(null, "Daniel Paulson"), "DP");
  assert.equal(monogramInitials("??", "Daniel van der Berg"), "DB");
  assert.equal(monogramInitials(null, "Madonna"), "MA");
  assert.equal(monogramInitials(null, "  "), "");
  assert.equal(monogramInitials(null, null), "");
  assert.equal(monogramInitials("<b>", "Ann Lee"), "AL");
  assert.equal(monogramInitials(null, "山田 太郎"), "山太");
});

test("gradients map the app's tokens, fairway green otherwise", () => {
  assert.deepEqual(avatarGradient("from-emerald-400 to-teal-600"), ["#34d399", "#0d9488"]);
  assert.deepEqual(avatarGradient(" from-emerald-400   to-teal-600 "), ["#34d399", "#0d9488"]);
  assert.deepEqual(avatarGradient("bg-[url(x)]"), DEFAULT_GRADIENT);
  assert.deepEqual(avatarGradient(undefined), DEFAULT_GRADIENT);
});

test("uuid check", () => {
  assert.equal(isUuid(S), true);
  assert.equal(isUuid("x"), false);
  assert.equal(isUuid(42), false);
});
