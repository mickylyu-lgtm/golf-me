// api/chat-video.ts: request rules, the trim window, the probe parser, the
// ffmpeg arguments, and the real pipeline on synthetic fixtures made here
// with ffmpeg-static (never real user media): an iPhone-like HDR HEVC
// 10-bit HLG clip with a QuickTime location (©xyz) and title, a rotated SDR
// clip, and a 65 s clip. The outputs must carry no metadata boxes at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPathImport from "ffmpeg-static";
import {
  STRIP_METADATA_ARGS,
  buildPosterArgs,
  buildTranscodeArgs,
  chooseWindow,
  metadataBoxes,
  mp4Info,
  neutralizeMetadataBoxes,
  outputPaths,
  parseChatVideoRequest,
  parseProbe,
  posterTime,
  runFfmpeg,
  transcodeLocal,
  videoFilter,
} from "../api/chat-video.ts";
import { jpegMetadataSegments } from "../src/lib/chatImages.ts";

const ffmpegPath = ffmpegPathImport as unknown as string;
const U = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const M = "33333333-3333-4333-8333-333333333333";

test("request: valid body, staged path bound to the caller and the item", () => {
  const r = parseChatVideoRequest({ scope: "dm", scopeId: S, messageId: M, index: 2, stagedPath: `${U}/${M}-2.orig`, trim: { startMs: 1000, endMs: 5000 } }, U);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(outputPaths(r.value), { videoPath: `dm/${S}/${M}/2.mp4`, posterPath: `dm/${S}/${M}/2.poster.jpg` });
  const bad = [
    { scope: "dm", scopeId: S, messageId: M, index: 2, stagedPath: `${S}/${M}-2.orig` }, // someone else's folder
    { scope: "dm", scopeId: S, messageId: M, index: 1, stagedPath: `${U}/${M}-2.orig` }, // other item
    { scope: "dm", scopeId: S, messageId: M, index: 10, stagedPath: `${U}/${M}-10.orig` },
    { scope: "post", scopeId: S, messageId: M, index: 0, stagedPath: `${U}/${M}-0.orig` },
    { scope: "dm", scopeId: "x", messageId: M, index: 0, stagedPath: `${U}/${M}-0.orig` },
    { scope: "dm", scopeId: S, messageId: M, index: 0, stagedPath: `${U}/${M}-0.orig`, trim: { startMs: 5, endMs: 1 } },
    { scope: "dm", scopeId: S, messageId: M, index: 0, stagedPath: `../${U}/${M}-0.orig` },
  ];
  for (const b of bad) assert.equal(parseChatVideoRequest(b, U).ok, false, JSON.stringify(b));
});

test("window: the trim, clamped to the clip and to 60 s", () => {
  assert.deepEqual(chooseWindow(30_000, null), { startS: 0, lengthS: 30 });
  assert.deepEqual(chooseWindow(180_000, null), { startS: 0, lengthS: 60 });
  assert.deepEqual(chooseWindow(180_000, { startMs: 100_000, endMs: 170_000 }), { startS: 100, lengthS: 60 });
  assert.deepEqual(chooseWindow(20_000, { startMs: 15_000, endMs: 40_000 }), { startS: 15, lengthS: 5 });
  assert.deepEqual(chooseWindow(null, { startMs: 2_000, endMs: 9_000 }), { startS: 2, lengthS: 7 });
  assert.equal(posterTime(0.2) < 0.2, true);
  assert.equal(posterTime(30), 0.5);
});

test("probe: HLG / PQ / SDR / audio / size", () => {
  const hlg = parseProbe(`  Duration: 00:01:02.50, start: 0.000000, bitrate: 1 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080, 9000 kb/s, 29.97 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s`);
  assert.equal(hlg.durationMs, 62_500);
  assert.equal(hlg.hdr, "hlg");
  assert.equal(hlg.hasAudio, true);
  assert.equal(hlg.tenBit, true);
  assert.deepEqual([hlg.width, hlg.height], [1920, 1080]);
  const pq = parseProbe(`Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084, progressive), 3840x2160`);
  assert.equal(pq.hdr, "pq");
  assert.equal(pq.hasAudio, false);
  const sdr = parseProbe(`Duration: 00:00:05.00,\n  Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1280x720 [SAR 1:1 DAR 16:9]`);
  assert.equal(sdr.hdr, null);
  assert.equal(sdr.transfer, "bt709");
  assert.equal(parseProbe("garbage").hasVideo, false);
});

test("arguments: tonemap for HDR, fallback without zimg, metadata stripped, one video + one audio stream", () => {
  const all = { zscale: true, tonemap: true, colorspace: true };
  assert.match(videoFilter({ hdr: "hlg", primaries: "bt2020", matrix: "bt2020nc" }, all), /zscale=tin=arib-std-b67.*tonemap=tonemap=hable.*format=yuv420p$/);
  assert.match(videoFilter({ hdr: "pq", primaries: "bt2020", matrix: "bt2020nc" }, all), /tin=smpte2084/);
  const fallback = videoFilter({ hdr: "hlg", primaries: "bt2020", matrix: "bt2020nc" }, { zscale: false, tonemap: false, colorspace: true });
  assert.match(fallback, /colorspace=all=bt709/);
  assert.doesNotMatch(fallback, /zscale/);
  assert.doesNotMatch(videoFilter({ hdr: null, primaries: "bt709", matrix: "bt709" }, all), /zscale|tonemap|colorspace=/);
  const args = buildTranscodeArgs({ input: "in", output: "out.mp4", window: { startS: 1.5, lengthS: 10 }, probe: { hdr: null, primaries: null, matrix: null, hasAudio: true }, filters: all });
  const s = args.join(" ");
  for (const needle of ["-map 0:v:0", "-map 0:a:0?", "-c:v libx264 -profile:v high", "-maxrate 2500k", "-movflags +faststart", "-map_metadata -1", "-map_metadata:s -1", "-map_chapters -1", "-fflags +bitexact", "-sn -dn", "-ss 1.500", "-t 10.000", "-fpsmax 30"]) {
    assert.ok(s.includes(needle), needle);
  }
  assert.ok(buildPosterArgs({ input: "a", output: "b.jpg", atS: 0.5 }).join(" ").includes(STRIP_METADATA_ARGS.join(" ")));
});

const haveFfmpeg = Boolean(ffmpegPath) && existsSync(ffmpegPath);

async function fixture(dir: string, name: string, args: string[]): Promise<string> {
  const out = path.join(dir, name);
  await runFfmpeg(["-hide_banner", "-nostdin", "-y", ...args, out]);
  return out;
}
const probeFile = async (file: string) => runFfmpeg(["-hide_banner", "-nostdin", "-i", file], { allowFailure: true });

test("pipeline: HDR HEVC with a fake GPS location -> SDR H.264, no metadata boxes, poster without EXIF", { skip: !haveFfmpeg, timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "chat-video-test-"));
  try {
    const input = await fixture(dir, "hdr.mov", [
      "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440",
      "-t", "3",
      "-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error",
      "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc",
      "-c:a", "aac",
      "-metadata", "location=+40.6892-074.0445/", "-metadata", "title=secret-title", "-metadata", "make=Apple",
      "-movflags", "use_metadata_tags",
      "-f", "mov",
    ]);
    const inputBytes = new Uint8Array(await readFile(input));
    // Positive control: the fixture really carries the location atom.
    const before = metadataBoxes(inputBytes);
    assert.ok(before.some((p) => p.includes("udta") || p.includes("meta")), JSON.stringify(before));
    assert.ok(Buffer.from(inputBytes).includes(Buffer.from("+40.6892-074.0445")), "fixture has the GPS string");
    assert.equal(parseProbe(await probeFile(input)).hdr, "hlg");

    const r = await transcodeLocal({ input, workDir: dir, trim: null });
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const out = new Uint8Array(await readFile(r.video));
    assert.deepEqual(metadataBoxes(out), [], "no udta/meta/©xyz/XMP boxes");
    assert.equal(Buffer.from(out).includes(Buffer.from("+40.6892")), false, "no GPS bytes anywhere");
    assert.equal(Buffer.from(out).includes(Buffer.from("secret-title")), false);
    assert.equal(Buffer.from(out).includes(Buffer.from("Lavf")), false, "no encoder tag");
    assert.deepEqual([r.info.width, r.info.height], [1280, 720]);
    assert.ok(Math.abs(r.info.durationMs - 3000) < 150, String(r.info.durationMs));
    const outProbe = await probeFile(r.video);
    assert.match(outProbe, /Video: h264 \(High\)/);
    assert.match(outProbe, /yuv420p\(tv, bt709/);
    assert.equal(parseProbe(outProbe).hdr, null);
    assert.doesNotMatch(outProbe, /location|secret-title|make\s*:/);
    // faststart: moov before mdat
    const top = (await import("../api/chat-video.ts")).mp4Boxes(out).filter((b) => !b.path.includes("/")).map((b) => b.type);
    assert.ok(top.indexOf("moov") < top.indexOf("mdat"), top.join(","));
    const poster = new Uint8Array(await readFile(r.poster));
    const seg = jpegMetadataSegments(poster);
    assert.equal(seg.isJpeg, true);
    assert.equal(seg.exif, false);
    assert.equal(seg.xmp, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pipeline: a rotated portrait clip stays portrait; a 65 s clip becomes 60 s; a trim window is honoured", { skip: !haveFfmpeg, timeout: 180_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "chat-video-test-"));
  try {
    const flat = await fixture(dir, "flat.mp4", ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]);
    const rotated = await fixture(dir, "rot.mp4", ["-display_rotation", "90", "-i", flat, "-c", "copy"]);
    const rot = await transcodeLocal({ input: rotated, workDir: dir, trim: null });
    assert.equal(rot.ok, true);
    if (rot.ok) assert.ok(rot.info.height > rot.info.width, JSON.stringify(rot.info));
    assert.deepEqual(rot.ok ? metadataBoxes(new Uint8Array(await readFile(rot.video))) : ["x"], []);

    const long = await fixture(dir, "long.mp4", ["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", "-f", "lavfi", "-i", "sine", "-t", "65", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest"]);
    const capped = await transcodeLocal({ input: long, workDir: dir, trim: null });
    assert.equal(capped.ok, true);
    if (capped.ok) assert.ok(Math.abs(capped.info.durationMs - 60_000) < 300, String(capped.info.durationMs));
    const trimmed = await transcodeLocal({ input: long, workDir: dir, trim: { startMs: 50_000, endMs: 58_000 } });
    assert.equal(trimmed.ok, true);
    if (trimmed.ok) {
      assert.ok(Math.abs(trimmed.info.durationMs - 8_000) < 300, String(trimmed.info.durationMs));
      assert.deepEqual([trimmed.info.width % 2, trimmed.info.height % 2], [0, 0]);
    }
    const notVideo = path.join(dir, "x.orig");
    await (await import("node:fs/promises")).writeFile(notVideo, "not a video at all");
    const bad = await transcodeLocal({ input: notVideo, workDir: dir, trim: null });
    assert.deepEqual(bad, { ok: false, status: 422, error: "no_video_stream" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mp4 inspection: a hand-made udta/©xyz box is found", () => {
  const box = (type: string, body: Uint8Array) => {
    const b = new Uint8Array(8 + body.length);
    new DataView(b.buffer).setUint32(0, b.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(body, 8);
    return b;
  };
  const xyz = box(String.fromCharCode(0xa9) + "xyz", new TextEncoder().encode("+40.6892-074.0445/"));
  const moov = box("moov", box("udta", xyz));
  const found = metadataBoxes(moov);
  assert.ok(found.includes("moov/udta"));
  assert.ok(found.includes(`moov/udta/${String.fromCharCode(0xa9)}xyz`));
  assert.equal(mp4Info(moov), null);
  const size = moov.length;
  assert.equal(neutralizeMetadataBoxes(moov), 1);
  assert.equal(moov.length, size);
  assert.deepEqual(metadataBoxes(moov), []);
  assert.equal(Buffer.from(moov).includes(Buffer.from("+40.6892")), false);
});
