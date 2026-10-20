#!/usr/bin/env node
// Caddie V2 evaluation data: consent-gated, local-only clip import.
//
// See docs/caddie-v2/VIDEO_IMPORT_AND_CONSENT.md for the full process. In
// short:
// - clips come ONLY from Micky and friends who gave written consent; never
//   from existing GolfMe user uploads;
// - everything lives in a local data directory OUTSIDE the repo
//   (GOLFME_EVAL_DATA_DIR, default ~/golfme-eval-data). The tool refuses a
//   directory inside any git work tree or a known cloud-sync folder;
// - nothing is uploaded anywhere. This file makes no network calls;
// - a clip is refused unless its contributor has an ACTIVE consent record
//   (not withdrawn, not past its retention date);
// - clips get pseudonymous IDs (C001-0001); original file names are never
//   recorded; consent records hold no names or emails (strict key set);
// - audio and container metadata (incl. location) are stripped when ffmpeg
//   is on PATH; otherwise the clip is flagged metadataStripped=false and the
//   manual step in the docs applies;
// - `withdraw` deletes every clip and all derived data for a contributor.
//
// Development tooling only; never imported by src/. No dependencies beyond
// Node's standard library.
//
// Usage: node tools/caddie-eval/import-clip.mjs <command> [options]
//   init
//   consent-add  --contributor C001 --consent-date YYYY-MM-DD --consent-version 1.0
//                --retention-until YYYY-MM-DD --adult yes
//                --coach-viewing yes|no --third-party-processing yes|no
//   import       --contributor C001 --file <video> --angle <a> --club <c>
//                --mount <m> --handedness <h> --lighting <l>
//                [--fps N] [--condition <tag>]... [--require-strip | --stripped-manually]
//   status
//   verify
//   withdraw     --contributor C001 [--confirm]
//   retention    [--apply]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const DATA_DIR_ENV = "GOLFME_EVAL_DATA_DIR";
export const FFMPEG_ENV = "GOLFME_EVAL_FFMPEG";
export const FFPROBE_ENV = "GOLFME_EVAL_FFPROBE";
export const MANIFEST_SCHEMA = 1;
export const CONSENT_SCHEMA = 1;
/** The consent text version the docs currently ship (VIDEO_IMPORT_AND_CONSENT.md). */
export const CURRENT_CONSENT_VERSION = "1.0";
export const MAX_RETENTION_MONTHS = 24;
export const MAX_CLIP_BYTES = 2 * 1024 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".m4v"];

export const CONTRIBUTOR_ID_RE = /^C\d{3}$/;
export const CLIP_ID_RE = /^C\d{3}-\d{4}$/;

export const CAPTURE_ENUMS = {
  angle: ["face_on", "down_the_line", "unsuitable"],
  club: ["driver", "wood", "hybrid", "iron"],
  mount: ["tripod", "handheld"],
  handedness: ["right", "left"],
  lighting: ["daylight", "overcast", "backlit", "dusk", "indoor"],
};
export const CONDITION_TAGS = [
  "baggy_clothing",
  "second_person",
  "partial_body",
  "occlusion",
  "behind_angle",
  "steep_angle",
  "no_swing",
  "short_clip",
  "slow_motion",
  "camera_shake",
];

// Short codes for the protocol slot, e.g. FO-DR-TRI-RH-DAY.
const SLOT_CODES = {
  angle: { face_on: "FO", down_the_line: "DTL", unsuitable: "BAD" },
  club: { driver: "DR", wood: "WD", hybrid: "HY", iron: "IR" },
  mount: { tripod: "TRI", handheld: "HND" },
  handedness: { right: "RH", left: "LH" },
  lighting: { daylight: "DAY", overcast: "OVC", backlit: "BKL", dusk: "DSK", indoor: "IND" },
};

const CONSENT_KEYS = [
  "schema",
  "contributorId",
  "status",
  "consentVersion",
  "consentDate",
  "retentionUntil",
  "adult",
  "permittedUses",
  "coachViewing",
  "thirdPartyProcessing",
  "withdrawnAt",
  "expiredAt",
];

// Path segments of common sync clients. Clips must never be synced to a cloud.
const CLOUD_SYNC_SEGMENTS = [
  "dropbox",
  "onedrive",
  "google drive",
  "googledrive",
  "icloud drive",
  "icloud",
  "mobile documents",
  "cloudstorage",
  "box sync",
  "mega",
  "pcloud",
  "nextcloud",
  "syncthing",
];

export class EvalError extends Error {}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function isIsoDate(s) {
  if (typeof s !== "string" || !ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addMonthsIso(iso, months) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Data directory
// ---------------------------------------------------------------------------

export function defaultDataDir(env = process.env) {
  const fromEnv = env[DATA_DIR_ENV];
  return fromEnv && fromEnv.trim() ? path.resolve(fromEnv.trim()) : path.join(os.homedir(), "golfme-eval-data");
}

function realOrResolved(p) {
  // Resolve symlinks on the longest existing ancestor so a link cannot hide
  // a repo or synced folder.
  let cur = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(fs.realpathSync(cur), ...tail);
}

/**
 * Throws unless `dataDir` is a safe place for eval clips: absolute, not
 * inside any git work tree (this repo or another), not in a cloud-sync
 * folder.
 */
export function assertSafeDataDir(dataDir) {
  if (!path.isAbsolute(dataDir)) throw new EvalError("data directory must be an absolute path");
  const real = realOrResolved(dataDir);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const repoReal = fs.realpathSync(repoRoot);
  if (real === repoReal || real.startsWith(repoReal + path.sep)) {
    throw new EvalError("data directory is inside the GolfMe repo; it must live outside any git checkout");
  }
  let cur = real;
  for (;;) {
    if (fs.existsSync(path.join(cur, ".git"))) {
      throw new EvalError(`data directory is inside a git work tree (${cur}); choose a folder outside any repo`);
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const segments = real.toLowerCase().split(path.sep);
  for (const seg of segments) {
    if (CLOUD_SYNC_SEGMENTS.some((c) => seg === c || seg.startsWith(`${c}-`) || seg.startsWith(`${c} `))) {
      throw new EvalError(`data directory looks like a cloud-sync folder ("${seg}"); clips must stay local`);
    }
  }
  return real;
}

function layout(dataDir) {
  return {
    root: dataDir,
    consent: path.join(dataDir, "consent"),
    clips: path.join(dataDir, "clips"),
    derived: path.join(dataDir, "derived"),
    labels: path.join(dataDir, "labels"),
    tmp: path.join(dataDir, ".tmp"),
    manifest: path.join(dataDir, "manifest.json"),
    auditLog: path.join(dataDir, "audit-log.jsonl"),
  };
}

function mkdirPrivate(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best effort (e.g. some Windows/WSL mounts)
  }
}

export function initDataDir(dataDir) {
  const safe = assertSafeDataDir(dataDir);
  const L = layout(safe);
  for (const d of [L.root, L.consent, L.clips, L.derived, L.labels, L.tmp]) mkdirPrivate(d);
  if (!fs.existsSync(L.manifest)) {
    writeJsonAtomic(L, L.manifest, { schema: MANIFEST_SCHEMA, revision: 0, updatedAt: null, clips: [] });
  }
  const readme = path.join(L.root, "README.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      "GolfMe Caddie V2 evaluation data. LOCAL ONLY: do not sync, upload, commit, or share this folder.\n" +
        "Managed by tools/caddie-eval/import-clip.mjs; process in docs/caddie-v2/VIDEO_IMPORT_AND_CONSENT.md.\n" +
        "Signed consent forms and the name-to-ID key are NOT kept here.\n",
      { mode: 0o600 },
    );
  }
  return L;
}

function openDataDir(dataDir) {
  const safe = assertSafeDataDir(dataDir);
  const L = layout(safe);
  if (!fs.existsSync(L.manifest)) throw new EvalError(`no manifest in ${safe}; run "init" first`);
  return L;
}

function writeJsonAtomic(L, file, value) {
  mkdirPrivate(L.tmp);
  const tmp = path.join(L.tmp, `${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function audit(L, event, today) {
  // Metadata only: IDs, action, date. Never paths, file names, or people.
  fs.appendFileSync(L.auditLog, `${JSON.stringify({ date: today, ...event })}\n`, { mode: 0o600 });
}

function loadManifest(L) {
  const m = readJson(L.manifest);
  if (m.schema !== MANIFEST_SCHEMA || !Array.isArray(m.clips)) throw new EvalError("manifest has an unknown shape");
  return m;
}

function saveManifest(L, manifest, today) {
  manifest.revision = (manifest.revision ?? 0) + 1;
  manifest.updatedAt = today;
  writeJsonAtomic(L, L.manifest, manifest);
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

function consentPath(L, contributorId) {
  return path.join(L.consent, `${contributorId}.json`);
}

/** Returns a list of problems with a consent record's shape (empty = valid). */
export function validateConsentRecord(rec) {
  const problems = [];
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) return ["not an object"];
  for (const k of Object.keys(rec)) if (!CONSENT_KEYS.includes(k)) problems.push(`unexpected field "${k}" (no names, emails, or notes allowed)`);
  if (rec.schema !== CONSENT_SCHEMA) problems.push("schema");
  if (!CONTRIBUTOR_ID_RE.test(rec.contributorId ?? "")) problems.push("contributorId must look like C001");
  if (!["active", "withdrawn", "expired"].includes(rec.status)) problems.push("status");
  if (typeof rec.consentVersion !== "string" || !rec.consentVersion) problems.push("consentVersion");
  if (!isIsoDate(rec.consentDate)) problems.push("consentDate");
  if (!isIsoDate(rec.retentionUntil)) problems.push("retentionUntil");
  else if (isIsoDate(rec.consentDate)) {
    if (rec.retentionUntil <= rec.consentDate) problems.push("retentionUntil must be after consentDate");
    if (rec.retentionUntil > addMonthsIso(rec.consentDate, MAX_RETENTION_MONTHS)) {
      problems.push(`retentionUntil exceeds ${MAX_RETENTION_MONTHS} months after consentDate`);
    }
  }
  if (rec.adult !== true) problems.push("adult must be true (contributors must be 18+)");
  if (!Array.isArray(rec.permittedUses) || !rec.permittedUses.includes("caddie_eval")) problems.push("permittedUses must include caddie_eval");
  if (Array.isArray(rec.permittedUses) && rec.permittedUses.some((u) => u !== "caddie_eval")) problems.push("permittedUses may only contain caddie_eval");
  if (typeof rec.coachViewing !== "boolean") problems.push("coachViewing");
  if (typeof rec.thirdPartyProcessing !== "boolean") problems.push("thirdPartyProcessing");
  return problems;
}

export function readConsent(L, contributorId) {
  if (!CONTRIBUTOR_ID_RE.test(contributorId ?? "")) throw new EvalError("contributor ID must look like C001");
  const file = consentPath(L, contributorId);
  if (!fs.existsSync(file)) return null;
  const rec = readJson(file);
  const problems = validateConsentRecord(rec);
  if (problems.length) throw new EvalError(`consent record ${contributorId} is invalid: ${problems.join("; ")}`);
  if (rec.contributorId !== contributorId) throw new EvalError(`consent record ${contributorId} names a different contributor`);
  return rec;
}

/** Throws unless the contributor's consent allows importing today. */
export function assertActiveConsent(L, contributorId, today) {
  const rec = readConsent(L, contributorId);
  if (!rec) throw new EvalError(`no consent record for ${contributorId}; record written consent first (consent-add)`);
  if (rec.status !== "active") throw new EvalError(`consent for ${contributorId} is ${rec.status}; clip refused`);
  if (rec.consentDate > today) throw new EvalError(`consent for ${contributorId} is dated in the future`);
  if (rec.retentionUntil <= today) throw new EvalError(`consent for ${contributorId} reached its retention date; clip refused`);
  return rec;
}

export function addConsent(dataDir, opts, today = todayIso()) {
  const L = openDataDir(dataDir);
  const rec = {
    schema: CONSENT_SCHEMA,
    contributorId: opts.contributor,
    status: "active",
    consentVersion: opts.consentVersion,
    consentDate: opts.consentDate,
    retentionUntil: opts.retentionUntil,
    adult: opts.adult === true,
    permittedUses: ["caddie_eval"],
    coachViewing: opts.coachViewing,
    thirdPartyProcessing: opts.thirdPartyProcessing,
    withdrawnAt: null,
    expiredAt: null,
  };
  const problems = validateConsentRecord(rec);
  if (problems.length) throw new EvalError(`consent refused: ${problems.join("; ")}`);
  if (rec.consentDate > today) throw new EvalError("consent date is in the future");
  if (rec.retentionUntil <= today) throw new EvalError("retention date has already passed");
  if (rec.consentVersion !== CURRENT_CONSENT_VERSION) {
    throw new EvalError(`consent version ${rec.consentVersion} is not the current form (${CURRENT_CONSENT_VERSION})`);
  }
  const file = consentPath(L, rec.contributorId);
  if (fs.existsSync(file)) {
    throw new EvalError(`${rec.contributorId} already has a consent record; a returning contributor after withdrawal gets a NEW ID`);
  }
  fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  audit(L, { action: "consent_recorded", contributorId: rec.contributorId, consentVersion: rec.consentVersion }, today);
  return rec;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")));
  });
}

const VIDEO_BOX_TYPES = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"]);

function looksLikeIsoBmff(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(8);
    const n = fs.readSync(fd, buf, 0, 8, 0);
    return n === 8 && VIDEO_BOX_TYPES.has(buf.toString("latin1", 4, 8));
  } finally {
    fs.closeSync(fd);
  }
}

export function validateCapture(capture) {
  const problems = [];
  for (const [key, allowed] of Object.entries(CAPTURE_ENUMS)) {
    if (!allowed.includes(capture[key])) problems.push(`--${key} must be one of: ${allowed.join(", ")}`);
  }
  if (capture.fps !== null && !(Number.isFinite(capture.fps) && capture.fps > 0 && capture.fps <= 1000)) problems.push("--fps must be a positive number");
  for (const c of capture.conditions) if (!CONDITION_TAGS.includes(c)) problems.push(`unknown --condition "${c}" (allowed: ${CONDITION_TAGS.join(", ")})`);
  return problems;
}

export function protocolSlot(capture) {
  return [
    SLOT_CODES.angle[capture.angle],
    SLOT_CODES.club[capture.club],
    SLOT_CODES.mount[capture.mount],
    SLOT_CODES.handedness[capture.handedness],
    SLOT_CODES.lighting[capture.lighting],
  ].join("-");
}

function toolAvailable(bin) {
  if (!bin) return false;
  const r = spawnSync(bin, ["-version"], { stdio: "ignore", timeout: 10_000 });
  return r.status === 0;
}

const LOCATION_TAG_RE = /location|iso6709|xyz|gps|latitude|longitude/i;

/** Strips audio, data/subtitle streams, and all container/stream metadata. Video is stream-copied (no re-encode). */
function stripWithFfmpeg(ffmpeg, src, dst) {
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", src,
    "-map", "0:v:0",
    "-c", "copy",
    "-an", "-sn", "-dn",
    "-map_metadata", "-1",
    "-map_chapters", "-1",
    dst,
  ];
  const r = spawnSync(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], timeout: 10 * 60_000 });
  if (r.status !== 0) throw new EvalError("ffmpeg failed to strip the clip; nothing was imported");
}

/** True when ffprobe confirms no audio stream and no location-like tags remain. Null when ffprobe is unavailable. */
function probeClean(ffprobe, file) {
  if (!toolAvailable(ffprobe)) return null;
  const r = spawnSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type:stream_tags:format_tags", "-of", "json", file], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.status !== 0) return false;
  try {
    const info = JSON.parse(r.stdout);
    const streams = info.streams ?? [];
    if (streams.some((s) => s.codec_type === "audio")) return false;
    const tagKeys = [...Object.keys(info.format?.tags ?? {}), ...streams.flatMap((s) => Object.keys(s.tags ?? {}))];
    return !tagKeys.some((k) => LOCATION_TAG_RE.test(k));
  } catch {
    return false;
  }
}

function nextClipId(L, manifest, contributorId) {
  let max = 0;
  const re = new RegExp(`^${contributorId}-(\\d{4})`);
  for (const c of manifest.clips) {
    const m = re.exec(c.clipId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  for (const name of fs.readdirSync(L.clips)) {
    const m = re.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  if (max >= 9999) throw new EvalError(`${contributorId} has no clip IDs left`);
  return `${contributorId}-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Imports one clip. Returns the manifest entry. Refuses without active
 * consent, duplicates, non-video files, symlinks, and oversize files.
 */
export async function importClip(dataDir, opts, env = process.env, today = todayIso()) {
  const L = openDataDir(dataDir);
  const consent = assertActiveConsent(L, opts.contributor, today);

  const capture = {
    angle: opts.angle,
    club: opts.club,
    mount: opts.mount,
    handedness: opts.handedness,
    lighting: opts.lighting,
    fps: opts.fps ?? null,
    conditions: [...new Set(opts.conditions ?? [])].sort(),
  };
  const problems = validateCapture(capture);
  if (problems.length) throw new EvalError(problems.join("; "));

  if (!opts.file) throw new EvalError("--file is required");
  const src = path.resolve(opts.file);
  const lst = fs.lstatSync(src, { throwIfNoEntry: false });
  if (!lst) throw new EvalError("source file not found");
  if (lst.isSymbolicLink() || !lst.isFile()) throw new EvalError("source must be a regular file (not a symlink)");
  if (lst.size === 0 || lst.size > MAX_CLIP_BYTES) throw new EvalError("source is empty or over 2 GiB");
  const ext = path.extname(src).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) throw new EvalError(`only ${ALLOWED_EXTENSIONS.join(", ")} are accepted`);
  if (!looksLikeIsoBmff(src)) throw new EvalError("file does not look like an MP4/MOV video");
  if (src.startsWith(L.root + path.sep)) throw new EvalError("source is already inside the data directory");

  const manifest = loadManifest(L);
  const sourceSha256 = await sha256File(src);
  const dup = manifest.clips.find((c) => c.sourceSha256 === sourceSha256);
  if (dup) throw new EvalError(`this video is already imported as ${dup.clipId}`);

  const ffmpeg = env[FFMPEG_ENV] || "ffmpeg";
  const ffprobe = env[FFPROBE_ENV] || "ffprobe";
  const canStrip = toolAvailable(ffmpeg);
  if (!canStrip && opts.requireStrip) throw new EvalError("ffmpeg not found and --require-strip was given; nothing imported");
  if (opts.requireStrip && opts.strippedManually) throw new EvalError("use either --require-strip or --stripped-manually, not both");
  // --stripped-manually: the operator attests audio and location were already
  // removed before import (manual step in the docs). Only used without ffmpeg.
  const stripMethod = canStrip ? "ffmpeg" : opts.strippedManually ? "manual_attested" : null;

  const clipId = nextClipId(L, manifest, opts.contributor);
  const storedFile = `${clipId}${ext}`;
  const dest = path.join(L.clips, storedFile);
  mkdirPrivate(L.tmp);
  const tmp = path.join(L.tmp, `${clipId}.importing${ext}`);
  try {
    fs.rmSync(tmp, { force: true });
    if (canStrip) stripWithFfmpeg(ffmpeg, src, tmp);
    else fs.copyFileSync(src, tmp, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(tmp, 0o600);
    if (fs.existsSync(dest)) throw new EvalError(`${storedFile} already exists; refusing to overwrite`);
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  const verifiedClean = canStrip ? probeClean(ffprobe, dest) : null;
  const entry = {
    clipId,
    contributorId: opts.contributor,
    consentVersion: consent.consentVersion,
    importedOn: today,
    storedFile,
    bytes: fs.statSync(dest).size,
    sourceSha256,
    storedSha256: await sha256File(dest),
    metadataStripped: stripMethod !== null,
    stripMethod,
    // true: ffprobe saw no audio and no location tags; false: it saw some
    // (treat as unstripped); null: not checked.
    metadataVerified: verifiedClean,
    protocolSlot: protocolSlot(capture),
    capture,
    // What the filmer intended. Ground truth comes from coach labels.
    captureIsIntent: true,
  };
  manifest.clips.push(entry);
  saveManifest(L, manifest, today);
  audit(L, { action: "clip_imported", clipId, contributorId: opts.contributor, stripMethod }, today);
  return entry;
}

// ---------------------------------------------------------------------------
// Withdrawal, retention, verification
// ---------------------------------------------------------------------------

function deleteClipData(L, clipId) {
  if (!CLIP_ID_RE.test(clipId)) throw new EvalError(`refusing to delete unexpected ID ${clipId}`);
  const removed = [];
  for (const name of fs.readdirSync(L.clips)) {
    if (name === clipId || name.startsWith(`${clipId}.`)) {
      fs.rmSync(path.join(L.clips, name), { force: true });
      removed.push(`clips/${name}`);
    }
  }
  for (const base of ["derived", "labels"]) {
    const dir = path.join(L.root, base);
    for (const name of fs.readdirSync(dir)) {
      if (name === clipId || name.startsWith(`${clipId}.`) || name.startsWith(`${clipId}-`) || name.startsWith(`${clipId}_`)) {
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
        removed.push(`${base}/${name}`);
      }
    }
  }
  return removed;
}

function clipIdsFor(L, manifest, contributorId) {
  const ids = new Set(manifest.clips.filter((c) => c.contributorId === contributorId).map((c) => c.clipId));
  // Also catch files the manifest lost track of.
  const re = new RegExp(`^(${contributorId}-\\d{4})`);
  for (const base of ["clips", "derived", "labels"]) {
    for (const name of fs.readdirSync(path.join(L.root, base))) {
      const m = re.exec(name);
      if (m) ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

function purgeContributor(L, contributorId, newStatus, today) {
  const manifest = loadManifest(L);
  const clipIds = clipIdsFor(L, manifest, contributorId);
  const removed = clipIds.flatMap((id) => deleteClipData(L, id));
  manifest.clips = manifest.clips.filter((c) => c.contributorId !== contributorId);
  saveManifest(L, manifest, today);
  const rec = readConsent(L, contributorId);
  if (rec) {
    rec.status = newStatus;
    if (newStatus === "withdrawn") rec.withdrawnAt = today;
    if (newStatus === "expired") rec.expiredAt = today;
    writeJsonAtomic(L, consentPath(L, contributorId), rec);
  }
  audit(L, { action: newStatus === "withdrawn" ? "contributor_withdrawn" : "retention_expired", contributorId, clipsDeleted: clipIds.length }, today);
  return { contributorId, clipIds, removed };
}

/** Dry run unless `confirm`. Deletes every clip, derived file, and label file for the contributor. */
export function withdrawContributor(dataDir, contributorId, { confirm = false } = {}, today = todayIso()) {
  const L = openDataDir(dataDir);
  if (!CONTRIBUTOR_ID_RE.test(contributorId ?? "")) throw new EvalError("contributor ID must look like C001");
  const rec = readConsent(L, contributorId);
  const manifest = loadManifest(L);
  const clipIds = clipIdsFor(L, manifest, contributorId);
  if (!rec && clipIds.length === 0) throw new EvalError(`nothing known about ${contributorId}`);
  if (!confirm) return { dryRun: true, contributorId, clipIds, removed: [] };
  return { dryRun: false, ...purgeContributor(L, contributorId, "withdrawn", today) };
}

/** Lists (or with apply, purges) contributors whose retention date has passed. */
export function enforceRetention(dataDir, { apply = false } = {}, today = todayIso()) {
  const L = openDataDir(dataDir);
  const due = [];
  for (const name of fs.readdirSync(L.consent)) {
    const m = /^(C\d{3})\.json$/.exec(name);
    if (!m) continue;
    const rec = readConsent(L, m[1]);
    if (rec && rec.status === "active" && rec.retentionUntil <= today) due.push(rec.contributorId);
  }
  if (!apply) return { dryRun: true, due, results: [] };
  return { dryRun: false, due, results: due.map((id) => purgeContributor(L, id, "expired", today)) };
}

/** Re-hashes every clip and checks each has active consent. Returns problems (empty = clean). */
export async function verifyDataDir(dataDir, today = todayIso()) {
  const L = openDataDir(dataDir);
  const manifest = loadManifest(L);
  const problems = [];
  const known = new Set();
  for (const c of manifest.clips) {
    known.add(c.storedFile);
    const file = path.join(L.clips, c.storedFile);
    if (!fs.existsSync(file)) {
      problems.push(`${c.clipId}: file missing`);
      continue;
    }
    if ((await sha256File(file)) !== c.storedSha256) problems.push(`${c.clipId}: sha256 mismatch`);
    try {
      assertActiveConsent(L, c.contributorId, today);
    } catch (err) {
      problems.push(`${c.clipId}: ${err.message}`);
    }
    if (!c.metadataStripped || c.metadataVerified === false) problems.push(`${c.clipId}: metadata not stripped (manual step pending)`);
  }
  for (const name of fs.readdirSync(L.clips)) if (!known.has(name)) problems.push(`clips/${name}: not in manifest`);
  return problems;
}

export function statusSummary(dataDir, today = todayIso()) {
  const L = openDataDir(dataDir);
  const manifest = loadManifest(L);
  const contributors = [];
  for (const name of fs.readdirSync(L.consent).sort()) {
    const m = /^(C\d{3})\.json$/.exec(name);
    if (!m) continue;
    const rec = readConsent(L, m[1]);
    contributors.push({
      contributorId: rec.contributorId,
      status: rec.status === "active" && rec.retentionUntil <= today ? "retention_due" : rec.status,
      retentionUntil: rec.retentionUntil,
      coachViewing: rec.coachViewing,
      thirdPartyProcessing: rec.thirdPartyProcessing,
      clips: manifest.clips.filter((c) => c.contributorId === rec.contributorId).length,
    });
  }
  const bySlot = {};
  for (const c of manifest.clips) bySlot[c.protocolSlot] = (bySlot[c.protocolSlot] ?? 0) + 1;
  return { dataDir: L.root, revision: manifest.revision, clips: manifest.clips.length, contributors, bySlot };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function yesNo(v, flag) {
  if (v === "yes") return true;
  if (v === "no") return false;
  throw new EvalError(`${flag} must be yes or no`);
}

const MANUAL_STRIP_NOTE =
  "ffmpeg was not found, so audio and metadata (possibly GPS location) were NOT removed.\n" +
  "Follow the manual step in docs/caddie-v2/VIDEO_IMPORT_AND_CONSENT.md before any coach sees this clip.";

async function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: {
      contributor: { type: "string" },
      "consent-date": { type: "string" },
      "consent-version": { type: "string" },
      "retention-until": { type: "string" },
      adult: { type: "string" },
      "coach-viewing": { type: "string" },
      "third-party-processing": { type: "string" },
      file: { type: "string" },
      angle: { type: "string" },
      club: { type: "string" },
      mount: { type: "string" },
      handedness: { type: "string" },
      lighting: { type: "string" },
      fps: { type: "string" },
      condition: { type: "string", multiple: true },
      "require-strip": { type: "boolean" },
      "stripped-manually": { type: "boolean" },
      confirm: { type: "boolean" },
      apply: { type: "boolean" },
    },
  });
  const dataDir = defaultDataDir();
  const out = (v) => process.stdout.write(`${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n`);

  switch (command) {
    case "init": {
      const L = initDataDir(dataDir);
      out(`Initialized ${L.root}`);
      return 0;
    }
    case "consent-add": {
      const rec = addConsent(dataDir, {
        contributor: values.contributor,
        consentDate: values["consent-date"],
        consentVersion: values["consent-version"],
        retentionUntil: values["retention-until"],
        adult: yesNo(values.adult, "--adult"),
        coachViewing: yesNo(values["coach-viewing"], "--coach-viewing"),
        thirdPartyProcessing: yesNo(values["third-party-processing"], "--third-party-processing"),
      });
      out(rec);
      return 0;
    }
    case "import": {
      const entry = await importClip(dataDir, {
        contributor: values.contributor,
        file: values.file,
        angle: values.angle,
        club: values.club,
        mount: values.mount,
        handedness: values.handedness,
        lighting: values.lighting,
        fps: values.fps === undefined ? null : Number(values.fps),
        conditions: values.condition ?? [],
        requireStrip: values["require-strip"] === true,
        strippedManually: values["stripped-manually"] === true,
      });
      out(`Imported ${entry.clipId} (${entry.protocolSlot}) sha256 ${entry.storedSha256}`);
      if (!entry.metadataStripped) out(MANUAL_STRIP_NOTE);
      else if (entry.metadataVerified === false) out("WARNING: ffprobe still sees audio or location tags; treat as unstripped.");
      out("The original file was not modified or deleted. Delete it from the phone/camera roll if the contributor asked.");
      return 0;
    }
    case "status":
      out(statusSummary(dataDir));
      return 0;
    case "verify": {
      const problems = await verifyDataDir(dataDir);
      out(problems.length ? problems.join("\n") : "OK: every clip hashes correctly and has active consent.");
      return problems.length ? 1 : 0;
    }
    case "withdraw": {
      const r = withdrawContributor(dataDir, values.contributor, { confirm: values.confirm === true });
      if (r.dryRun) {
        out(`DRY RUN. Would delete ${r.clipIds.length} clip(s) and all derived/label data for ${r.contributorId}: ${r.clipIds.join(", ") || "(none)"}`);
        out("Re-run with --confirm to delete.");
      } else {
        out(`Deleted ${r.removed.length} item(s) for ${r.contributorId}; consent marked withdrawn.`);
        if (r.clipIds.length) out(`Also delete these clip IDs from any coach labeling sheet and revoke any viewing links: ${r.clipIds.join(", ")}`);
      }
      return 0;
    }
    case "retention": {
      const r = enforceRetention(dataDir, { apply: values.apply === true });
      if (r.dryRun) out(r.due.length ? `Retention due (re-run with --apply to delete): ${r.due.join(", ")}` : "No contributor is past their retention date.");
      else out(`Purged: ${r.results.map((x) => `${x.contributorId} (${x.clipIds.length} clips)`).join(", ") || "(none)"}`);
      return 0;
    }
    default:
      out("Commands: init | consent-add | import | status | verify | withdraw | retention. See the header of this file.");
      return command ? 2 : 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`caddie-eval: ${err instanceof EvalError || err?.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ? err.message : `unexpected error: ${err?.message ?? err}`}\n`);
      process.exit(1);
    },
  );
}
