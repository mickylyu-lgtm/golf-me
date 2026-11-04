// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTranslationRunning, queueAutoTranslation, queueTranslation, whenTranslationSettled } from "../src/lib/caddieAutoTranslate.ts";
import { claimAutoTranslateAttempt, needsAutoTranslate, releaseAutoTranslateAttempt } from "../src/lib/caddieLanguage.ts";

// A stand-in for one analysis: what language its stored text is in, and
// the app's language, as the page flow sees them.
function fakeAnalysis(start: string) {
  const state = { stored: start, app: start, calls: [] as string[] };
  const translate = async (_id: string, locale: string) => {
    state.calls.push(locale);
    await new Promise((r) => setTimeout(r, 5));
    state.stored = locale;
  };
  return { state, translate };
}

// The page's flow: check, claim, queue, give the attempt back on success.
async function pageAutoTranslate(id: string, a: ReturnType<typeof fakeAnalysis>) {
  const target = a.state.app;
  if (!needsAutoTranslate({ language: a.state.stored as "en", sampleText: "x" }, target)) return;
  if (!claimAutoTranslateAttempt(id, target)) return;
  await queueAutoTranslation(id, target, () => a.state.app, a.translate).then(() => releaseAutoTranslateAttempt(id, target));
}

test("switching back to a language already used translates again (zh -> ja -> zh)", async () => {
  const a = fakeAnalysis("en");
  a.state.app = "zh-CN";
  await pageAutoTranslate("back1", a);
  a.state.app = "ja";
  await pageAutoTranslate("back1", a);
  a.state.app = "zh-CN";
  await pageAutoTranslate("back1", a);
  assert.deepEqual(a.state.calls, ["zh-CN", "ja", "zh-CN"]);
  assert.equal(a.state.stored, "zh-CN", "ends in the language the app is in");
});

test("fast switching: a job for a language left before its turn is skipped; the last pick wins", async () => {
  const a = fakeAnalysis("en");
  a.state.app = "ja";
  const first = pageAutoTranslate("fast1", a); // starts translating to ja
  a.state.app = "ko";
  const second = pageAutoTranslate("fast1", a); // queued behind ja
  a.state.app = "es";
  const third = pageAutoTranslate("fast1", a); // queued behind ko
  await Promise.all([first, second, third]);
  // All three were queued before the first job's turn came (synchronously
  // here), so only the last pick is ever sent; ja and ko never reach the AI.
  assert.deepEqual(a.state.calls, ["es"], "stale jobs are skipped, never sent");
  assert.equal(a.state.stored, "es");
});

test("fast switching while a translation is already running: it finishes, the middle pick is skipped", async () => {
  const a = fakeAnalysis("en");
  a.state.app = "ja";
  const first = pageAutoTranslate("fast2", a);
  await new Promise((r) => setTimeout(r, 1)); // ja is now in flight
  a.state.app = "ko";
  const second = pageAutoTranslate("fast2", a);
  a.state.app = "es";
  const third = pageAutoTranslate("fast2", a);
  await Promise.all([first, second, third]);
  assert.deepEqual(a.state.calls, ["ja", "es"], "ko skipped; es translated after ja");
  assert.equal(a.state.stored, "es");
});

test("a failure keeps the attempt used, so it can't loop", async () => {
  const failing = async () => {
    throw Object.assign(new Error("502"), { status: 502 });
  };
  assert.equal(claimAutoTranslateAttempt("fail1", "ja"), true);
  await assert.rejects(queueAutoTranslation("fail1", "ja", () => "ja", failing));
  assert.equal(claimAutoTranslateAttempt("fail1", "ja"), false, "not retried automatically");
});

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
