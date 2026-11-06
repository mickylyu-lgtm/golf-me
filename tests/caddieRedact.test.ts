// Run: npm run test:caddie  (node --test, built-in type stripping)
// The safety net under every Caddie failure detail that reaches a row, a
// diagnostics record or a log line (supabase/functions/_shared/caddieReliability.ts),
// and the extract-frames / trim-video error contract (classified tokens,
// never ffmpeg stderr).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatFailure, providerErrorHint, redactDetail, safeErrorName } from "../supabase/functions/_shared/caddieReliability.ts";
import { FfmpegError as ExtractFfmpegError, classifyFfmpegFailure as classifyExtract } from "../api/extract-frames.ts";
import { FfmpegError as TrimFfmpegError, classifyFfmpegFailure as classifyTrim } from "../api/trim-video.ts";

const FAKE_KEY = "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE123";

test("URLs, key/token params and bearer tokens never survive", () => {
  const raw =
    `error sending request for url (https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?key=${FAKE_KEY}): ` +
    "connection reset; also https://abc.supabase.co/storage/v1/object/sign/caddie-media/u/v.mov?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig123456 " +
    "Authorization: Bearer abc.def-ghi token=zzz key=yyy";
  const out = redactDetail(raw, 1000);
  assert.doesNotMatch(out, /AIza|googleapis|supabase\.co|eyJ|abc\.def|zzz|yyy/);
  assert.match(out, /\[url\]/);
  assert.match(out, /Bearer \[redacted\]/);
  assert.match(out, /token=\[redacted\]/);
  assert.match(out, /key=\[redacted\]/);
});

test("a bare API key or JWT is caught even without a URL around it", () => {
  assert.doesNotMatch(redactDetail(`bad key ${FAKE_KEY} here`), /AIza/);
  assert.doesNotMatch(redactDetail("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefgh"), /eyJ/);
});

test("video metadata, coordinates, paths, ids and emails are removed", () => {
  const ffmpegLike =
    "Input #0, mov,mp4 from '/tmp/swing-frames-x/input.mov':\\n    com.apple.quicktime.location.ISO6709: +40.7128-074.0060+010.000/\\n" +
    "    com.apple.quicktime.make: Apple\\n    creation_time   : 2026-11-04T13:59:00Z\\n" +
    "owner 11111111-2222-3333-4444-555555555555 golfer@example.com";
  const out = redactDetail(ffmpegLike, 1000);
  assert.doesNotMatch(out, /40\.7128|074\.0060|Apple|2026-11-04T13|swing-frames|11111111-2222|golfer@example/);
});

test("output is single-line and length-capped", () => {
  const out = redactDetail(`a\n\nb ${"x".repeat(1000)}`, 50);
  assert.ok(out.length <= 50);
  assert.doesNotMatch(out, /\n/);
  assert.equal(redactDetail(null), "");
  assert.equal(redactDetail(undefined), "");
});

test("formatFailure redacts the detail at the sink", () => {
  const msg = formatFailure("unknown", `Gemini call threw: fetch https://x.googleapis.com/a?key=${FAKE_KEY}`);
  assert.match(msg, /^code:unknown /);
  assert.doesNotMatch(msg, /AIza|googleapis/);
});

test("safeErrorName returns the class only, never the message", () => {
  const err = new TypeError(`error sending request for url (https://x.example/?key=${FAKE_KEY})`);
  assert.equal(safeErrorName(err), "TypeError");
  assert.equal(safeErrorName(new SyntaxError("Unexpected token in JSON: secret text")), "SyntaxError");
  const odd = new Error("x");
  odd.name = "weird name with spaces https://x";
  assert.equal(safeErrorName(odd), "Error");
  assert.equal(safeErrorName("string thrown"), "string");
});

test("providerErrorHint keeps allow-listed tokens only", () => {
  assert.equal(providerErrorHint(JSON.stringify({ error: "decode_failed" })), "decode_failed");
  assert.equal(
    providerErrorHint(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for key AIza..." } })),
    "RESOURCE_EXHAUSTED,quota_or_credit",
  );
  assert.equal(providerErrorHint('{"message":"credit_cap_exceeded"}'), "quota_or_credit");
  assert.equal(providerErrorHint("<html>Bad gateway</html>"), "");
  assert.equal(providerErrorHint(""), "");
  // An old extract-frames body with ffmpeg stderr: nothing of it survives.
  const old = JSON.stringify({ error: "ffmpeg exited 1: com.apple.quicktime.location.ISO6709: +40.71-074.00/" });
  assert.equal(providerErrorHint(old), "");
});

test("extract-frames and trim-video classify ffmpeg failures into tokens", () => {
  for (const [FfmpegError, classify] of [
    [ExtractFfmpegError, classifyExtract],
    [TrimFfmpegError, classifyTrim],
  ] as const) {
    assert.deepEqual(classify(new FfmpegError(1, null, "x: Invalid data found when processing input")), { status: 422, token: "decode_failed" });
    assert.deepEqual(classify(new FfmpegError(1, null, "moov atom not found")), { status: 422, token: "decode_failed" });
    assert.deepEqual(classify(new FfmpegError(1, null, "Stream map '0:v' matches no streams.")), { status: 422, token: "no_video_stream" });
    assert.deepEqual(classify(new FfmpegError(null, "SIGKILL", "")), { status: 500, token: "resources_exhausted" });
    assert.deepEqual(classify(new FfmpegError(1, null, "something else")), { status: 500, token: "internal" });
    assert.deepEqual(classify(new Error("boom")), { status: 500, token: "internal" });
    // The error object itself never carries stderr in its message.
    assert.equal(new FfmpegError(1, null, "com.apple.quicktime.location.ISO6709: +40.71-074.00/").message, "ffmpeg failed");
  }
});
