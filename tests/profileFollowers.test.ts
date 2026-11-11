import { test } from "node:test";
import assert from "node:assert/strict";
import { collectFollowerIds, filterProfileFollowers } from "../src/lib/profileFollowers.ts";
import type { GolferProfile } from "../src/types/index.ts";
const golfers = [
  { id: "a", name: "Alex Green", username: "alex" },
  { id: "b", name: "Bea Park", username: "bea" },
  { id: "c", name: "Cam Hill", username: "cam" },
] as GolferProfile[];
const follows = (id: string) => id !== "a";
const blocked = (id: string) => id === "c";

test("followers exclude blocked profiles; mutuals are viewer-followed followers", () => {
  assert.deepEqual(filterProfileFollowers(golfers, "", false, follows, blocked).map((g) => g.id), ["a", "b"]);
  assert.deepEqual(filterProfileFollowers(golfers, "", true, follows, blocked).map((g) => g.id), ["b"]);
});
test("search supports name, username, whitespace and @ prefix", () => {
  assert.equal(filterProfileFollowers(golfers, " GREEN ", false, follows, blocked)[0]?.id, "a");
  assert.equal(filterProfileFollowers(golfers, "@BeA", true, follows, blocked)[0]?.id, "b");
  assert.deepEqual(filterProfileFollowers(golfers, "cam", false, follows, blocked), []);
  assert.deepEqual(filterProfileFollowers(golfers, "unknown", false, follows, blocked), []);
});
test("follow paging crosses the API row cap and deduplicates", async () => {
  const source = Array.from({ length: 1234 }, (_, i) => `g${i}`);
  source[210] = source[0];
  const offsets: number[] = [];
  const ids = await collectFollowerIds(async (offset, size) => { offsets.push(offset); return source.slice(offset, offset + size); });
  assert.equal(ids.length, 1233);
  assert.equal(ids.at(-1), "g1233");
  assert.deepEqual(offsets, [0, 200, 400, 600, 800, 1000, 1200]);
});
test("exact page boundary and empty result complete correctly", async () => {
  const offsets: number[] = [];
  assert.equal((await collectFollowerIds(async (offset, size) => { offsets.push(offset); return offset === 0 ? Array.from({ length: size }, (_, i) => String(i)) : []; })).length, 200);
  assert.deepEqual(offsets, [0, 200]);
  assert.deepEqual(await collectFollowerIds(async () => []), []);
});
test("partial fetch errors remain errors instead of a misleading short list", async () => {
  await assert.rejects(collectFollowerIds(async (offset, size) => { if (offset) throw new Error("offline"); return Array.from({ length: size }, (_, i) => String(i)); }), /offline/);
});
