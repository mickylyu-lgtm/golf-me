// Run: node --test tests/optionalUpload.test.ts  (built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { startOptionalUpload } from "../src/lib/optionalUpload.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a thumbnail ready in time is used", async () => {
  const discarded: string[] = [];
  const up = startOptionalUpload({ produce: async () => "u/thumb.jpg", discard: (p) => discarded.push(p) });
  assert.equal(await up.settle(50), "u/thumb.jpg");
  assert.deepEqual(discarded, []);
});

test("a slow thumbnail never holds the analysis back and is removed when it lands", async () => {
  const d = deferred<string>();
  const discarded: string[] = [];
  const up = startOptionalUpload({ produce: () => d.promise, discard: (p) => discarded.push(p) });
  const t0 = Date.now();
  assert.equal(await up.settle(30), undefined);
  assert.ok(Date.now() - t0 < 500);
  d.resolve("u/late.jpg");
  await d.promise;
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(discarded, ["u/late.jpg"]);
});

test("a failed thumbnail is skipped (analysis goes ahead without one)", async () => {
  const errors: unknown[] = [];
  const up = startOptionalUpload({ produce: async () => Promise.reject(new Error("decode")), discard: () => {}, onError: (e) => errors.push(e) });
  assert.equal(await up.settle(50), undefined);
  assert.equal(errors.length, 1);
});

test("abandoning (the video upload failed) removes a thumbnail already uploaded or still coming", async () => {
  const discarded: string[] = [];
  const done = startOptionalUpload({ produce: async () => "u/a.jpg", discard: (p) => discarded.push(p) });
  await new Promise((r) => setTimeout(r, 0));
  done.abandon();
  const d = deferred<string>();
  const pending = startOptionalUpload({ produce: () => d.promise, discard: (p) => discarded.push(p) });
  pending.abandon();
  d.resolve("u/b.jpg");
  await d.promise;
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(discarded, ["u/a.jpg", "u/b.jpg"]);
  assert.equal(await pending.settle(10), undefined);
});
