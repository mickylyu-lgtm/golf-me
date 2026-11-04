// Run: npm run test:trust  (node --test, built-in type stripping)
// After createPost fails, CreatePost removes only the public community-media
// objects that attempt created, and only if no post row references them.
// Mocked Supabase client; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createdCommunityMediaPath, removeOrphanedCommunityMedia } from "../src/lib/communityMediaCleanup.ts";
import type { CleanupClient } from "../src/lib/communityMediaCleanup.ts";

const OWNER = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const BASE = "https://example.supabase.co/storage/v1/object/public/community-media/";
const UUID_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const UUID_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const videoUrl = `${BASE}${OWNER}/swing-${UUID_A}.mp4`;
const thumbUrl = `${BASE}${OWNER}/swing-thumb-${UUID_B}.jpg`;

interface Recorded {
  selects: Array<{ table: string; column: string; values: string[] }>;
  removed: Array<{ bucket: string; paths: string[] }>;
}

function mockClient(opts: { referenced?: Record<string, string[]>; selectError?: boolean; removeError?: boolean } = {}): { client: CleanupClient; rec: Recorded } {
  const rec: Recorded = { selects: [], removed: [] };
  const client: CleanupClient = {
    from(table: string) {
      return {
        select(column: string) {
          return {
            in(col: string, values: string[]) {
              rec.selects.push({ table, column: col, values });
              if (opts.selectError) return Promise.resolve({ data: null, error: { message: "offline" } });
              const hits = (opts.referenced?.[`${table}.${col}`] ?? []).filter((v) => values.includes(v));
              return Promise.resolve({ data: hits.map((v) => ({ [column]: v })), error: null });
            },
          };
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          remove(paths: string[]) {
            rec.removed.push({ bucket, paths });
            return Promise.resolve(opts.removeError ? { data: null, error: { message: "denied" } } : { data: paths, error: null });
          },
        };
      },
    },
  };
  return { client, rec };
}

const quiet = () => {};

test("deletes exactly the copies this attempt created, from community-media only", async () => {
  const { client, rec } = mockClient();
  const result = await removeOrphanedCommunityMedia(client, OWNER, [videoUrl, thumbUrl], quiet);
  assert.deepEqual(result.removed.sort(), [`${OWNER}/swing-${UUID_A}.mp4`, `${OWNER}/swing-thumb-${UUID_B}.jpg`].sort());
  assert.equal(rec.removed.length, 1);
  assert.equal(rec.removed[0].bucket, "community-media");
  // Reference check covered every column a post can point at media with.
  assert.deepEqual(
    rec.selects.map((s) => `${s.table}.${s.column}`).sort(),
    ["community_post_media.media_url", "community_post_media.thumbnail_url", "community_posts.image_url", "community_posts.video_thumbnail_url", "community_posts.video_url"],
  );
});

test("never deletes anything not created by this attempt's writers", async () => {
  const { client, rec } = mockClient();
  const notOurs = [
    `${BASE}${OTHER}/swing-${UUID_A}.mp4`, // someone else's folder
    `${BASE}${OWNER}/post-${UUID_A}.mp4`, // a photo/video attachment, not a swing copy
    `${BASE}${OWNER}/${UUID_A}.jpg`, // pre-existing image upload
    `${BASE}${OWNER}/nested/swing-${UUID_A}.mp4`, // unexpected nesting
    `${BASE}${OWNER}/swing-${UUID_A}.mp4/../x`, // traversal
    `https://example.supabase.co/storage/v1/object/sign/caddie-media/${OWNER}/caddie-${UUID_A}.mp4?token=x`, // private original
    `https://example.supabase.co/storage/v1/object/public/caddie-media/${OWNER}/swing-${UUID_A}.mp4`, // wrong bucket
    "",
  ];
  const result = await removeOrphanedCommunityMedia(client, OWNER, notOurs, quiet);
  assert.deepEqual(result, { removed: [], kept: [] });
  assert.equal(rec.selects.length, 0);
  assert.equal(rec.removed.length, 0);
});

test("keeps a copy a post row already references (insert landed, response lost)", async () => {
  const { client, rec } = mockClient({ referenced: { "community_posts.video_url": [videoUrl] } });
  const result = await removeOrphanedCommunityMedia(client, OWNER, [videoUrl, thumbUrl], quiet);
  assert.deepEqual(result.removed, [`${OWNER}/swing-thumb-${UUID_B}.jpg`]);
  assert.deepEqual(result.kept, [`${OWNER}/swing-${UUID_A}.mp4`]);
  assert.deepEqual(rec.removed[0].paths, [`${OWNER}/swing-thumb-${UUID_B}.jpg`]);
});

test("if the reference check fails, nothing is deleted", async () => {
  const { client, rec } = mockClient({ selectError: true });
  let logged = 0;
  const result = await removeOrphanedCommunityMedia(client, OWNER, [videoUrl], () => (logged += 1));
  assert.deepEqual(result, { removed: [], kept: [`${OWNER}/swing-${UUID_A}.mp4`] });
  assert.equal(rec.removed.length, 0);
  assert.equal(logged, 1);
});

test("a refused delete is reported as kept, never thrown", async () => {
  const { client } = mockClient({ removeError: true });
  const result = await removeOrphanedCommunityMedia(client, OWNER, [videoUrl], quiet);
  assert.deepEqual(result, { removed: [], kept: [`${OWNER}/swing-${UUID_A}.mp4`] });
});

test("path parsing: own swing copies with any short extension, case-insensitive", () => {
  assert.equal(createdCommunityMediaPath(`${BASE}${OWNER}/swing-${UUID_A}.MOV`, OWNER), `${OWNER}/swing-${UUID_A}.MOV`);
  assert.equal(createdCommunityMediaPath(`${BASE}${OWNER}/swing-${UUID_A}.mp4?t=1`, OWNER), `${OWNER}/swing-${UUID_A}.mp4`);
  assert.equal(createdCommunityMediaPath(`${BASE}${OWNER}/swing-${UUID_A}.mp4`, ""), null);
  assert.equal(createdCommunityMediaPath(undefined, OWNER), null);
});
