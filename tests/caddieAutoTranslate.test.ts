// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTranslationRunning, queueTranslation, whenTranslationSettled } from "../src/lib/caddieAutoTranslate.ts";
import { needsAutoTranslate } from "../src/lib/caddieLanguage.ts";

const defer = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test("jobs for one analysis never overlap: the second waits for the first", async () => {
  const order: string[] = [];
  const first = defer();
  const a = queueTranslation("q1", async () => {
    order.push("ja start");
    await first.promise;
    order.push("ja end");
  });
  const b = queueTranslation("q1", async () => {
    order.push("ko start");
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(order, ["ja start"], "ko hasn't started while ja runs");
  assert.equal(isTranslationRunning("q1"), true);
  first.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["ja start", "ja end", "ko start"]);
  assert.equal(isTranslationRunning("q1"), false);
});

test("a failed job doesn't block the next one, and settling never rejects", async () => {
  const failing = queueTranslation("q2", async () => {
    throw new Error("502");
  });
  let ran = false;
  const next = queueTranslation("q2", async () => {
    ran = true;
  });
  await assert.rejects(failing);
  await next;
  assert.equal(ran, true);
  await whenTranslationSettled("q2");
});

test("different analyses run independently", async () => {
  const slow = defer();
  queueTranslation("q3", () => slow.promise);
  let other = false;
  await queueTranslation("q4", async () => {
    other = true;
  });
  assert.equal(other, true);
  slow.resolve();
  await whenTranslationSettled("q3");
});

test("an explicit pick also covers same-script old rows; a recorded language still decides", () => {
  const es = "Tus caderas se deslizan hacia el objetivo en el impacto.";
  assert.equal(needsAutoTranslate({ sampleText: es }, "en"), false, "not guessed without the explicit pick");
  assert.equal(needsAutoTranslate({ sampleText: es }, "en", true), true);
  assert.equal(needsAutoTranslate({ language: "en", sampleText: es }, "en", true), false, "already recorded as en");
  assert.equal(needsAutoTranslate({ sampleText: "" }, "en", true), false);
});
