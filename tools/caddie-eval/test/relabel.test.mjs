// node --test tools/caddie-eval/test/relabel.test.mjs
// Audited capture relabeling, on temp folders and fake bytes only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addAnnotator, relabelClip, verifyDataDir } from "../import-clip.mjs";
import { TODAY, setupWithClip } from "./helpers.mjs";

const REASON = "participant confirmed 2026-10-24";

async function setup() {
  const s = await setupWithClip({ angle: "face_on" });
  addAnnotator(s.dataDir, "K00", TODAY);
  return s;
}

const manifestEntry = (dataDir, clipId) => JSON.parse(fs.readFileSync(path.join(dataDir, "manifest.json"), "utf8")).clips.find((c) => c.clipId === clipId);

test("relabel: changes capture fields, recomputes the slot, appends history, writes an audit event", async () => {
  const { dataDir, clipId } = await setup();
  const r = relabelClip(dataDir, clipId, { by: "K00", reason: REASON, changes: { angle: "down_the_line", club: "hybrid" } }, TODAY);
  assert.equal(r.protocolSlot.split("-").slice(0, 2).join("-"), "DTL-HY");
  const e = manifestEntry(dataDir, clipId);
  assert.equal(e.capture.angle, "down_the_line");
  assert.equal(e.capture.club, "hybrid");
  assert.deepEqual(e.captureHistory, [
    { version: 1, date: TODAY, by: "K00", reason: REASON, changes: { angle: { from: "face_on", to: "down_the_line" }, club: { from: "driver", to: "hybrid" } } },
  ]);
  const log = fs.readFileSync(path.join(dataDir, "audit-log.jsonl"), "utf8");
  assert.ok(log.includes('"action":"clip_relabeled"'));
  assert.deepEqual(await verifyDataDir(dataDir, TODAY), []);
});

test("relabel: a second correction appends (history is never rewritten) and chains", async () => {
  const { dataDir, clipId } = await setup();
  relabelClip(dataDir, clipId, { by: "K00", reason: REASON, changes: { angle: "down_the_line" } }, TODAY);
  relabelClip(dataDir, clipId, { by: "K00", reason: "second look at the clip", changes: { angle: "face_on" } }, TODAY);
  const h = manifestEntry(dataDir, clipId).captureHistory;
  assert.equal(h.length, 2);
  assert.deepEqual(h[0].changes.angle, { from: "face_on", to: "down_the_line" });
  assert.deepEqual(h[1].changes.angle, { from: "down_the_line", to: "face_on" });
  assert.deepEqual(await verifyDataDir(dataDir, TODAY), []);
});

test("relabel: refuses no-op changes, unknown fields, bad values, missing or unsafe reasons, unknown operators", async () => {
  const { dataDir, clipId } = await setup();
  assert.throws(() => relabelClip(dataDir, clipId, { by: "K00", reason: REASON, changes: { angle: "face_on" } }, TODAY), /nothing to change/);
  assert.throws(() => relabelClip(dataDir, clipId, { by: "K00", reason: REASON, changes: { storedFile: "x" } }, TODAY), /cannot relabel/);
  assert.throws(() => relabelClip(dataDir, clipId, { by: "K00", reason: REASON, changes: { angle: "sideways" } }, TODAY), /--angle must be one of/);
  assert.throws(() => relabelClip(dataDir, clipId, { by: "K00", reason: "", changes: { angle: "down_the_line" } }, TODAY), /--reason is required/);
  assert.throws(() => relabelClip(dataDir, clipId, { by: "K00", reason: "per jane@example.com", changes: { angle: "down_the_line" } }, TODAY), /--reason/);
  assert.throws(() => relabelClip(dataDir, clipId, { by: "K00", reason: "line one\nline two", changes: { angle: "down_the_line" } }, TODAY), /--reason/);
  assert.throws(() => relabelClip(dataDir, clipId, { by: "K01", reason: REASON, changes: { angle: "down_the_line" } }, TODAY), /annotator ID must be one of/);
  assert.throws(() => relabelClip(dataDir, "C001-9999", { by: "K00", reason: REASON, changes: { angle: "down_the_line" } }, TODAY), /not in the manifest/);
  const { dataDir: d2, clipId: c2 } = await setupWithClip();
  assert.throws(() => relabelClip(d2, c2, { by: "K00", reason: REASON, changes: { angle: "down_the_line" } }, TODAY), /no active annotator record/);
  assert.equal(manifestEntry(dataDir, clipId).captureHistory, undefined, "refusals change nothing");
});

test("verify: flags a capture value edited by hand outside relabel", async () => {
  const { dataDir, clipId } = await setup();
  relabelClip(dataDir, clipId, { by: "K00", reason: REASON, changes: { angle: "down_the_line" } }, TODAY);
  const file = path.join(dataDir, "manifest.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  m.clips[0].capture.angle = "unsuitable";
  fs.writeFileSync(file, JSON.stringify(m));
  const problems = await verifyDataDir(dataDir, TODAY);
  assert.ok(problems.some((p) => p.includes("capture.angle differs from its last recorded change")));
  assert.ok(problems.some((p) => p.includes("protocolSlot does not match capture")));
});
