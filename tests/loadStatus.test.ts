// Run: npm run test:trust  (node --test, built-in type stripping)
// The load bookkeeping RealRounds/RealCommunity/RealSocial share: a failed
// first load is an error (not "empty"), retry recovers, and a later failed
// refresh keeps the data that's already on screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_LOAD_STATUS, applyLoadOutcome, isFirstLoadError, isRefreshError, listView } from "../src/lib/loadStatus.ts";
import type { LoadStatus } from "../src/lib/loadStatus.ts";

// A tiny stand-in for a context's refetch(): on success it replaces the
// data, on failure it leaves the data alone (exactly what the contexts' catch
// blocks do) and records the outcome.
function makeContext() {
  let status: LoadStatus = INITIAL_LOAD_STATUS;
  let data: string[] = [];
  return {
    async refetch(fetcher: () => Promise<string[]>) {
      try {
        data = await fetcher();
        status = applyLoadOutcome(status, true);
      } catch {
        status = applyLoadOutcome(status, false);
      }
    },
    view(isLoading = false) {
      return listView({ count: data.length, isDemo: false, hasLoaded: status.settled, loadError: isFirstLoadError(status), isLoading });
    },
    get status() {
      return status;
    },
    get data() {
      return data;
    },
  };
}

const ok = (rows: string[]) => async () => rows;
const fail = async (): Promise<string[]> => {
  throw new Error("Failed to fetch");
};

test("before the first fetch settles the page shows loading, not empty", () => {
  const ctx = makeContext();
  assert.equal(ctx.view(true), "loading");
  assert.equal(ctx.view(false), "loading");
});

test("a failed first load is an error, never 'loaded and empty'", async () => {
  const ctx = makeContext();
  await ctx.refetch(fail);
  assert.equal(isFirstLoadError(ctx.status), true);
  assert.equal(isRefreshError(ctx.status), false);
  assert.equal(ctx.status.settled, true, "hasLoaded still flips so deep links stop waiting");
  assert.equal(ctx.view(), "error");
});

test("while a retry is running after a failed first load the page shows loading", async () => {
  const ctx = makeContext();
  await ctx.refetch(fail);
  assert.equal(ctx.view(true), "loading");
});

test("retry recovers from a failed first load", async () => {
  const ctx = makeContext();
  await ctx.refetch(fail);
  await ctx.refetch(ok(["r1", "r2"]));
  assert.equal(isFirstLoadError(ctx.status), false);
  assert.equal(isRefreshError(ctx.status), false);
  assert.equal(ctx.view(), "list");
});

test("retry that succeeds with no rows is a genuine empty", async () => {
  const ctx = makeContext();
  await ctx.refetch(fail);
  await ctx.refetch(ok([]));
  assert.equal(ctx.view(), "empty");
});

test("a later refresh failure keeps the data and flags a refresh error only", async () => {
  const ctx = makeContext();
  await ctx.refetch(ok(["r1"]));
  await ctx.refetch(fail);
  assert.deepEqual(ctx.data, ["r1"]);
  assert.equal(isFirstLoadError(ctx.status), false);
  assert.equal(isRefreshError(ctx.status), true);
  assert.equal(ctx.view(), "list");
  await ctx.refetch(ok(["r1", "r3"]));
  assert.equal(isRefreshError(ctx.status), false);
});

test("a later refresh failure after a genuinely empty load stays empty, not error", async () => {
  const ctx = makeContext();
  await ctx.refetch(ok([]));
  await ctx.refetch(fail);
  assert.equal(ctx.view(), "empty");
  assert.equal(isRefreshError(ctx.status), true);
});

test("demo is always loaded with no error", () => {
  assert.equal(listView({ count: 0, isDemo: true, hasLoaded: true, loadError: false, isLoading: false }), "empty");
  // Even if a caller passed stale real-mode flags, demo never shows the error.
  assert.equal(listView({ count: 0, isDemo: true, hasLoaded: false, loadError: true, isLoading: true }), "empty");
});

test("an unchanged outcome returns the same object (no re-render churn from polling)", () => {
  const failed = applyLoadOutcome(applyLoadOutcome(INITIAL_LOAD_STATUS, true), false);
  assert.equal(applyLoadOutcome(failed, false), failed);
});
