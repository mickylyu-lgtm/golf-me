// Run: npm run test:caddie  (node --test; real ffmpeg-static, synthetic
// videos, a local HTTP server — no user video, no network, no Supabase).
//
// api/trim-video.ts reads only the window it needs from the signed URL
// (ffmpeg with input-side seeking over HTTP Range), and falls back once to
// the old full download on ANY failure of that read. Checks: the range read
// moves fewer bytes and produces the same cut as the full path; a server
// that refuses ranges, hangs, or serves a non-QuickTime container falls
// back and still trims; a broken file still fails with the same token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const ffmpeg = path.resolve("node_modules/ffmpeg-static/ffmpeg");
const skip = !existsSync(ffmpeg) && "ffmpeg-static binary not installed";

type Mode = "range" | "no-range" | "hang";
function serve(file: string, mode: Mode) {
  const size = statSync(file).size;
  const stats = { bytes: 0, requests: 0 };
  const server = http.createServer((req, res) => {
    stats.requests++;
    if (mode === "hang") return; // never answers
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    if (mode === "no-range" && m) {
      res.writeHead(500);
      return res.end();
    }
    const from = m ? Number(m[1]) : 0;
    const to = m && m[2] ? Number(m[2]) : size - 1;
    res.writeHead(m ? 206 : 200, { "Content-Length": to - from + 1, "Accept-Ranges": "bytes", ...(m ? { "Content-Range": `bytes ${from}-${to}/${size}` } : {}) });
    const fd = openSync(file, "r");
    let pos = from;
    let closed = false;
    const done = () => {
      if (!closed) {
        closed = true;
        closeSync(fd);
      }
    };
    res.on("close", () => {
      pos = to + 1;
      done();
    });
    const pump = () => {
      while (pos <= to) {
        const buf = Buffer.alloc(Math.min(256 * 1024, to - pos + 1));
        const n = readSync(fd, buf, 0, buf.length, pos);
        pos += n;
        stats.bytes += n;
        // ~100 MB/s: a real link's pace, so "bytes sent" is close to what
        // ffmpeg actually read (a loopback socket would race far ahead).
        if (!res.write(buf.subarray(0, n))) return res.once("drain", pump);
        if (pos <= to) return void setTimeout(pump, 2);
      }
      done();
      res.end();
    };
    pump();
  });
  return new Promise<{ url: string; stats: typeof stats; close: () => void }>((resolve) =>
    server.listen(0, () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v.mov`,
        stats,
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      }),
    ),
  );
}

const framemd5 = (file: string) =>
  execFileSync(ffmpeg, ["-v", "error", "-i", file, "-map", "0:v", "-f", "framemd5", "-"], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));
const durationOf = (file: string) => {
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-i", file], { stdio: "pipe" });
  } catch (e) {
    return (String((e as { stderr: unknown }).stderr).match(/Duration: ([^,]+)/) ?? [])[1];
  }
};

test("trim-video range read: fewer bytes, same cut; every failure falls back to the full download", { skip, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "trr-"));
  try {
    // 30 s, 1080p, 12 Mbps, iPhone-style rotation; the window is 14-22 s.
    const raw = path.join(dir, "raw.mov");
    execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=30", "-f", "lavfi", "-i", "sine=duration=30", "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "12M", "-minrate", "12M", "-maxrate", "12M", "-bufsize", "24M", "-x264-params", "nal-hrd=cbr", "-g", "60", "-pix_fmt", "yuv420p", "-c:a", "aac", raw], { stdio: "ignore" });
    const original = path.join(dir, "original.mov");
    execFileSync(ffmpeg, ["-y", "-display_rotation", "90", "-i", raw, "-c", "copy", original], { stdio: "ignore" });
    const size = statSync(original).size;

    const { trimWindowToFile, classifyFfmpegFailure } = await import("../api/trim-video.ts");
    // The fallback's plain fetch reads the same local server.
    const run = async (url: string, name: string, opts: { rangeTimeoutMs?: number } = {}) => {
      const out = path.join(dir, `${name}.mp4`);
      const r = await trimWindowToFile(url, 14, 8, dir, out, { protocols: "http,tcp", ...opts });
      return { ...r, out };
    };

    // 1. Range read.
    const s1 = await serve(original, "range");
    const ranged = await run(s1.url, "ranged");
    s1.close();
    assert.equal(ranged.source, "range");
    // "Sent" over-counts what ffmpeg consumed (loopback socket buffers fill
    // ahead, more so under load), so only assert it isn't a whole download;
    // trim-bench/bench-range.mjs measures the timing.
    assert.ok(s1.stats.bytes < size * 0.9, `read ${s1.stats.bytes} of ${size} bytes`);

    // 2. A server that refuses ranges (500 on Range): full download fallback.
    const s2 = await serve(original, "no-range");
    const full = await run(s2.url, "full");
    s2.close();
    assert.equal(full.source, "full");
    assert.ok(full.rangeFailure, "the range failure is reported as a token");
    assert.ok(s2.stats.bytes >= size, "the whole file was downloaded");

    // Same cut either way: same duration, identical decoded video frames.
    assert.equal(durationOf(ranged.out), "00:00:08.00");
    assert.equal(durationOf(full.out), "00:00:08.00");
    assert.deepEqual(framemd5(ranged.out), framemd5(full.out), "identical frames from the range read and the full download");

    // 3. A server that never answers: the range read is bounded, then the
    //    fallback is tried (it also hangs here, so fetch is stubbed to a
    //    working copy to show the trim still completes).
    const s3 = await serve(original, "hang");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(readFileSync(original))) as typeof fetch;
    const t = Date.now();
    try {
      const hung = await run(s3.url, "hung", { rangeTimeoutMs: 1_500 });
      assert.equal(hung.source, "full");
      assert.equal(hung.rangeFailure, "timeout");
      assert.ok(Date.now() - t < 20_000, "bounded");
      assert.equal(durationOf(hung.out), "00:00:08.00");
    } finally {
      globalThis.fetch = realFetch;
      s3.close();
    }

    // 4. Not QuickTime/MP4 (Matroska): -f mov refuses it, the full path trims it.
    const mkv = path.join(dir, "clip.mkv");
    execFileSync(ffmpeg, ["-y", "-i", original, "-c", "copy", mkv], { stdio: "ignore" });
    const s4 = await serve(mkv, "range");
    const fromMkv = await run(s4.url, "mkv");
    s4.close();
    assert.equal(fromMkv.source, "full");
    assert.equal(durationOf(fromMkv.out), "00:00:08.00");

    // 5. A broken file: both paths fail; the error the caller classifies is
    //    the full path's, with the same tokens as before.
    const junk = path.join(dir, "junk.mov");
    execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "anoisesrc=d=1", "-f", "s16le", junk], { stdio: "ignore" });
    const s5 = await serve(junk, "range");
    let caught: unknown;
    try {
      await run(s5.url, "junk");
    } catch (err) {
      caught = err;
    }
    s5.close();
    assert.ok(caught, "a broken file still fails");
    assert.equal(classifyFfmpegFailure(caught).token, "decode_failed");
    assert.equal(classifyFfmpegFailure(caught).status, 422);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the range read only speaks https (no file:, no http) in production", { skip }, async () => {
  const { rangeInputOptions } = await import("../api/trim-video.ts");
  const opts = rangeInputOptions();
  assert.equal(opts[opts.indexOf("-protocol_whitelist") + 1], "https,tls,tcp");
  assert.equal(opts[opts.indexOf("-f") + 1], "mov");
  assert.ok(opts.includes("-rw_timeout"));
});
