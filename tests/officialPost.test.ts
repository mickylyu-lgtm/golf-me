import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseOfficialPostCapability, fetchOfficialPostCapability,
  requireOfficialPostCapability, officialPostInsertFields,
  isOfficialPostRow, isOfficialPostError, OfficialPostPermissionError,
  rejectFailedOfficialMedia, OfficialPostPublicationUncertainError,
} from "../src/lib/officialPost.ts";

test("only the strict v1 server capability enables official posts", () => {
  assert.deepEqual(parseOfficialPostCapability({ version: 1, can_post_official: true }), { available: true, canPostOfficial: true });
  assert.deepEqual(parseOfficialPostCapability({ version: 1, can_post_official: false }), { available: true, canPostOfficial: false });
  for (const data of [null, undefined, [], [{ version: 1, can_post_official: true }], {}, { version: 2, can_post_official: true }, { version: "1", can_post_official: true }, { version: 1, can_post_official: "true" }, { is_admin: true }, { version: 1 }]) {
    assert.deepEqual(parseOfficialPostCapability(data), { available: false, canPostOfficial: false });
  }
});

test("errors, missing migration and thrown requests fail closed", async () => {
  const allow = { version: 1, can_post_official: true };
  for (const error of [{ code: "PGRST202" }, { code: "42501" }, Error("offline")]) {
    assert.equal(parseOfficialPostCapability(allow, error).canPostOfficial, false);
    await assert.rejects(requireOfficialPostCapability(() => Promise.resolve({ data: allow, error }), () => true), OfficialPostPermissionError);
  }
  assert.equal((await fetchOfficialPostCapability(() => { throw Error("offline"); })).canPostOfficial, false);
});

test("official submit rechecks the role and caller after the response", async () => {
  let current = true;
  let resolve!: (r: { data: unknown; error: unknown }) => void;
  const response = new Promise<{ data: unknown; error: unknown }>(r => { resolve = r; });
  const result = requireOfficialPostCapability(() => response, () => current);
  current = false;
  resolve({ data: { version: 1, can_post_official: true }, error: null });
  await assert.rejects(result, OfficialPostPermissionError);
  await requireOfficialPostCapability(() => Promise.resolve({ data: { version: 1, can_post_official: true }, error: null }), () => true);
  await assert.rejects(requireOfficialPostCapability(() => Promise.resolve({ data: { version: 1, can_post_official: false }, error: null }), () => true), OfficialPostPermissionError);
});

test("ordinary inserts omit the new column rather than break older backends", () => {
  assert.deepEqual(officialPostInsertFields(), {});
  assert.deepEqual(officialPostInsertFields(false), {});
  assert.deepEqual(officialPostInsertFields(true), { is_official: true });
});

test("old or untrusted row values never receive the official badge", () => {
  for (const is_official of [undefined, null, false, "true", 1, {}, []]) assert.equal(isOfficialPostRow({ is_official }), false);
  assert.equal(isOfficialPostRow({ is_official: true }), true);
});

test("permission failures have localized error classification", () => {
  assert.equal(isOfficialPostError(new OfficialPostPermissionError()), true);
  assert.equal(isOfficialPostError({ message: "official_post_immutable" }), true);
  for (const error of [null, "official_post_not_allowed", {}, Error("network")]) assert.equal(isOfficialPostError(error), false);
});

test("official mode stays out of shared drafts and demo posts reject it", () => {
  const draft = readFileSync("src/lib/communityPostDraft.ts", "utf8");
  assert.doesNotMatch(draft, /isOfficial|officialForId/);
  const data = readFileSync("src/context/DataContext.tsx", "utf8");
  assert.match(data, /if \(input\.isOfficial\) throw new OfficialPostPermissionError\(\);/);
  const real = readFileSync("src/context/RealCommunityContext.tsx", "utf8");
  assert.match(real, /\.\.\.officialPostInsertFields\(input\.isOfficial\)/);
  assert.match(real, /isOfficial: isOfficialPostRow\(row\)/);
});

test("post designation does not alter the feed ranking or category set", () => {
  for (const path of ["src/lib/communityFeed.ts", "src/pages/Community.tsx"]) assert.doesNotMatch(readFileSync(path, "utf8"), /isOfficial|is_official/);
});

test("attachment failure permits retry only after verified deletion", async () => {
  const mediaError = { message: "official_post_not_allowed" };
  await assert.rejects(
    rejectFailedOfficialMedia("post-a", mediaError, () => Promise.resolve({ data: { id: "post-a" }, error: null })),
    error => isOfficialPostError(error) && !(error instanceof OfficialPostPublicationUncertainError),
  );
});

test("failed, thrown or unconfirmed rollback requires checking the existing post", async () => {
  const requests = [
    () => Promise.resolve({ data: null, error: { message: "offline" } }),
    () => Promise.resolve({ data: null, error: null }),
    () => Promise.resolve({ data: { id: "another-post" }, error: null }),
    () => Promise.reject(Error("connection dropped")),
    () => { throw Error("request unavailable"); },
  ];
  for (const request of requests) {
    await assert.rejects(rejectFailedOfficialMedia("post-a", { message: "media failed" }, request),
      error => error instanceof OfficialPostPublicationUncertainError && error.postId === "post-a");
  }
});
