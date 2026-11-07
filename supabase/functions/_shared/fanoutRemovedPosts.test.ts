// Run: npm run test  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkedPostIds, postIdFromLink, withoutRemovedPosts } from "./fanoutRemovedPosts.ts";

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const R1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const push = (recipient: string, link: string) => ({ recipient_id: recipient, title: "t", body: "b", link_to: link });

test("post links only", () => {
  assert.equal(postIdFromLink(`/community/${P1}`), P1);
  assert.equal(postIdFromLink(`/community/${P1.toUpperCase()}`), P1);
  assert.equal(postIdFromLink(`/golf-calls/${R1}`), null);
  assert.equal(postIdFromLink("/community/guidelines"), null);
  assert.equal(postIdFromLink(`/community/${P1}/x`), null);
  assert.equal(postIdFromLink(null), null);
  assert.deepEqual(linkedPostIds([push("u1", `/community/${P1}`), push("u2", `/community/${P1}`), push("u3", `/golf-calls/${R1}`), push("u4", `/community/${P2}`)]), [P1, P2]);
});

test("removed or deleted posts drop their pushes; round pushes stay", () => {
  const owed = [push("u1", `/community/${P1}`), push("u2", `/community/${P2}`), push("u3", `/golf-calls/${R1}`)];
  const r = withoutRemovedPosts(owed, { ok: true, rows: [{ id: P1, removed_at: "2026-11-07T12:00:00Z" }, { id: P2, removed_at: null }] });
  assert.deepEqual(r.keep.map((p) => p.recipient_id), ["u2", "u3"]);
  assert.equal(r.dropped, 1);
  const gone = withoutRemovedPosts(owed, { ok: true, rows: [] });
  assert.deepEqual(gone.keep.map((p) => p.recipient_id), ["u3"]);
  assert.equal(gone.dropped, 2);
});

test("a failed lookup (e.g. migration not applied) keeps every push", () => {
  const owed = [push("u1", `/community/${P1}`), push("u3", `/golf-calls/${R1}`)];
  const r = withoutRemovedPosts(owed, { ok: false });
  assert.equal(r.keep.length, 2);
  assert.equal(r.dropped, 0);
});
