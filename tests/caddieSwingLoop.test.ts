// The Caddie processing screen's swing loop (src/lib/caddieSwingLoop.ts):
// SMIL needs matching, ordered keyframe lists with one path layout, and the
// figure must stay a believable body (fixed limb lengths, club not through
// the turf) through every sampled frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUND_Y, LOOP_S, PHASE_TIMES, bonesPath, clubPath, jointsPath, sampleTimes, skeletonAt, smilTrack } from "../src/lib/caddieSwingLoop.ts";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test("keyframe lists line up and run 0 to 1 in order", () => {
  for (const map of [bonesPath, jointsPath, clubPath]) {
    const track = smilTrack(map);
    const kts = track.keyTimes.split(";").map(Number);
    const values = track.values.split(";");
    assert.equal(kts.length, values.length);
    assert.equal(kts[0], 0);
    assert.equal(kts[kts.length - 1], 1);
    for (let i = 1; i < kts.length; i++) assert.ok(kts[i] > kts[i - 1], `keyTimes increase at ${i}`);
    // SMIL interpolates path data only between identical command layouts.
    const layout = (d: string) => d.replace(/[-\d.]+/g, "#");
    assert.ok(values.every((v) => layout(v) === layout(values[0])));
  }
});

test("the loop ends on the finish it held, not on the next address", () => {
  const track = smilTrack(clubPath).values.split(";");
  assert.equal(track[track.length - 1], clubPath(skeletonAt(PHASE_TIMES.finish)));
  assert.notEqual(track[track.length - 1], track[0]);
});

test("limbs keep their length and the club stays out of the ground", () => {
  const first = skeletonAt(0);
  const upper = dist(first.leadShoulder, first.leadElbow);
  const fore = dist(first.leadElbow, first.hands);
  const club = dist(first.hands, first.clubHead);
  for (const t of sampleTimes()) {
    const s = skeletonAt(Math.min(t, LOOP_S - 1e-6));
    assert.ok(Math.abs(dist(s.leadShoulder, s.leadElbow) - upper) < 0.01, `lead upper arm at ${t}`);
    assert.ok(Math.abs(dist(s.leadElbow, s.hands) - fore) < 0.01, `lead forearm at ${t}`);
    assert.ok(Math.abs(dist(s.hands, s.clubHead) - club) < 0.01, `club at ${t}`);
    // The trail arm reaches the grip without stretching past full length.
    assert.ok(dist(s.trailShoulder, s.trailElbow) + dist(s.trailElbow, s.hands) <= upper + fore + 0.05, `trail arm at ${t}`);
    assert.ok(Math.abs(dist(s.trailElbow, s.hands) - fore) < 0.05 || dist(s.trailShoulder, s.hands) > upper + fore - 0.1, `trail forearm at ${t}`);
    assert.ok(s.clubHead.y <= GROUND_Y + 1.5, `club head above the turf at ${t} (${s.clubHead.y.toFixed(1)})`);
  }
});

test("the swing moves in the right order: back to the trail side, through to the target", () => {
  const address = skeletonAt(PHASE_TIMES.address);
  const top = skeletonAt(PHASE_TIMES.top);
  const finish = skeletonAt(PHASE_TIMES.finish);
  assert.ok(top.hands.x < address.hands.x - 15 && top.hands.y < address.hands.y - 40);
  assert.ok(finish.hands.x > address.hands.x && finish.hands.y < address.hands.y - 40);
});
