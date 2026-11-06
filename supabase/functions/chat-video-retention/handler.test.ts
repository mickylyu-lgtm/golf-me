// chat-video-retention handler against in-memory fakes. No network.
// node --test supabase/functions/chat-video-retention/handler.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPIRE_BATCH, handleRetentionRequest, removeAll, runRetention, type RetentionDeps, type StorageObjectRef } from "./handler.ts";

function deps(opts: { due?: StorageObjectRef[][]; orphans?: StorageObjectRef[]; failRemove?: string; secret?: string; expireThrows?: boolean }) {
  const due = [...(opts.due ?? [])];
  const removed: { bucket: string; names: string[] }[] = [];
  const calls: string[] = [];
  const d: RetentionDeps = {
    expectedSecret: opts.secret ?? "s3cret",
    async expireDue(limit) {
      calls.push(`expire:${limit}`);
      if (opts.expireThrows) throw new Error("db down");
      return due.shift() ?? [];
    },
    async orphans(limit) {
      calls.push(`orphans:${limit}`);
      return opts.orphans ?? [];
    },
    async remove(bucket, names) {
      calls.push(`remove:${bucket}:${names.length}`);
      if (opts.failRemove === bucket) return { error: "boom" };
      removed.push({ bucket, names });
      return {};
    },
  };
  return { d, removed, calls };
}

const v = (n: number) => ({ bucket: "chat-video", name: `dm/c/m${n}/0.mp4` });

test("expired rows are cleared by the database before any delete; their objects are removed", async () => {
  const { d, removed, calls } = deps({ due: [[v(1), { bucket: "chat-video", name: "dm/c/m1/0.poster.jpg" }]] });
  const r = await runRetention(d);
  assert.deepEqual(calls.slice(0, 2), ["expire:200", "remove:chat-video:2"]);
  assert.equal(r.expiredObjects, 2);
  assert.equal(r.removed, 2);
  assert.deepEqual(removed[0].names, ["dm/c/m1/0.mp4", "dm/c/m1/0.poster.jpg"]);
});

test("full batches loop (bounded), then orphans; a failed delete is reported, not thrown", async () => {
  const full = Array.from({ length: EXPIRE_BATCH }, (_, i) => v(i));
  const { d, calls } = deps({ due: [full, full, [v(999)]], orphans: [{ bucket: "chat-video-incoming", name: "u/m-0.orig" }], failRemove: "chat-video-incoming" });
  const r = await runRetention(d);
  assert.equal(calls.filter((c) => c.startsWith("expire")).length, 3);
  assert.equal(r.expiredObjects, 2 * EXPIRE_BATCH + 1);
  assert.equal(r.orphanObjects, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /chat-video-incoming/);
});

test("never more than MAX_EXPIRE_ROUNDS rounds; a database error still runs the orphan sweep", async () => {
  const full = Array.from({ length: EXPIRE_BATCH }, (_, i) => v(i));
  const many = deps({ due: Array.from({ length: 20 }, () => full) });
  await runRetention(many.d);
  assert.equal(many.calls.filter((c) => c.startsWith("expire")).length, 5);
  const broken = deps({ expireThrows: true, orphans: [v(5)] });
  const r = await runRetention(broken.d);
  assert.match(r.errors[0], /expire: db down/);
  assert.equal(r.removed, 1);
});

test("only the two chat video buckets are ever touched; duplicates removed once; batches of 100", async () => {
  const { d, removed } = deps({});
  const refs = [
    ...Array.from({ length: 150 }, (_, i) => v(i)),
    v(1),
    { bucket: "avatars", name: "someone/avatar.jpg" },
    { bucket: "chat-media", name: "dm/c/m.jpg" },
  ];
  const r = await removeAll(d, refs);
  assert.equal(r.removed, 150);
  assert.deepEqual(removed.map((x) => [x.bucket, x.names.length]), [["chat-video", 100], ["chat-video", 50]]);
});

test("request: POST with the internal secret only", async () => {
  const { d } = deps({});
  assert.equal((await handleRetentionRequest(new Request("http://x", { method: "GET" }), d)).status, 405);
  assert.equal((await handleRetentionRequest(new Request("http://x", { method: "POST" }), d)).status, 401);
  assert.equal((await handleRetentionRequest(new Request("http://x", { method: "POST", headers: { "x-internal-secret": "nope" } }), d)).status, 401);
  const unset = deps({ secret: "" });
  assert.equal((await handleRetentionRequest(new Request("http://x", { method: "POST", headers: { "x-internal-secret": "" } }), unset.d)).status, 401);
  const ok = await handleRetentionRequest(new Request("http://x", { method: "POST", headers: { "x-internal-secret": "s3cret" } }), d);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { expiredObjects: 0, orphanObjects: 0, removed: 0, errors: [] });
});
