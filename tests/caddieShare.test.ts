// Run: npm run test:trust  (node --test, built-in type stripping)
// "Share Caddie Feedback": a post that went out is never repeated, even when
// marking the analysis shared fails afterwards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { postFeedbackThenMark } from "../src/lib/caddieShare.ts";

function harness(markFailures: number, postFails = false) {
  const calls = { post: 0, mark: 0, logged: 0 };
  let failuresLeft = markFailures;
  return {
    calls,
    deps: {
      createPost: async () => {
        calls.post += 1;
        if (postFails) throw new Error("insert failed");
      },
      markShared: async () => {
        calls.mark += 1;
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error("update failed");
        }
      },
      retryDelayMs: 0,
      log: () => {
        calls.logged += 1;
      },
    },
  };
}

test("happy path: one post, one mark", async () => {
  const { deps, calls } = harness(0);
  assert.deepEqual(await postFeedbackThenMark(deps), { posted: true, marked: true });
  assert.deepEqual(calls, { post: 1, mark: 1, logged: 0 });
});

test("mark fails once: retried, still exactly one post", async () => {
  const { deps, calls } = harness(1);
  assert.deepEqual(await postFeedbackThenMark(deps), { posted: true, marked: true });
  assert.deepEqual(calls, { post: 1, mark: 2, logged: 0 });
});

test("mark keeps failing: resolves as posted (so the button stays done), logged, never re-posts", async () => {
  const { deps, calls } = harness(5);
  assert.deepEqual(await postFeedbackThenMark(deps), { posted: true, marked: false });
  assert.deepEqual(calls, { post: 1, mark: 2, logged: 1 });
});

test("post fails: rejects, nothing marked, safe to try again", async () => {
  const { deps, calls } = harness(0, true);
  await assert.rejects(postFeedbackThenMark(deps), /insert failed/);
  assert.deepEqual(calls, { post: 1, mark: 0, logged: 0 });
});

// The screen's own guard: CaddieAnalysisDetail records the analysis id as
// posted inside createPost's success and refuses a second share for it.
test("screen-level dedup: a second tap after a mark failure does not post again", async () => {
  const postedIds = new Set<string>();
  let posts = 0;
  async function share(id: string) {
    if (postedIds.has(id)) return "skipped";
    await postFeedbackThenMark({
      createPost: async () => {
        posts += 1;
        postedIds.add(id);
      },
      markShared: async () => {
        throw new Error("update failed");
      },
      retryDelayMs: 0,
      log: () => {},
    });
    return "shared";
  }
  assert.equal(await share("a1"), "shared");
  assert.equal(await share("a1"), "skipped");
  assert.equal(posts, 1);
});

import { shareFeedbackAtomically } from "../src/lib/caddieShare.ts";
test("atomic share returns the confirmed post without legacy confirmation", async () => {
  const calls: boolean[] = [];
  assert.deepEqual(await shareFeedbackAtomically(async confirm => {
    calls.push(confirm); return { data: {post_id: "post-1", outcome: "created"}, error: null };
  }, () => { throw new Error("unexpected confirmation"); }), {post_id: "post-1", outcome: "created"});
  assert.deepEqual(calls, [false]);
});
test("unknown historical share is never silently reposted", async () => {
  const calls: boolean[] = [];
  assert.deepEqual(await shareFeedbackAtomically(async confirm => {
    calls.push(confirm); return { data: null, error: { message: "unknown", hint: "caddie_legacy_share_confirmation" } };
  }, () => false), null);
  assert.deepEqual(calls, [false]);
});
test("explicit historical confirmation retries the atomic RPC only", async () => {
  const calls: boolean[] = [];
  assert.deepEqual(await shareFeedbackAtomically(async confirm => {
    calls.push(confirm); return confirm ? { data: {post_id: "new-post", outcome: "created"}, error: null } :
      { data: null, error: { message: "unknown", hint: "caddie_legacy_share_confirmation" } };
  }, () => true), {post_id: "new-post", outcome: "created"});
  assert.deepEqual(calls, [false, true]);
});
test("unavailable RPC and lost responses fail closed, never fallback to createPost", async () => {
  await assert.rejects(shareFeedbackAtomically(async () => ({ data: null, error: { message: "RPC unavailable" } }), () => true), /RPC unavailable/);
  await assert.rejects(shareFeedbackAtomically(async () => ({ data: null, error: null }), () => true), /Missing feedback/);
});

test("existing and moderated outcomes are distinct, with no recreated post", async () => {
  for (const outcome of [{post_id: "post-1", outcome: "existing"}, {post_id: null, outcome: "unavailable"}]) {
    assert.deepEqual(await shareFeedbackAtomically(async () => ({data: outcome, error: null}), () => false), outcome);
  }
});
