// Local pose model files: where they live, and the sha256 check against the
// committed manifest (tools/caddie-eval/models/models.json). Model binaries
// are never in the repo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvalError, sha256File } from "../import-clip.mjs";

export const MODEL_DIR_ENV = "GOLFME_EVAL_MODEL_DIR";
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MODELS_MANIFEST_PATH = path.join(HERE, "..", "models", "models.json");
const REPO = path.resolve(HERE, "..", "..", "..");

export function loadModelsManifest(file = MODELS_MANIFEST_PATH) {
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  if (m.schema !== 1 || typeof m.models !== "object") throw new EvalError("models.json has an unknown shape");
  return m;
}

export function defaultModelDir(env = process.env) {
  const v = env[MODEL_DIR_ENV];
  return v && v.trim() ? path.resolve(v.trim()) : path.join(os.homedir(), ".cache", "golfme-caddie-eval", "models");
}

/** Model files must not sit inside this repo (they'd risk being committed). */
export function assertModelDirOutsideRepo(dir) {
  const real = fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir);
  const repoReal = fs.realpathSync(REPO);
  if (real === repoReal || real.startsWith(repoReal + path.sep)) {
    throw new EvalError("model folder is inside the GolfMe repo; keep model binaries outside it (GOLFME_EVAL_MODEL_DIR)");
  }
  return real;
}

/**
 * Returns { variant, path, sha256, info } for a model whose file exists and
 * matches the manifest hash. Refuses otherwise.
 */
export async function resolveVerifiedModel(variant, { env = process.env, manifest = loadModelsManifest(), dir = defaultModelDir(env) } = {}) {
  const info = manifest.models[variant];
  if (!info) throw new EvalError(`unknown model variant "${variant}" (have: ${Object.keys(manifest.models).join(", ")})`);
  const real = assertModelDirOutsideRepo(dir);
  const file = path.join(real, info.file);
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!st || !st.isFile()) throw new EvalError(`model file missing: run node tools/caddie-eval/fetch-models.mjs ${variant}`);
  const sha256 = await sha256File(file);
  if (sha256 !== info.sha256) throw new EvalError(`model file ${info.file} does not match the sha256 in models.json; refusing to use it`);
  return { variant, path: file, sha256, info };
}
