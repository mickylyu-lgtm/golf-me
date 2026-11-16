import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { readChatUploadToken } from "../src/lib/chatUploadSession.ts";

const session = { data: { session: { access_token: "test-token" } } };
test("upload session returns token or signed-out state", async () => {
  assert.equal(await readChatUploadToken(async () => session), "test-token");
  assert.equal(await readChatUploadToken(async () => ({ data: { session: null } })), null);
});
test("upload session bounds a stalled auth lock and ignores its late answer", async () => {
  let resolve!: (value: typeof session) => void;
  const pending = new Promise<typeof session>((r) => { resolve = r; });
  await assert.rejects(readChatUploadToken(() => pending, 5), /timed out/);
  resolve(session);
  assert.equal(await readChatUploadToken(async () => session), "test-token");
});
test("upload session rejects returned and thrown auth errors", async () => {
  await assert.rejects(readChatUploadToken(async () => { throw new Error("offline"); }), /offline/);
  await assert.rejects(readChatUploadToken(async () => ({ ...session, error: new Error("refresh") })), /unavailable/);
});

// Execute the actual attempt callback (not a duplicate implementation) with
// synthetic dependencies. No network, credentials or message writes.
function attempt(kind: "dm" | "round", opts: { stale?: boolean; discarded?: boolean; stage?: "photo" | "insert" } = {}) {
  const dm = kind === "dm";
  const source = readFileSync(new URL(dm ? "../src/context/RealSocialContext.tsx" : "../src/context/RealRoundsContext.tsx", import.meta.url), "utf8");
  const start = source.indexOf(dm ? "(tempId: string): Promise<SendMessageResult> => {" : "(clientId: string): Promise<SendMessageResult> => {", source.indexOf("const attemptPhoto = useCallback("));
  const end = source.indexOf(dm ? "\n    [selfId, canMessage, patchPhoto]," : "\n    [authUser, refetch],", start);
  assert.ok(start >= 0 && end > start);
  const callback = source.slice(start, end).trim().replace(/,$/, "");
  const job = { generation: 1, user: "self", conversationId: "conv", roundId: "round", messageId: "message", otherId: "other", media: opts.stage ? null : [{ kind: "image" }], uploaded: opts.stage === "insert" };
  const jobs = new Map<string, typeof job>([["pending", job]]);
  const inFlight = new Map();
  const changes: unknown[] = [];
  const calls: string[] = [];
  const deps = {
    selfId: "self", authUser: { id: "self" }, generationRef: { current: 1 }, userIdRef: { current: "self" },
    photoJobsRef: { current: jobs }, photoInFlightRef: { current: inFlight }, canMessage: () => true,
    mediaPrefix: () => "prefix", jobPath: () => "photo.jpg", roundJobPath: () => "photo.jpg", imageRowColumns: () => ({}),
    uploadChatImage: async () => { calls.push("photo"); throw new Error("auth failed"); },
    supabase: { from: () => ({ insert: () => ({ select: () => ({ maybeSingle: async () => { calls.push("insert"); throw new Error("insert failed"); }, single: async () => { calls.push("insert"); throw new Error("insert failed"); } }) }) }) },
    patchPhoto: (...args: unknown[]) => changes.push(args),
    setPendingMessages: (fn: (prev: unknown[]) => unknown) => changes.push(fn([])),
    markRoundMessageFailed: (_prev: unknown, id: string, failure: string) => ({ id, failure }),
    patchRoundPhoto: (prev: unknown, _id: string, patch: unknown) => ({ prev, patch }),
    storeMediaItems: async () => {
      if (opts.stale) { deps.generationRef.current = 2; deps.userIdRef.current = "other-account"; }
      if (opts.discarded) jobs.delete("pending");
      throw new Error("transport failed");
    },
  };
  const js = stripTypeScriptTypes(`const attempt = ${callback};`);
  const run = new Function(...Object.keys(deps), `${js}; return attempt;`)(...Object.values(deps));
  return { run, job, jobs, inFlight, changes, calls };
}
for (const kind of ["dm", "round"] as const) {
  test(`${kind}: thrown album upload becomes retryable failed bubble and clears in-flight guard`, async () => {
    const a = attempt(kind);
    assert.equal(await a.run("pending"), "failed");
    assert.equal(a.changes.length, 1);
    assert.equal(a.jobs.get("pending"), a.job);
    assert.equal(a.inFlight.size, 0);
    assert.equal(await a.run("pending"), "failed");
    assert.equal(a.changes.length, 2);
  });
  test(`${kind}: single photo auth and post-upload insert exceptions retain retry state`, async () => {
    for (const stage of ["photo", "insert"] as const) {
      const a = attempt(kind, { stage });
      assert.equal(await a.run("pending"), "failed");
      assert.equal(a.changes.length, 1);
      assert.equal(a.jobs.get("pending"), a.job);
      assert.equal(a.job.uploaded, stage === "insert");
      assert.deepEqual(a.calls, [stage]);
      assert.equal(a.inFlight.size, 0);
    }
  });
  test(`${kind}: thrown upload cannot patch a new account or discarded message`, async () => {
    for (const opts of [{ stale: true }, { discarded: true }]) {
      const a = attempt(kind, opts);
      assert.equal(await a.run("pending"), "failed");
      assert.equal(a.changes.length, 0);
      assert.equal(a.inFlight.size, 0);
    }
  });
}
