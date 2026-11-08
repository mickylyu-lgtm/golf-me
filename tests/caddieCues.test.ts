// Run: npm run test:caddie  (node --test, built-in type stripping)
// analyze-swing / translate-caddie-analysis write, and the client re-reads,
// analysis_json.checkpoint_cues through these same helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUE_HARD_MAX_CHARS,
  CUE_MAX_CHARS,
  placedCueCheckpoints,
  sanitizeCheckpointCues,
  sanitizeCue,
  sanitizeWorkOnCheckpoint,
  WORK_ON_CHECKPOINTS,
  withSanitizedCheckpointCues,
  withSanitizedWorkOnCheckpoints,
} from "../supabase/functions/_shared/caddieCues.ts";

const ALL_PLACED = {
  address: { timestamp_seconds: 0.4, confidence: "high" },
  backswing: { timestamp_seconds: 0.8, confidence: "high" },
  top: { timestamp_seconds: 1.3, confidence: "high" },
  downswing: { timestamp_seconds: 1.5, confidence: "high" },
  impact: { window_start_seconds: 1.6, window_end_seconds: 1.7, confidence: "high" },
  follow_through: { timestamp_seconds: 2.1, confidence: "high" },
};

test("sanitizeCue: plain cue kept, whitespace collapsed", () => {
  assert.equal(sanitizeCue("  Keep your\n head  quiet  "), "Keep your head quiet");
});

test("sanitizeCue: non-strings, empty and markdown-only values are dropped", () => {
  for (const v of [undefined, null, 3, {}, [], "", "   ", "**", "- ", "``"]) assert.equal(sanitizeCue(v), null, String(v));
});

test("sanitizeCue: markdown and HTML are stripped to plain text", () => {
  assert.equal(sanitizeCue("**Turn** your _hips_ first"), "Turn your hips first");
  assert.equal(sanitizeCue("- Feel the `lead` arm stay long"), "Feel the lead arm stay long");
  assert.equal(sanitizeCue("## Hold the finish"), "Hold the finish");
  assert.equal(sanitizeCue("1. Stay in your posture"), "Stay in your posture");
  assert.equal(sanitizeCue("<b>Chest</b> to target"), "Chest to target");
  assert.equal(sanitizeCue('"Stay tall"'), "Stay tall");
});

test("sanitizeCue: a cue carrying a link is dropped, not cleaned", () => {
  assert.equal(sanitizeCue("See [this drill](https://example.com)"), null);
  assert.equal(sanitizeCue("Watch www.example.com"), null);
});

test("sanitizeCue: a cue a little over the target is shown whole, never with an ellipsis", () => {
  const long = "Rotate shoulders around a centered head position without sliding laterally away from the target.";
  assert.ok(Array.from(long).length > CUE_MAX_CHARS);
  assert.equal(sanitizeCue(long), long);
});

test("sanitizeCue: a very long cue keeps whole sentences, or is dropped", () => {
  const two = "Keep your head centered over the ball. " + "Let the lead hip clear first and keep your chest over the ball a beat longer so the arms can follow through freely and finish tall.";
  assert.ok(Array.from(two).length > CUE_HARD_MAX_CHARS);
  assert.equal(sanitizeCue(two), "Keep your head centered over the ball.");
  const oneRunOn = "Let your lead hip clear first and keep your chest over the ball a beat longer so the arms can follow through and finish high with balance on the lead side every time you swing";
  assert.ok(Array.from(oneRunOn).length > CUE_HARD_MAX_CHARS);
  assert.equal(sanitizeCue(oneRunOn), null);
  assert.equal(sanitizeCue("保".repeat(200)), null);
  assert.equal(sanitizeCue("保持头部稳定"), "保持头部稳定");
});

test("sanitizeCue: a cue already cut short by an older version is hidden", () => {
  assert.equal(sanitizeCue("Rotate shoulders around a centered head position without sliding laterally away from…"), null);
  assert.equal(sanitizeCue("Keep turning..."), null);
});

test("sanitizeCheckpointCues: unknown keys dropped, bad values dropped, all-bad is undefined", () => {
  assert.deepEqual(sanitizeCheckpointCues({ address: "Soft knees", finish: "x", backswing: "y", top: "", impact: 4 }), { address: "Soft knees" });
  assert.equal(sanitizeCheckpointCues({ top: "", impact: null }), undefined);
  for (const v of [undefined, null, "Turn", ["Turn"], 7]) assert.equal(sanitizeCheckpointCues(v), undefined);
});

test("sanitizeCheckpointCues: a cue for a moment the analysis didn't place is dropped", () => {
  const placed = placedCueCheckpoints({ ...ALL_PLACED, top: { timestamp_seconds: null, confidence: null } });
  assert.deepEqual(sanitizeCheckpointCues({ address: "A", top: "T", impact: "I", follow_through: "F" }, placed), { address: "A", impact: "I", follow_through: "F" });
});

test("placedCueCheckpoints: needs a timestamp (or both window ends for impact)", () => {
  assert.deepEqual([...placedCueCheckpoints(ALL_PLACED)].sort(), ["address", "follow_through", "impact", "top"]);
  assert.deepEqual([...placedCueCheckpoints({ impact: { window_start_seconds: 1.6, window_end_seconds: null } })], []);
  assert.deepEqual([...placedCueCheckpoints(undefined)], []);
});

test("withSanitizedCheckpointCues: keeps every other field, rewrites or removes the cue field", () => {
  const base = { summary: "s", phases: ALL_PLACED, score: { finish: { points: 10, reason: "r" } } };
  const kept = withSanitizedCheckpointCues({ ...base, checkpoint_cues: { top: "**Full** turn", nope: "x" } });
  assert.deepEqual(kept, { ...base, checkpoint_cues: { top: "Full turn" } });

  const dropped = withSanitizedCheckpointCues({ ...base, checkpoint_cues: { top: "   " } });
  assert.deepEqual(dropped, base);
  assert.ok(!("checkpoint_cues" in dropped));

  // An old-style response with no cues is returned unchanged.
  assert.deepEqual(withSanitizedCheckpointCues(base), base);
  // Garbage never throws.
  assert.deepEqual(withSanitizedCheckpointCues({ ...base, checkpoint_cues: "Turn" }), base);
});

// ── work_on[].checkpoint ────────────────────────────────────────────────

test("sanitizeWorkOnCheckpoint: only the five known values, case/whitespace tolerant", () => {
  for (const v of WORK_ON_CHECKPOINTS) assert.equal(sanitizeWorkOnCheckpoint(v), v);
  assert.equal(sanitizeWorkOnCheckpoint(" Impact "), "impact");
  for (const v of [undefined, null, "", "backswing", "finish", "followThrough", 3, {}, ["top"]]) assert.equal(sanitizeWorkOnCheckpoint(v), undefined, String(v));
});

test("withSanitizedWorkOnCheckpoints: keeps valid tags, removes invalid ones, never drops an item", () => {
  const json = {
    summary: "s",
    work_on: [
      { issue: "a", why_it_matters: "x", confidence: "high", checkpoint: "top" },
      { issue: "b", why_it_matters: "y", confidence: "medium", checkpoint: "downswing" },
      { issue: "c", why_it_matters: "z", confidence: "low" },
      "not an object",
    ],
  };
  assert.deepEqual(withSanitizedWorkOnCheckpoints(json), {
    summary: "s",
    work_on: [
      { issue: "a", why_it_matters: "x", confidence: "high", checkpoint: "top" },
      { issue: "b", why_it_matters: "y", confidence: "medium" },
      { issue: "c", why_it_matters: "z", confidence: "low" },
      "not an object",
    ],
  });
  // A malformed work_on is left for analyze-swing's own shape check, untouched.
  assert.deepEqual(withSanitizedWorkOnCheckpoints({ work_on: "nope" }), { work_on: "nope" });
  assert.deepEqual(withSanitizedWorkOnCheckpoints({ summary: "s" }), { summary: "s" });
});
