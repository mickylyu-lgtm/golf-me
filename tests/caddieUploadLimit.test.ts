import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { caddieDurationRejection, MAX_CADDIE_UPLOAD_SECONDS, sourceDurationFromFfmpeg } from "../src/lib/caddieUploadLimit.ts";
import { createVideoSelectionGate, prepareVideoSelection } from "../src/lib/videoSelection.ts";

test("original source must be strictly under 10s, with no rounding loophole", () => {
  assert.equal(MAX_CADDIE_UPLOAD_SECONDS, 10);
  for (const d of [0.001, 4, 8, 9.99, 9.999999]) assert.equal(caddieDurationRejection(d), null);
  for (const d of [10, 10.000001, 10.01, 11, 60]) assert.equal(caddieDurationRejection(d), "too_long");
  for (const d of [undefined, null, NaN, Infinity, -Infinity, 0, -1, "9"]) assert.equal(caddieDurationRejection(d), "unreadable");
});

test("rejected files never reach copying or a ready-to-upload draft", async () => {
  for (const duration of [10, 10.001, 60, NaN, Infinity, 0]) {
    const gate = createVideoSelectionGate();
    let copies = 0;
    const result = await prepareVideoSelection({
      gate, token: gate.begin(), file: { name: "fixture.mov" },
      readDuration: async () => duration,
      stabilize: async (file) => { copies++; return file; },
    });
    assert.equal(result.kind, "rejected");
    assert.equal(copies, 0);
    assert.equal(gate.pending, false);
  }
});

test("duration read failures fail closed, valid short picks still become uploadable", async () => {
  const gate = createVideoSelectionGate();
  const rejected = await prepareVideoSelection({
    gate, token: gate.begin(), file: "bad",
    readDuration: async () => { throw new Error("metadata timeout"); },
    stabilize: async () => { throw new Error("must not copy"); },
  });
  assert.deepEqual(rejected, { kind: "rejected", reason: "unreadable" });
  const ready = await prepareVideoSelection({
    gate, token: gate.begin(), file: "short",
    readDuration: async () => 9.9, stabilize: async (file) => file,
  });
  assert.deepEqual(ready, { kind: "ready", file: "short", duration: 9.9 });
});

test("server reads the original container duration, not output/crop timestamps", () => {
  assert.equal(sourceDurationFromFfmpeg("Duration: 00:01:00.04, start: 0\nDuration: 00:00:05.00"), 60.04);
  assert.equal(caddieDurationRejection(sourceDurationFromFfmpeg("Duration: 00:00:10.00")), "too_long");
  assert.equal(caddieDurationRejection(sourceDurationFromFfmpeg("Duration: N/A")), "unreadable");
});

test("submit revalidates restored originals before Storage upload", () => {
  const src = readFileSync(new URL("../src/pages/AnalyzeSwing.tsx", import.meta.url), "utf8");
  const submit = src.slice(src.indexOf("async function handleAnalyze"));
  assert.ok(submit.indexOf("readVideoDuration(videoFile)") < submit.indexOf(".upload(path, videoFile"));
  assert.ok(submit.indexOf("caddieDurationRejection(duration)") < submit.indexOf(".upload(path, videoFile"));
  assert.ok(!src.includes("duration > MAX_SWING_VIDEO_SECONDS"), "no long-source trim-selector escape");
});

test("all visible English upload duration hints state the strict cutoff", () => {
  const locale = readFileSync(new URL("../src/i18n/locales/en.ts", import.meta.url), "utf8");
  for (const key of ["noVideoSelected", "recommendedLength", "videoTooLong", "durationUnreadable"]) {
    const line = locale.split("\n").find((text) => text.includes('"caddie.' + key + '"'))!;
    assert.ok(line.includes("under 10 seconds"), key);
    assert.ok(!line.includes("10 seconds max"), key);
  }
});
