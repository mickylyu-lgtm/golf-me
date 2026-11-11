// Real ffmpeg, generated clips, stubbed source fetches. No customer media or providers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ffmpeg = path.resolve("node_modules/ffmpeg-static/ffmpeg");
const sourceUrl = "https://caddie-fixture.invalid.supabase.co/storage/v1/object/sign/caddie-media/fixture.mp4";
type Reply = { status: number; json?: { error?: string; frameCount?: number }; bytes?: Buffer };
function call(handler: (req: any, res: any) => unknown, body: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      setHeader() {},
      json(json: Reply["json"]) { resolve({ status: this.statusCode, json }); return this; },
      send(bytes: Buffer) { resolve({ status: this.statusCode, bytes }); return this; },
    };
    Promise.resolve(handler({ method: "POST", headers: { authorization: "Bearer test-source-limit" }, body }, res)).catch(reject);
  });
}

test("server accepts a short original and refuses 10s+ before pose analysis, even with a short crop", {
  skip: !existsSync(ffmpeg) && "ffmpeg-static not installed", timeout: 120_000,
}, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "caddie-source-limit-"));
  const oldFetch = globalThis.fetch;
  const oldSecret = process.env.FRAME_EXTRACT_SECRET;
  process.env.FRAME_EXTRACT_SECRET = "test-source-limit";
  try {
    const { default: extract } = await import("../api/extract-frames.ts");
    const { default: trim } = await import("../api/trim-video.ts");
    for (const seconds of [9.9, 10, 10.1, 20]) {
      const file = path.join(dir, seconds + ".mp4");
      execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=" + seconds,
        "-c:v", "libx264", "-preset", "ultrafast", "-an", "-movflags", "+faststart", file], { stdio: "ignore" });
      const bytes = readFileSync(file);
      globalThis.fetch = (async () => new Response(bytes)) as typeof fetch;
      const expected = seconds < 10 ? 200 : 413;
      for (const sourceWindow of [undefined, { startSeconds: 1, endSeconds: 3 }]) {
        const reply = await call(extract, { videoUrl: sourceUrl, fps: 2, sourceWindow });
        assert.equal(reply.status, expected, "extract original " + seconds + " seconds; crop " + !!sourceWindow);
        if (expected === 200) assert.ok((reply.json?.frameCount ?? 0) > 0, "short video yields real frames");
        else assert.deepEqual(reply.json, { error: "video_too_long" });
      }
      const cropped = await call(trim, { videoUrl: sourceUrl, startSeconds: 1, endSeconds: 3 });
      assert.equal(cropped.status, expected, "2-second crop must not hide a " + seconds + "-second original");
      if (expected === 200) assert.ok((cropped.bytes?.byteLength ?? 0) > 0, "short video yields a real trimmed MP4");
      else assert.deepEqual(cropped.json, { error: "video_too_long" });
    }
    globalThis.fetch = (async () => new Response("not a video")) as typeof fetch;
    assert.equal((await call(extract, { videoUrl: sourceUrl })).status, 422);
    assert.equal((await call(trim, { videoUrl: sourceUrl, startSeconds: 0, endSeconds: 2 })).status, 422);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldSecret === undefined) delete process.env.FRAME_EXTRACT_SECRET;
    else process.env.FRAME_EXTRACT_SECRET = oldSecret;
    rmSync(dir, { recursive: true, force: true });
  }
});
