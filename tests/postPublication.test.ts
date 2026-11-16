import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { rejectFailedPostMedia, PostPublicationUncertainError } from "../src/lib/postPublication.ts";
import { PostMediaCapError, isPostMediaCapError } from "../src/lib/postMediaLedger.ts";
import { rejectFailedOfficialMedia } from "../src/lib/officialPost.ts";

// Execute the actual provider callback with synthetic transport. No React mount,
// external account, production mutation, or copied implementation is involved.
function provider(mediaResult: unknown, rollback: unknown = { data: { id: "created-post" }, error: null }) {
  const source = process.env.POST_PUBLICATION_BASELINE
    ? execFileSync("git", ["show", "HEAD:src/context/RealCommunityContext.tsx"], { encoding: "utf8" })
    : readFileSync("src/context/RealCommunityContext.tsx", "utf8");
  const start = source.indexOf("    async (input: CreateRealPostInput)");
  const end = source.indexOf("\n    [selfId],", start);
  const callback = source.slice(start, end).trim().replace(/,$/, "");
  const js = ts.transpileModule(`export default ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  let deleted = 0;
  const supabase = { from(table: string) { return {
    insert(fields: Record<string, unknown>) { return { select() {
      if (table === "community_posts") return { single: async () => ({ data: { ...fields, id: "created-post" }, error: null }) };
      return mediaResult instanceof Error ? Promise.reject(mediaResult) : Promise.resolve(mediaResult);
    } }; },
    delete() { deleted++; return { eq() { return { select() { return { maybeSingle: () => rollback instanceof Error ? Promise.reject(rollback) : Promise.resolve(rollback) }; } }; } }; },
  }; } };
  const values = { selfId: "user", supabase, setPendingPosts: () => {}, setMediaRows: () => {}, officialPostInsertFields: () => ({}), rowToPost: (post: unknown, media: unknown) => ({ post, media }), isPostMediaCapError, PostMediaCapError, rejectFailedOfficialMedia, rejectFailedPostMedia };
  const run = new Function(...Object.keys(values), js.replace("export default", "return"))(...Object.values(values));
  return { run: () => run({ type: "photo", text: "A photo", category: "General", media: [{ type: "image", url: "https://test.invalid/photo.jpg" }] }), deleted: () => deleted };
}

test("ordinary photo attach failure does not falsely report a published post", async () => {
  const p = provider({ data: null, error: { code: "42501", message: "attachment refused" } });
  await assert.rejects(p.run(), /Couldn't attach/);
  assert.equal(p.deleted(), 1);
});
test("thrown transport and missing attachment responses also retain retryable failure", async () => {
  for (const result of [Error("connection lost"), { data: [], error: null }, { data: null, error: null }]) {
    const p = provider(result);
    await assert.rejects(p.run(), /Couldn't attach/);
    assert.equal(p.deleted(), 1);
  }
});
test("uncertain rollback never invites a duplicate post retry", async () => {
  for (const rollback of [{ data: null, error: null }, { data: null, error: { message: "offline" } }, { data: { id: "wrong" }, error: null }, Error("lost")]) {
    const p = provider({ data: null, error: { message: "failed" } }, rollback);
    await assert.rejects(p.run(), error => error instanceof PostPublicationUncertainError && error.postId === "created-post");
  }
});
test("media cap remains distinguished only after verified rollback", async () => {
  const p = provider({ data: null, error: { code: "23514", hint: "community_post_media_cap" } });
  await assert.rejects(p.run(), PostMediaCapError);
});
test("successful photo attachment preserves its returned rows and does not delete", async () => {
  const media = [{ post_id: "created-post", media_url: "https://test.invalid/photo.jpg" }];
  const p = provider({ data: media, error: null });
  assert.deepEqual((await p.run()).media, media);
  assert.equal(p.deleted(), 0);
});
test("composer handles uncertain media before cleanup and leaves saved draft intact", () => {
  const source = readFileSync("src/pages/CreatePost.tsx", "utf8");
  const branch = source.slice(source.indexOf("if (err instanceof PostPublicationUncertainError)"), source.indexOf("if (err instanceof OfficialPostPublicationUncertainError)"));
  assert.match(branch, /navigate\(`/);
  assert.match(branch, /return;/);
  assert.doesNotMatch(branch, /clearCommunityPostDraft|removeCommunityMedia/);
});
