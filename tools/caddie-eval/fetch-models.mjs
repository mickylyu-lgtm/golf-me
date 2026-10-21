#!/usr/bin/env node
// Downloads the MediaPipe Pose Landmarker model files listed in
// tools/caddie-eval/models/models.json from Google's model storage into
// GOLFME_EVAL_MODEL_DIR (default ~/.cache/golfme-caddie-eval/models), outside
// the repo, and refuses any file whose sha256 differs from the manifest.
// This is the only network step in the local pose workflow, and it sends no
// clip data: it is a plain download of a public file.
//
// Usage: node tools/caddie-eval/fetch-models.mjs [full|heavy ...]   (default: full heavy)
//        node tools/caddie-eval/fetch-models.mjs --check            (verify only, no network)
import fs from "node:fs";
import path from "node:path";
import { EvalError, sha256File } from "./import-clip.mjs";
import { assertModelDirOutsideRepo, defaultModelDir, loadModelsManifest, resolveVerifiedModel } from "./lib/models.mjs";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const manifest = loadModelsManifest();
const variants = args.filter((a) => !a.startsWith("--"));
const wanted = variants.length ? variants : Object.keys(manifest.models);
const dir = defaultModelDir();

try {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertModelDirOutsideRepo(dir);
  for (const v of wanted) {
    const info = manifest.models[v];
    if (!info) throw new EvalError(`unknown variant "${v}"`);
    const dest = path.join(dir, info.file);
    if (fs.existsSync(dest)) {
      await resolveVerifiedModel(v, { manifest, dir });
      process.stdout.write(`${v}: present, sha256 OK\n`);
      continue;
    }
    if (checkOnly) throw new EvalError(`${v}: missing (run without --check to download)`);
    if (!info.url.startsWith("https://storage.googleapis.com/mediapipe-models/")) throw new EvalError(`${v}: unexpected source URL`);
    const res = await fetch(info.url);
    if (!res.ok) throw new EvalError(`${v}: download failed (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = `${dest}.download`;
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    const sha = await sha256File(tmp);
    if (sha !== info.sha256) {
      fs.rmSync(tmp, { force: true });
      throw new EvalError(`${v}: downloaded file sha256 ${sha} does not match models.json; discarded`);
    }
    fs.renameSync(tmp, dest);
    process.stdout.write(`${v}: downloaded ${buf.length} bytes, sha256 OK\n`);
  }
} catch (err) {
  process.stderr.write(`fetch-models: ${err instanceof EvalError ? err.message : err?.message ?? err}\n`);
  process.exit(1);
}
