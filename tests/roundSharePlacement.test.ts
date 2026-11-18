import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("detail invitation is a prominent action before match and booking information, with existing host protections", () => {
  const detail = read("pages/GolfCallDetail.tsx");
  assert.match(detail, /!isDemo && isHost && !isCompleted && !isCancelled && <RoundShareButton call=\{call\} \/>/);
  assert.ok(detail.indexOf('<RoundShareButton call={call}') < detail.indexOf('{tier && ('));
  assert.doesNotMatch(detail, /t\("share.shareRound"\)/);
});

test("Home card keeps navigation and sharing as sibling controls, not nested buttons", () => {
  const card = read("components/golfcall/RoundStripCard.tsx");
  assert.match(card, /!isDemo && call.hostId === currentUser.id && call.status !== "completed" && call.status !== "cancelled"/);
  assert.match(card, /<\/button>\s*\{canShare && <div[^>]*><RoundShareButton call=\{call\}/);
  assert.match(card, /navigate\(`\/golf-calls\/\$\{call.id\}`\)/);
});

test("shared round button is labelled, 44px minimum, full width, and uses the existing safe share action", () => {
  const button = read("components/golfcall/RoundShareButton.tsx");
  assert.match(button, /type="button" fullWidth className="min-h-11"/);
  assert.match(button, /t\("share.shareRoundButton"\)/);
  assert.match(button, /onClick=\{\(\) => void shareRound\(call\)\}/);
  assert.doesNotMatch(button, /supabase|joinRound|createPost/);
});
