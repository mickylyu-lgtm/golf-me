// Run: node --test tests/followingFeed.test.ts  (also part of npm run test)
// Home's Following feed: RPC paging, fallback detection, merging with
// Community's loaded posts, the cutoff that keeps older items back while
// pages remain, the shared row mapper, and static guards on the migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FOLLOWING_FEED_PAGE_SIZE,
  FOLLOWING_FEED_RPC,
  appendPage,
  classifyFeedPage,
  cursorAfter,
  feedCutoff,
  followingFeedArgs,
  mergeFollowingPosts,
  withinCutoff,
} from "../src/lib/followingFeed.ts";
import { rowToPost } from "../src/lib/communityPostRow.ts";
import type { MediaRow, PostRow } from "../src/lib/communityPostRow.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const row = (id: string, created_at: string, extra: Partial<PostRow> = {}): PostRow => ({
  id,
  author_id: "a1",
  type: "text",
  text: `post ${id}`,
  image_url: null,
  video_url: null,
  video_thumbnail_url: null,
  course_tag: null,
  golf_call_id: null,
  category: "General",
  swing_analysis_status: "not_applicable",
  coach_review_requested: false,
  created_at,
  ...extra,
});

const post = (id: string, createdAt: string, authorId = "a1") => ({ id, authorId, createdAt });
const t = (hour: number) => `2026-11-${String(10 + Math.floor(hour / 24)).padStart(2, "0")}T${String(hour % 24).padStart(2, "0")}:00:00+00:00`;

// ---- RPC arguments and paging -------------------------------------------

test("first page sends only the limit; later pages send the keyset cursor", () => {
  assert.deepEqual(followingFeedArgs(null), { p_limit: FOLLOWING_FEED_PAGE_SIZE });
  assert.deepEqual(followingFeedArgs({ before: t(5), beforeId: "p5" }, 10), { p_before: t(5), p_before_id: "p5", p_limit: 10 });
});

test("cursorAfter is the oldest row, ties broken by the smallest id (the RPC's order)", () => {
  assert.equal(cursorAfter([]), null);
  assert.deepEqual(cursorAfter([row("b", t(3)), row("c", t(1)), row("a", t(1)), row("d", t(2))]), { before: t(1), beforeId: "a" });
});

test("appendPage keeps one row per id, newest copy wins, sorted newest first", () => {
  const merged = appendPage([row("x", t(5)), row("y", t(4), { text: "old" })], [row("y", t(4), { text: "new" }), row("z", t(3))]);
  assert.deepEqual(merged.map((r) => r.id), ["x", "y", "z"]);
  assert.equal(merged.find((r) => r.id === "y")?.text, "new");
});

test("classifyFeedPage: full page means maybe more, short page is the end", () => {
  const full = classifyFeedPage<PostRow>(Array.from({ length: 3 }, (_, i) => row(`p${i}`, t(i))), null, 3);
  assert.equal(full.kind, "rows");
  assert.equal(full.kind === "rows" && full.hasMore, true);
  const short = classifyFeedPage<PostRow>([row("p", t(1))], null, 3);
  assert.equal(short.kind === "rows" && short.hasMore, false);
  const none = classifyFeedPage<PostRow>(null, null, 3);
  assert.deepEqual(none, { kind: "rows", rows: [], hasMore: false });
});

test("classifyFeedPage: a missing function means fall back; any other error is an error", () => {
  assert.deepEqual(classifyFeedPage(null, { code: "PGRST202", message: "Could not find the function public.get_following_feed" }), { kind: "missing" });
  assert.deepEqual(classifyFeedPage(null, { code: "42883", message: "function public.get_following_feed() does not exist" }), { kind: "missing" });
  assert.deepEqual(
    classifyFeedPage(null, { message: `Could not find the function public.${FOLLOWING_FEED_RPC}(p_limit) in the schema cache` }),
    { kind: "missing" },
  );
  const failed = classifyFeedPage(null, { code: "57014", message: "canceling statement due to statement timeout" });
  assert.equal(failed.kind, "error");
  const denied = classifyFeedPage(null, { code: "42501", message: "permission denied for function get_following_feed" });
  assert.equal(denied.kind, "error");
});

// ---- Merging with Community -------------------------------------------

const following = new Set(["a1", "a2"]);
const always = () => true;

test("an old server post outside Community's loaded range is kept (the point of the RPC)", () => {
  const out = mergeFollowingPosts({
    serverPosts: [post("old", t(1))],
    contextPosts: [post("c1", t(10)), post("c2", t(8))],
    contextLoaded: true,
    followingIds: following,
    isVisible: always,
  });
  assert.deepEqual(out.map((p) => p.id), ["c1", "c2", "old"]);
});

test("a server post inside Community's range but missing from it was removed: dropped", () => {
  const out = mergeFollowingPosts({
    serverPosts: [post("gone", t(9)), post("c1", t(10))],
    contextPosts: [post("c1", t(10)), post("c2", t(8))],
    contextLoaded: true,
    followingIds: following,
    isVisible: always,
  });
  assert.deepEqual(out.map((p) => p.id), ["c1", "c2"]);
});

test("Community loaded and empty: every server post is treated as gone", () => {
  const out = mergeFollowingPosts({ serverPosts: [post("s", t(1))], contextPosts: [], contextLoaded: true, followingIds: following, isVisible: always });
  assert.deepEqual(out, []);
});

test("Community not loaded (or failed): server posts are trusted as they are", () => {
  const out = mergeFollowingPosts({
    serverPosts: [post("s1", t(9)), post("s2", t(1))],
    contextPosts: [post("c1", t(10)), post("c2", t(8))],
    contextLoaded: false,
    followingIds: following,
    isVisible: always,
  });
  assert.deepEqual(out.map((p) => p.id), ["c1", "s1", "c2", "s2"]);
});

test("a server post newer than Community's newest is kept until Community catches up", () => {
  const out = mergeFollowingPosts({ serverPosts: [post("fresh", t(12))], contextPosts: [post("c1", t(10))], contextLoaded: true, followingIds: following, isVisible: always });
  assert.deepEqual(out.map((p) => p.id), ["fresh", "c1"]);
});

test("Community's copy of a post wins over the server page's", () => {
  const server = { ...post("p", t(5)), text: "stale" };
  const context = { ...post("p", t(5)), text: "fresh" };
  const out = mergeFollowingPosts({ serverPosts: [server], contextPosts: [context], contextLoaded: true, followingIds: following, isVisible: always });
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "fresh");
});

test("unfollowed authors, blocks and hidden posts are re-applied without a refetch", () => {
  const out = mergeFollowingPosts({
    serverPosts: [post("unfollowed", t(1), "a9"), post("blocked", t(2), "a2"), post("hidden", t(3)), post("ok", t(4))],
    contextPosts: [post("ctx-unfollowed", t(20), "a9")],
    contextLoaded: false,
    followingIds: following,
    isVisible: (p) => p.authorId !== "a2" && p.id !== "hidden",
  });
  assert.deepEqual(out.map((p) => p.id), ["ok"]);
});

test("optimistic pending posts never define Community's range", () => {
  const out = mergeFollowingPosts({
    serverPosts: [post("s", t(2))],
    contextPosts: [post("pending-1", t(1)), post("c1", t(10))],
    contextLoaded: true,
    followingIds: following,
    isVisible: always,
  });
  // c1 alone sets the range (t10..t10), so the t2 server post is outside it and kept.
  assert.deepEqual(out.map((p) => p.id), ["c1", "s"]);
});

// ---- Cutoff (keeps the feed in order while pages remain) ----------------

test("feedCutoff is the oldest loaded server post while more pages exist, else none", () => {
  const loaded = [post("a", t(9)), post("b", t(4)), post("c", t(6))];
  assert.equal(feedCutoff(loaded, true), t(4));
  assert.equal(feedCutoff(loaded, false), null);
  assert.equal(feedCutoff([], true), null);
});

test("withinCutoff holds back older rounds and posts until their page is loaded", () => {
  const items = [
    { key: "post-new", at: t(9) },
    { key: "round-mid", at: t(5) },
    { key: "post-edge", at: t(4) },
    { key: "round-old", at: t(1) },
  ];
  assert.deepEqual(withinCutoff(items, t(4)).map((i) => i.key), ["post-new", "round-mid", "post-edge"]);
  assert.deepEqual(withinCutoff(items, null).map((i) => i.key), ["post-new", "round-mid", "post-edge", "round-old"]);
});

// ---- Shared row mapper ------------------------------------------------

test("rowToPost maps an RPC row exactly like a community_posts row (media ordered, nulls dropped)", () => {
  const media: MediaRow[] = [
    { id: "m2", post_id: "p1", media_type: "video", media_url: "v.mp4", thumbnail_url: null, position: 1 },
    { id: "m1", post_id: "p1", media_type: "image", media_url: "i.jpg", thumbnail_url: "t.jpg", position: 0 },
    { id: "m3", post_id: "other", media_type: "image", media_url: "x.jpg", thumbnail_url: null, position: 0 },
  ];
  const mapped = rowToPost(row("p1", t(1), { type: "swing", swing_analysis_status: "pending", is_official: true, golf_call_id: "g1" }), media);
  assert.deepEqual(mapped.media, [
    { id: "m1", type: "image", url: "i.jpg", thumbnailUrl: "t.jpg" },
    { id: "m2", type: "video", url: "v.mp4", thumbnailUrl: undefined },
  ]);
  assert.equal(mapped.isOfficial, true);
  assert.equal(mapped.swingAnalysisStatus, "pending");
  assert.equal(mapped.golfCallId, "g1");
  assert.equal(mapped.imageUrl, undefined);
  const plain = rowToPost(row("p2", t(1)), media);
  assert.equal(plain.media, undefined);
  assert.equal(plain.swingAnalysisStatus, undefined);
  assert.equal(plain.isOfficial, false);
});

// ---- Wiring and migration guards ---------------------------------------

test("Home uses the server feed for real accounts only and keeps a filtered supplemental list", () => {
  const home = read("src/pages/Home.tsx");
  assert.match(home, /useFollowingFeed\(!isDemo && Boolean\(authUser\)/);
  assert.match(home, /allPosts\.filter\(\(post\) => followingIds\.has\(post\.authorId\)\)/);
  const hook = read("src/lib/useFollowingFeed.ts");
  assert.match(hook, /result\.kind === "missing"[\s\S]*markMissing[\s\S]*setState\(LOCAL\)/);
});

test("the migration is invoker, pinned search_path, authenticated-only, and indexed", () => {
  const sql = read("supabase/migrations/20261116120000_following_feed.sql");
  const body = sql.replace(/^--.*$/gm, "");
  assert.match(body, /create or replace function public\.get_following_feed\(\s*p_before timestamptz default null,\s*p_limit integer default 20,\s*p_before_id uuid default null\s*\)/);
  assert.match(body, /returns setof public\.community_posts/);
  assert.match(body, /security invoker/);
  assert.doesNotMatch(body, /security definer/);
  assert.match(body, /set search_path = ''/);
  assert.match(body, /revoke execute on function public\.get_following_feed\(timestamptz, integer, uuid\) from public, anon;/);
  assert.match(body, /grant execute on function public\.get_following_feed\(timestamptz, integer, uuid\) to authenticated;/);
  assert.doesNotMatch(body, /to anon/);
  assert.match(body, /create index if not exists community_posts_author_created_idx\s+on public\.community_posts \(author_id, created_at desc, id desc\)/);
  // Every visibility rule the posts policy doesn't cover is re-applied.
  assert.match(body, /f\.follower_id = \(select auth\.uid\(\)\) and f\.following_id = p\.author_id/);
  assert.match(body, /b\.blocker_id = \(select auth\.uid\(\)\) and b\.blocked_id = p\.author_id/);
  assert.match(body, /b\.blocker_id = p\.author_id and b\.blocked_id = \(select auth\.uid\(\)\)/);
  assert.match(body, /h\.owner_id = \(select auth\.uid\(\)\) and h\.post_id = p\.id/);
  assert.match(body, /order by p\.created_at desc, p\.id desc/);
  assert.match(body, /limit least\(greatest\(coalesce\(p_limit, 20\), 1\), 50\)/);
});
