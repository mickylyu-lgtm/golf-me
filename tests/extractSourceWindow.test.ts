// Run: npm run test:caddie  (node --test; real ffmpeg-static, synthetic
// videos only — no user video, no network, no Supabase).
//
// api/extract-frames.ts's `sourceWindow` (2026-11-08) lets analyze-swing
// extract frames from the UNTRIMMED original in parallel with
// api/trim-video.ts, instead of waiting for the trimmed copy. That is only
// safe if both paths put frames on the same timeline at the same size:
// the replay overlay and the dense pass both use the trimmed copy. This
// checks it end to end: trim-video + extract-frames(trimmed) vs.
// extract-frames(original, sourceWindow).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ffmpeg = path.resolve("node_modules/ffmpeg-static/ffmpeg");
const haveFfmpeg = existsSync(ffmpeg);
process.env.FRAME_EXTRACT_SECRET = "test-secret";
const URL_OK = "https://abc.supabase.co/storage/v1/object/sign/caddie-media/x.mov";

type Frame = { frameIndex: number; timestampSeconds: number; base64: string };
type ExtractBody = { frames: Frame[]; frameCount: number; coordinateScale: number; activeWindowTrim: { startSeconds: number; endSeconds: number } | null; sourceWindow: unknown; error?: string };

function call(handler: (req: unknown, res: unknown) => unknown, body: unknown): Promise<{ status: number; json?: ExtractBody; bytes?: Buffer }> {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
      json(payload: ExtractBody) {
        resolve({ status: this.statusCode, json: payload });
        return this;
      },
      send(payload: Buffer) {
        resolve({ status: this.statusCode, bytes: Buffer.from(payload) });
        return this;
      },
    };
    void handler({ method: "POST", headers: { authorization: "Bearer test-secret" }, body }, res);
  });
}

function jpegSize(b64: string): string {
  const bytes = Buffer.from(b64, "base64");
  let i = 2;
  while (i + 8 < bytes.length) {
    const marker = bytes[i + 1];
    const len = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return `${bytes.readUInt16BE(i + 7)}x${bytes.readUInt16BE(i + 5)}`;
    i += 2 + len;
  }
  return "?";
}

test("extract-frames sourceWindow matches trim-video + extract-frames (timeline, count, size, scale)", { skip: !haveFfmpeg && "ffmpeg-static binary not installed" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xsw-"));
  try {
    // 9 s portrait clip: 3 s still, 3 s motion, 3 s still (freezedetect
    // finds the motion), as a 60 fps HEVC-free H.264 .mov with a 90 degree
    // display rotation like an iPhone recording.
    const still = (n: string, color: string) => {
      const p = path.join(dir, n);
      execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", `color=c=${color}:size=1920x1080:rate=60:duration=3`, "-pix_fmt", "yuv420p", p], { stdio: "ignore" });
      return p;
    };
    const motion = path.join(dir, "motion.mp4");
    execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=60:duration=3", "-pix_fmt", "yuv420p", motion], { stdio: "ignore" });
    const a = still("a.mp4", "green");
    const c = still("c.mp4", "green");
    const joined = path.join(dir, "joined.mp4");
    execFileSync(ffmpeg, ["-y", "-i", a, "-i", motion, "-i", c, "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1[v]", "-map", "[v]", "-pix_fmt", "yuv420p", joined], { stdio: "ignore" });
    const original = path.join(dir, "original.mov");
    execFileSync(ffmpeg, ["-y", "-display_rotation", "90", "-i", joined, "-c", "copy", original], { stdio: "ignore" });

    const { default: extract } = await import("../api/extract-frames.ts");
    const { default: trim } = await import("../api/trim-video.ts");
    const window = { startSeconds: 1.5, endSeconds: 8.25 };

    let served = readFileSync(original);
    globalThis.fetch = (async () => new Response(served)) as typeof fetch;

    // Old path: trim, then extract from the trimmed copy.
    const trimmed = await call(trim, { videoUrl: URL_OK, ...window });
    assert.equal(trimmed.status, 200);
    served = trimmed.bytes!;
    const viaTrim = await call(extract, { videoUrl: URL_OK, fps: 8, maxLongSide: 720 });
    assert.equal(viaTrim.status, 200);

    // New path: extract straight from the original's window.
    served = readFileSync(original);
    const viaWindow = await call(extract, { videoUrl: URL_OK, fps: 8, maxLongSide: 720, sourceWindow: window });
    assert.equal(viaWindow.status, 200);
    const t = viaTrim.json!;
    const w = viaWindow.json!;

    assert.deepEqual(w.sourceWindow, window, "window echoed");
    assert.equal(t.sourceWindow, null);
    assert.ok(w.frameCount > 0);
    assert.equal(w.frameCount, t.frameCount, "same number of frames");
    assert.deepEqual(
      w.frames.map((f) => f.timestampSeconds),
      t.frames.map((f) => f.timestampSeconds),
      "same timestamps (relative to the window start)",
    );
    assert.equal(w.coordinateScale, t.coordinateScale, "same coordinate scale");
    assert.equal(jpegSize(w.frames[0].base64), jpegSize(t.frames[0].base64), "same frame size and orientation");
    assert.ok(t.activeWindowTrim && w.activeWindowTrim, "motion found on both paths");
    assert.ok(Math.abs(w.activeWindowTrim!.startSeconds - t.activeWindowTrim!.startSeconds) < 0.05, `active start ${JSON.stringify([t.activeWindowTrim, w.activeWindowTrim])}`);
    assert.ok(Math.abs(w.activeWindowTrim!.endSeconds - t.activeWindowTrim!.endSeconds) < 0.05, "active end");

    // A malformed window is refused, never silently ignored.
    const bad = await call(extract, { videoUrl: URL_OK, fps: 8, sourceWindow: { startSeconds: 3, endSeconds: 2 } });
    assert.equal(bad.status, 400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
