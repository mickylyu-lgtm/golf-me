import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync(new URL("../src/lib/sharePreview.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  type Reply = { data?: unknown; error?: unknown };
  const requests: {
    kind: "post" | "round"; id: string; signal?: AbortSignal;
    resolve: (value: Reply) => void; reject: (error: Error) => void;
  }[] = [];
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", "setTimeout", "clearTimeout", js)(
    (id: string) => {
      if (id === "./shareLinks") return { CANONICAL_ORIGIN: "https://golfme.app" };
      assert.equal(id, "./supabase");
      return {
        supabase: {
          rpc(name: string, { p_kind, p_id }: { p_kind: "post" | "round"; p_id: string }) {
            assert.equal(name, "create_share_preview");
            let signal: AbortSignal | undefined;
            const builder = {
              abortSignal(value: AbortSignal) { signal = value; return builder; },
              then(ok: (value: Reply) => void, fail: (error: Error) => void) {
                return new Promise<Reply>((resolve, reject) => {
                  // This synthetic transport deliberately does not settle on abort.
                  requests.push({ kind: p_kind, id: p_id, signal, resolve, reject });
                }).then(ok, fail);
              },
            };
            return builder;
          },
        },
      };
    },
    exports,
    (fn: () => void, duration: number) => {
      assert.equal(duration, 12_000);
      timers.set(++nextTimer, fn);
      return nextTimer;
    },
    (id: number) => { timers.delete(id); },
  );
  return {
    prepare: exports.createSharePreview as (kind: "post" | "round", id: string) => Promise<string>,
    requests,
    timers,
    fireDeadline() {
      const work = [...timers.values()];
      assert.ok(work.length > 0, "the stalled request must have a deadline");
      for (const run of work) run();
    },
  };
}

for (const kind of ["post", "round"] as const) {
  test(`${kind} preparation times out, aborts the old request and permits an independent retry`, async () => {
    const h = harness();
    const id = "66666666-6666-4666-8666-666666666666";
    const old = h.prepare(kind, id);
    await Promise.resolve();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].kind, kind);
    assert.equal(h.requests[0].id, id);
    h.fireDeadline();
    await assert.rejects(old, /Unable to prepare share preview/);
    assert.equal(h.requests[0].signal?.aborted, true);
    assert.equal(h.timers.size, 0);

    const retry = h.prepare(kind, id);
    await Promise.resolve();
    assert.equal(h.requests.length, 2);
    assert.notEqual(h.requests[0].signal, h.requests[1].signal);
    const freshToken = "b".repeat(64);
    h.requests[1].resolve({ data: freshToken, error: null });
    assert.equal(await retry, "https://golfme.app/s/" + freshToken);
    h.requests[0].resolve({ data: "a".repeat(64), error: null });
    await assert.rejects(old, /Unable to prepare share preview/);
    assert.equal(h.requests[1].signal?.aborted, false);
    assert.equal(h.timers.size, 0);
  });
}

test("preparation still rejects malformed and denied previews and clears settled timers", async () => {
  const h = harness();
  for (const reply of [{ data: "not-an-opaque-token" }, { data: "b".repeat(64), error: { code: "42501" } }]) {
    const result = h.prepare("post", "77777777-7777-4777-8777-777777777777");
    await Promise.resolve();
    h.requests.at(-1)?.resolve(reply);
    await assert.rejects(result, /Unable to prepare share preview/);
    assert.equal(h.timers.size, 0);
  }
  const result = h.prepare("post", "77777777-7777-4777-8777-777777777777");
  await Promise.resolve();
  h.requests.at(-1)?.reject(new Error("synthetic transport failure"));
  await assert.rejects(result, /synthetic transport failure/);
  assert.equal(h.timers.size, 0);
});
