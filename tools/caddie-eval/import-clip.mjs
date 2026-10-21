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
// - a clip is refused unless its contributor has an ACTIVE, AFFIRMATIVE
//   consent record on the current form version (signed, adult, not
//   withdrawn, not past its retention date; retention is at most 90 days);
// - third-party processing (Roboflow, Gemini) is a separate per-processor
//   opt-in on the form. Any baseline runner MUST call
//   assertThirdPartyAllowed() per clip, which also refuses until the
//   vendor's terms are verified (VENDOR_TERMS_VERIFIED, see
//   docs/caddie-v2/VENDOR_VERIFICATION.md);
// - local processing (pose-local.mjs, run-v2-checks.mjs, render-overlay.mjs,
//   pose-accuracy.mjs) calls assertLocalProcessingAllowed() per clip:
//   active consent, stripped, sha256 intact. Its output stays in derived/;
// - clips get pseudonymous IDs (C001-0001); original file names are never
//   recorded; consent records hold no names or emails (strict key set);
// - audio and container metadata (incl. location) are stripped when ffmpeg
//   is on PATH; otherwise the clip is flagged metadataStripped=false and the
//   manual step in the docs applies;
// - `withdraw` deletes every clip and all derived and label data for a
//   contributor.
//
// Development tooling only; never imported by src/. No dependencies beyond
// Node's standard library.
//
// Usage: node tools/caddie-eval/import-clip.mjs <command> [options]
//   init
//   consent-add  --contributor C001 --form-version 1.1 --consent-date YYYY-MM-DD
//                --retention-until YYYY-MM-DD --adult yes --signed yes
//                --coach-viewing yes|no --remote-coach-viewing yes|no
//                --roboflow yes|no --gemini yes|no
//   import       --contributor C001 --file <video> --angle <a> --club <c>
//                --mount <m> --handedness <h> --lighting <l> --skill <s>
//                [--fps N] [--condition <tag>]... [--require-strip | --stripped-manually]
//   status
//   verify
//   coach-check        [--remote]
//   third-party-check  --processor roboflow|gemini
//   coach-add    --coach K01 --agreement-version 1.0 --agreement-date YYYY-MM-DD
//                --signed yes --in-person yes|no --remote-sessions yes|no
//   coach-revoke --coach K01
//   coach-session-check --coach K01 [--remote]
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
export const CONSENT_SCHEMA = 2;
/**
 * The consent form version currently in use
 * (docs/caddie-v2/consent/CONSENT_FORM_v1.html). Version 1.0 was an unsigned
 * draft text and is refused.
 */
export const CURRENT_FORM_VERSION = "1.1";
/** Provisional maximum retention for raw clips and everything derived from them. */
export const MAX_RETENTION_DAYS = 90;
export const THIRD_PARTY_PROCESSORS = ["roboflow", "gemini"];
/**
 * Vendor terms verification, per processor. null = NOT verified, so every
 * third-party send is refused. Set to { verifiedOn: "YYYY-MM-DD",
 * noTrainingConfirmedOn: "YYYY-MM-DD", by: "Micky", checklist:
 * "docs/caddie-v2/VENDOR_APPROVAL_CRITERIA.md" } only after the vendor passes
 * every criterion there, in a commit of its own. noTrainingConfirmedOn is the
 * date of the WRITTEN commitment (contract terms or a saved written reply)
 * that our configuration's inputs and derived data are not used for training
 * or improvement; without it the vendor stays refused (Micky's decision
 * 2026-10-20). Spend approval is a separate requirement the tool can't check.
 */
export const VENDOR_TERMS_VERIFIED = Object.freeze({ roboflow: null, gemini: null });
/**
 * Coach confidentiality and data-handling agreement version in use
 * (docs/caddie-v2/consent/COACH_CONFIDENTIALITY_v1.html).
 */
export const CURRENT_COACH_AGREEMENT_VERSION = "1.0";
export const COACH_ID_RE = /^K\d{2}$/;
/** Screen-share platform reviews older than this must be redone before a remote session. */
export const PLATFORM_REVIEW_MAX_AGE_DAYS = 30;
export const SCREEN_SHARE_PLATFORMS = ["facetime", "zoom", "google_meet", "microsoft_teams"];
/**
 * Review of the screen-sharing platform used for remote coach sessions
 * (docs/caddie-v2/COACH_REVIEW_PROCEDURE.md section 4). null = NOT reviewed,
 * so every remote coach session is refused. After Micky completes that
 * checklist on the account he will host from, set it, in a commit of its
 * own, to { platform: "<one of SCREEN_SHARE_PLATFORMS>", reviewedOn:
 * "YYYY-MM-DD", by: "Micky", checklist:
 * "docs/caddie-v2/COACH_REVIEW_PROCEDURE.md" }. Re-review after
 * PLATFORM_REVIEW_MAX_AGE_DAYS, or when the platform, plan, or account changes.
 */
export const SCREEN_SHARE_PLATFORM_REVIEW = null;
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
  // Self-reported by the contributor; coaches give their own estimate.
  skill: ["beginner", "mid", "advanced"],
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

const COACH_KEYS = ["schema", "coachId", "status", "agreementVersion", "agreementDate", "agreementSigned", "inPerson", "remote", "revokedAt"];
export const COACH_SCHEMA = 1;

// Coach label files: labels/<clipId>-<coachId>.json, pass 1 and pass 2 fields
// from docs/caddie-v2/TESTING_PROTOCOL.md section 8 only. Pseudonymous IDs;
// no participant or coach identity. Free-text fields are on trust (no names).
export const LABEL_FILE_RE = /^(C\d{3}-\d{4})-(K\d{2})\.json$/;
const LABEL_KEYS = [
  "clip_id",
  "coach_id",
  "camera_angle",
  "handedness",
  "analyzable",
  "t_address",
  "t_top",
  "t_impact",
  "t_finish",
  "main_improvement",
  "main_improvement_reason",
  "drill",
  "skill_estimate",
  "confidence",
  "rating_main_improvement",
  "rating_drill",
  "false_faults",
  "rating_note",
  "keyframe_keypoints",
];
const LABEL_FAULT_KEY_RE = /^fault_[a-z_]+$/;

const CONSENT_KEYS = [
  "schema",
  "contributorId",
  "status",
  "formVersion",
  "consentDate",
  "retentionUntil",
  "adult",
  "affirmativeConsent",
  "permittedUses",
  "coachViewing",
  "remoteCoachViewing",
  "thirdPartyRoboflow",
  "thirdPartyGemini",
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

export function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
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
    coaches: path.join(dataDir, "coaches"),
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
  for (const d of [L.root, L.consent, L.clips, L.derived, L.labels, L.coaches, L.tmp]) mkdirPrivate(d);
  if (!fs.existsSync(L.manifest)) {
    writeJsonAtomic(L, L.manifest, { schema: MANIFEST_SCHEMA, revision: 0, updatedAt: null, clips: [] });
  }
  const readme = path.join(L.root, "README.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      "GolfMe Caddie V2 evaluation data. LOCAL ONLY: do not sync, upload, commit, or share this folder.\n" +
        "Managed by tools/caddie-eval/import-clip.mjs; process in docs/caddie-v2/VIDEO_IMPORT_AND_CONSENT.md.\n" +
        "Signed consent forms, signed coach agreements, and the name-to-ID key are NOT kept here.\n",
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
  if (typeof rec.formVersion !== "string" || !rec.formVersion) problems.push("formVersion");
  if (!isIsoDate(rec.consentDate)) problems.push("consentDate");
  if (!isIsoDate(rec.retentionUntil)) problems.push("retentionUntil");
  else if (isIsoDate(rec.consentDate)) {
    if (rec.retentionUntil <= rec.consentDate) problems.push("retentionUntil must be after consentDate");
    if (rec.retentionUntil > addDaysIso(rec.consentDate, MAX_RETENTION_DAYS)) {
      problems.push(`retentionUntil exceeds ${MAX_RETENTION_DAYS} days after consentDate`);
    }
  }
  if (rec.adult !== true) problems.push("adult must be true (contributors must be 18+)");
  if (rec.affirmativeConsent !== true) problems.push("affirmativeConsent must be true (signed and dated form, main consent given)");
  if (!Array.isArray(rec.permittedUses) || !rec.permittedUses.includes("caddie_eval")) problems.push("permittedUses must include caddie_eval");
  if (Array.isArray(rec.permittedUses) && rec.permittedUses.some((u) => u !== "caddie_eval")) problems.push("permittedUses may only contain caddie_eval");
  for (const k of ["coachViewing", "remoteCoachViewing", "thirdPartyRoboflow", "thirdPartyGemini"]) {
    if (typeof rec[k] !== "boolean") problems.push(k);
  }
  if (rec.remoteCoachViewing === true && rec.coachViewing !== true) problems.push("remoteCoachViewing requires coachViewing");
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
  if (rec.affirmativeConsent !== true || rec.adult !== true) throw new EvalError(`consent for ${contributorId} is not affirmative; clip refused`);
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
    formVersion: opts.formVersion,
    consentDate: opts.consentDate,
    retentionUntil: opts.retentionUntil,
    adult: opts.adult === true,
    affirmativeConsent: opts.affirmativeConsent === true,
    permittedUses: ["caddie_eval"],
    coachViewing: opts.coachViewing,
    remoteCoachViewing: opts.remoteCoachViewing,
    thirdPartyRoboflow: opts.thirdPartyRoboflow,
    thirdPartyGemini: opts.thirdPartyGemini,
    withdrawnAt: null,
    expiredAt: null,
  };
  const problems = validateConsentRecord(rec);
  if (problems.length) throw new EvalError(`consent refused: ${problems.join("; ")}`);
  if (rec.consentDate > today) throw new EvalError("consent date is in the future");
  if (rec.retentionUntil <= today) throw new EvalError("retention date has already passed");
  if (rec.formVersion !== CURRENT_FORM_VERSION) {
    throw new EvalError(`form version ${rec.formVersion} is not the current form (${CURRENT_FORM_VERSION})`);
  }
  const file = consentPath(L, rec.contributorId);
  if (fs.existsSync(file)) {
    throw new EvalError(`${rec.contributorId} already has a consent record; a returning contributor after withdrawal gets a NEW ID`);
  }
  fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  audit(L, { action: "consent_recorded", contributorId: rec.contributorId, formVersion: rec.formVersion }, today);
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
    skill: opts.skill,
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
    formVersion: consent.formVersion,
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
  problems.push(...checkLabels(L, manifest));
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
      remoteCoachViewing: rec.remoteCoachViewing,
      thirdPartyRoboflow: rec.thirdPartyRoboflow,
      thirdPartyGemini: rec.thirdPartyGemini,
      clips: manifest.clips.filter((c) => c.contributorId === rec.contributorId).length,
    });
  }
  const bySlot = {};
  const coverage = { angle: {}, club: {}, handedness: {}, skill: {}, mount: {}, lighting: {} };
  for (const c of manifest.clips) {
    bySlot[c.protocolSlot] = (bySlot[c.protocolSlot] ?? 0) + 1;
    for (const k of Object.keys(coverage)) {
      const v = c.capture?.[k] ?? "unknown";
      coverage[k][v] = (coverage[k][v] ?? 0) + 1;
    }
  }
  const n = manifest.clips.length;
  // Target 15 to 20 % left-handed (TESTING_PROTOCOL.md section 4).
  const leftHandedShare = n ? Math.round(((coverage.handedness.left ?? 0) / n) * 1000) / 10 : null;
  return { dataDir: L.root, revision: manifest.revision, clips: n, contributors, bySlot, coverage, leftHandedShare };
}

// ---------------------------------------------------------------------------
// Sharing gates: coaches and third-party processors
// ---------------------------------------------------------------------------

function clipReadyToShare(c) {
  return c.metadataStripped === true && c.metadataVerified !== false;
}

/**
 * Clips a coach may watch. In person needs coachViewing; remote (live
 * screen-share or encrypted USB, see VIDEO_IMPORT_AND_CONSENT.md section 7)
 * also needs remoteCoachViewing. Unstripped clips are never shareable.
 */
export function coachEligible(dataDir, { remote = false } = {}, today = todayIso()) {
  const L = openDataDir(dataDir);
  const manifest = loadManifest(L);
  const eligible = [];
  const refused = [];
  for (const c of manifest.clips) {
    let reason = null;
    try {
      const rec = assertActiveConsent(L, c.contributorId, today);
      if (!rec.coachViewing) reason = "no coach-viewing consent";
      else if (remote && !rec.remoteCoachViewing) reason = "no remote coach-viewing consent";
      else if (!clipReadyToShare(c)) reason = "audio/metadata not stripped";
    } catch (err) {
      reason = err.message;
    }
    if (reason) refused.push({ clipId: c.clipId, reason });
    else eligible.push(c.clipId);
  }
  return { remote, eligible, refused };
}

/**
 * THE gate every future Roboflow/Gemini baseline runner must call for each
 * clip before sending anything. Throws unless:
 * - the processor's terms are verified (VENDOR_TERMS_VERIFIED);
 * - the clip exists, its contributor's consent is active and affirmative;
 * - the contributor ticked that processor's separate opt-in;
 * - the clip's audio and metadata were stripped.
 * Spend approval from Micky is required on top of this.
 */
export function assertThirdPartyAllowed(dataDir, clipId, processor, { vendorStatus = VENDOR_TERMS_VERIFIED, today = todayIso() } = {}) {
  if (!THIRD_PARTY_PROCESSORS.includes(processor)) throw new EvalError(`unknown processor "${processor}" (allowed: ${THIRD_PARTY_PROCESSORS.join(", ")})`);
  const v = vendorStatus[processor];
  if (!vendorApproved(v)) {
    throw new EvalError(
      `${processor} terms are not verified, or there is no written no-training commitment (docs/caddie-v2/VENDOR_APPROVAL_CRITERIA.md); nothing may be sent`,
    );
  }
  const L = openDataDir(dataDir);
  if (!CLIP_ID_RE.test(clipId ?? "")) throw new EvalError("clip ID must look like C001-0001");
  const c = loadManifest(L).clips.find((x) => x.clipId === clipId);
  if (!c) throw new EvalError(`${clipId} is not in the manifest`);
  const rec = assertActiveConsent(L, c.contributorId, today);
  const flag = processor === "roboflow" ? rec.thirdPartyRoboflow : rec.thirdPartyGemini;
  if (flag !== true) throw new EvalError(`${c.contributorId} did not opt in to ${processor} processing; ${clipId} must not be sent`);
  if (!clipReadyToShare(c)) throw new EvalError(`${clipId} still has audio/metadata; strip it first`);
  return { clipId, contributorId: c.contributorId, processor };
}

/** Lists which clips assertThirdPartyAllowed() would pass for a processor, and why the rest are refused. */
export function thirdPartyEligible(dataDir, processor, opts = {}) {
  if (!THIRD_PARTY_PROCESSORS.includes(processor)) throw new EvalError(`--processor must be one of: ${THIRD_PARTY_PROCESSORS.join(", ")}`);
  const L = openDataDir(dataDir);
  const eligible = [];
  const refused = [];
  for (const c of loadManifest(L).clips) {
    try {
      assertThirdPartyAllowed(dataDir, c.clipId, processor, opts);
      eligible.push(c.clipId);
    } catch (err) {
      refused.push({ clipId: c.clipId, reason: err.message });
    }
  }
  const v = (opts.vendorStatus ?? VENDOR_TERMS_VERIFIED)[processor];
  return { processor, vendorVerified: vendorApproved(v), eligible, refused };
}

/**
 * THE gate every local processing step (pose extraction, V2 checks, overlay
 * rendering) must call before reading a clip or anything derived from it.
 * Nothing leaves the machine, so no vendor or opt-in check applies, but the
 * clip still needs: a manifest entry, active affirmative consent, audio and
 * metadata stripped, and a stored file whose sha256 still matches. Returns
 * the manifest entry, the absolute clip path, and the clip's derived folder.
 */
export async function assertLocalProcessingAllowed(dataDir, clipId, { today = todayIso(), checkFile = true } = {}) {
  const L = openDataDir(dataDir);
  if (!CLIP_ID_RE.test(clipId ?? "")) throw new EvalError("clip ID must look like C001-0001");
  const entry = loadManifest(L).clips.find((x) => x.clipId === clipId);
  if (!entry) throw new EvalError(`${clipId} is not in the manifest`);
  assertActiveConsent(L, entry.contributorId, today);
  if (!clipReadyToShare(entry)) throw new EvalError(`${clipId} still has audio/metadata; strip it before any processing`);
  const file = path.join(L.clips, entry.storedFile);
  if (checkFile) {
    const st = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!st || !st.isFile() || st.isSymbolicLink()) throw new EvalError(`${clipId}: stored file is missing`);
    if ((await sha256File(file)) !== entry.storedSha256) throw new EvalError(`${clipId}: sha256 mismatch; run verify`);
  }
  return { entry, file, derivedDir: path.join(L.derived, clipId), layout: L };
}

/** Appends a metadata-only audit event (IDs, action, date). For the local processing tools. */
export function auditEvent(L, event, today = todayIso()) {
  audit(L, event, today);
}

/** Atomic private JSON write inside the data folder. For the local processing tools. */
export function writeDataJson(L, file, value) {
  if (!path.resolve(file).startsWith(L.root + path.sep)) throw new EvalError("refusing to write outside the data folder");
  mkdirPrivate(path.dirname(file));
  writeJsonAtomic(L, file, value);
}

export { mkdirPrivate };

function vendorApproved(v) {
  return Boolean(v && isIsoDate(v.verifiedOn) && isIsoDate(v.noTrainingConfirmedOn));
}

// ---------------------------------------------------------------------------
// Coaches: agreement records, session gate, label files
// ---------------------------------------------------------------------------

function coachPath(L, coachId) {
  return path.join(L.coaches, `${coachId}.json`);
}

/** Returns a list of problems with a coach record's shape (empty = valid). No names, emails, or notes. */
export function validateCoachRecord(rec) {
  const problems = [];
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) return ["not an object"];
  for (const k of Object.keys(rec)) if (!COACH_KEYS.includes(k)) problems.push(`unexpected field "${k}" (no names, emails, or notes allowed)`);
  if (rec.schema !== COACH_SCHEMA) problems.push("schema");
  if (!COACH_ID_RE.test(rec.coachId ?? "")) problems.push("coachId must look like K01");
  if (!["active", "revoked"].includes(rec.status)) problems.push("status");
  if (typeof rec.agreementVersion !== "string" || !rec.agreementVersion) problems.push("agreementVersion");
  if (!isIsoDate(rec.agreementDate)) problems.push("agreementDate");
  if (rec.agreementSigned !== true) problems.push("agreementSigned must be true (signed confidentiality and data-handling agreement)");
  for (const k of ["inPerson", "remote"]) if (typeof rec[k] !== "boolean") problems.push(k);
  if (rec.inPerson !== true && rec.remote !== true) problems.push("at least one of inPerson or remote must be true");
  return problems;
}

export function readCoach(L, coachId) {
  if (!COACH_ID_RE.test(coachId ?? "")) throw new EvalError("coach ID must look like K01");
  const file = coachPath(L, coachId);
  if (!fs.existsSync(file)) return null;
  const rec = readJson(file);
  const problems = validateCoachRecord(rec);
  if (problems.length) throw new EvalError(`coach record ${coachId} is invalid: ${problems.join("; ")}`);
  if (rec.coachId !== coachId) throw new EvalError(`coach record ${coachId} names a different coach`);
  return rec;
}

/** Records a signed coach agreement, pseudonymously. The signed copy stays in the identity key. */
export function addCoach(dataDir, opts, today = todayIso()) {
  const L = openDataDir(dataDir);
  mkdirPrivate(L.coaches);
  const rec = {
    schema: COACH_SCHEMA,
    coachId: opts.coach,
    status: "active",
    agreementVersion: opts.agreementVersion,
    agreementDate: opts.agreementDate,
    agreementSigned: opts.agreementSigned === true,
    inPerson: opts.inPerson,
    remote: opts.remote,
    revokedAt: null,
  };
  const problems = validateCoachRecord(rec);
  if (problems.length) throw new EvalError(`coach record refused: ${problems.join("; ")}`);
  if (rec.agreementDate > today) throw new EvalError("agreement date is in the future");
  if (rec.agreementVersion !== CURRENT_COACH_AGREEMENT_VERSION) {
    throw new EvalError(`coach agreement version ${rec.agreementVersion} is not the current agreement (${CURRENT_COACH_AGREEMENT_VERSION})`);
  }
  const file = coachPath(L, rec.coachId);
  if (fs.existsSync(file)) throw new EvalError(`${rec.coachId} already has a coach record; coach IDs are never reused`);
  fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  audit(L, { action: "coach_agreement_recorded", coachId: rec.coachId, agreementVersion: rec.agreementVersion }, today);
  return rec;
}

/** Marks a coach revoked (agreement ended or breached). Their labels stay until withdrawal/retention removes the clips. */
export function revokeCoach(dataDir, coachId, today = todayIso()) {
  const L = openDataDir(dataDir);
  const rec = readCoach(L, coachId);
  if (!rec) throw new EvalError(`no coach record for ${coachId}`);
  rec.status = "revoked";
  rec.revokedAt = today;
  writeJsonAtomic(L, coachPath(L, coachId), rec);
  audit(L, { action: "coach_revoked", coachId }, today);
  return rec;
}

/** Throws unless the platform review exists, names a known platform, and is recent enough. */
export function assertPlatformReviewed(review, today = todayIso()) {
  if (!review || !isIsoDate(review.reviewedOn) || !SCREEN_SHARE_PLATFORMS.includes(review.platform)) {
    throw new EvalError("the screen-share platform is not reviewed (docs/caddie-v2/COACH_REVIEW_PROCEDURE.md section 4); no remote session");
  }
  if (review.reviewedOn > today) throw new EvalError("platform review is dated in the future");
  if (addDaysIso(review.reviewedOn, PLATFORM_REVIEW_MAX_AGE_DAYS) < today) {
    throw new EvalError(`platform review is older than ${PLATFORM_REVIEW_MAX_AGE_DAYS} days; re-review before a remote session`);
  }
  return review;
}

/**
 * THE gate before any coach session (in person or remote). Throws unless:
 * - the coach has an active record with a signed agreement on the current
 *   version, dated today or earlier, allowing this session type;
 * - for remote: the screen-share platform is reviewed and in date;
 * - at least one clip is eligible (coachEligible), i.e. contributor consent
 *   covers this session type and the clip is stripped.
 * Returns the clip IDs that may be shown. Re-run on the day of every session.
 */
export function assertCoachSessionAllowed(
  dataDir,
  coachId,
  { remote = false, platformReview = SCREEN_SHARE_PLATFORM_REVIEW, today = todayIso() } = {},
) {
  const L = openDataDir(dataDir);
  const rec = readCoach(L, coachId);
  if (!rec) throw new EvalError(`no coach record for ${coachId}; record the signed confidentiality agreement first (coach-add)`);
  if (rec.status !== "active") throw new EvalError(`coach ${coachId} is ${rec.status}; no session`);
  if (rec.agreementVersion !== CURRENT_COACH_AGREEMENT_VERSION) {
    throw new EvalError(`coach ${coachId} signed agreement ${rec.agreementVersion}, not the current ${CURRENT_COACH_AGREEMENT_VERSION}; re-sign first`);
  }
  if (rec.agreementDate > today) throw new EvalError(`coach ${coachId}'s agreement is dated in the future`);
  if (remote && !rec.remote) throw new EvalError(`coach ${coachId} is not cleared for remote sessions`);
  if (!remote && !rec.inPerson) throw new EvalError(`coach ${coachId} is not cleared for in-person sessions`);
  if (remote) assertPlatformReviewed(platformReview, today);
  const { eligible, refused } = coachEligible(dataDir, { remote }, today);
  if (!eligible.length) throw new EvalError(`no clip is eligible for a${remote ? " remote" : "n in-person"} coach session`);
  return { coachId, remote, platform: remote ? platformReview.platform : null, eligible, refused };
}

/** Returns problems with a label record (empty = valid). Only protocol fields; IDs must match the file name. */
export function validateLabelRecord(rec, { clipId, coachId } = {}) {
  const problems = [];
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) return ["not an object"];
  for (const k of Object.keys(rec)) {
    if (!LABEL_KEYS.includes(k) && !LABEL_FAULT_KEY_RE.test(k)) problems.push(`unexpected field "${k}" (protocol label fields only; no names or identity)`);
  }
  if (!CLIP_ID_RE.test(rec.clip_id ?? "")) problems.push("clip_id must look like C001-0001");
  if (!COACH_ID_RE.test(rec.coach_id ?? "")) problems.push("coach_id must look like K01");
  if (clipId && rec.clip_id !== clipId) problems.push("clip_id does not match the file name");
  if (coachId && rec.coach_id !== coachId) problems.push("coach_id does not match the file name");
  return problems;
}

function checkLabels(L, manifest) {
  const problems = [];
  if (!fs.existsSync(L.labels)) return problems;
  const clipIds = new Set(manifest.clips.map((c) => c.clipId));
  for (const name of fs.readdirSync(L.labels)) {
    const m = LABEL_FILE_RE.exec(name);
    if (!m) {
      problems.push(`labels/${name}: name must be <clip ID>-<coach ID>.json`);
      continue;
    }
    const [, clipId, coachId] = m;
    if (!clipIds.has(clipId)) problems.push(`labels/${name}: clip ${clipId} is not in the manifest`);
    try {
      if (!readCoach(L, coachId)) problems.push(`labels/${name}: no coach record for ${coachId}`);
    } catch (err) {
      problems.push(`labels/${name}: ${err.message}`);
    }
    let rec;
    try {
      rec = readJson(path.join(L.labels, name));
    } catch {
      problems.push(`labels/${name}: not valid JSON`);
      continue;
    }
    for (const p of validateLabelRecord(rec, { clipId, coachId })) problems.push(`labels/${name}: ${p}`);
  }
  return problems;
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
      "form-version": { type: "string" },
      "retention-until": { type: "string" },
      adult: { type: "string" },
      signed: { type: "string" },
      "coach-viewing": { type: "string" },
      "remote-coach-viewing": { type: "string" },
      roboflow: { type: "string" },
      gemini: { type: "string" },
      skill: { type: "string" },
      remote: { type: "boolean" },
      processor: { type: "string" },
      coach: { type: "string" },
      "agreement-version": { type: "string" },
      "agreement-date": { type: "string" },
      "in-person": { type: "string" },
      "remote-sessions": { type: "string" },
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
        formVersion: values["form-version"],
        retentionUntil: values["retention-until"],
        adult: yesNo(values.adult, "--adult"),
        affirmativeConsent: yesNo(values.signed, "--signed"),
        coachViewing: yesNo(values["coach-viewing"], "--coach-viewing"),
        remoteCoachViewing: yesNo(values["remote-coach-viewing"], "--remote-coach-viewing"),
        thirdPartyRoboflow: yesNo(values.roboflow, "--roboflow"),
        thirdPartyGemini: yesNo(values.gemini, "--gemini"),
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
        skill: values.skill,
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
    case "coach-check": {
      const r = coachEligible(dataDir, { remote: values.remote === true });
      out(r);
      return 0;
    }
    case "third-party-check": {
      const r = thirdPartyEligible(dataDir, values.processor);
      out(r);
      return r.vendorVerified ? 0 : 1;
    }
    case "coach-add": {
      const rec = addCoach(dataDir, {
        coach: values.coach,
        agreementVersion: values["agreement-version"],
        agreementDate: values["agreement-date"],
        agreementSigned: yesNo(values.signed, "--signed"),
        inPerson: yesNo(values["in-person"], "--in-person"),
        remote: yesNo(values["remote-sessions"], "--remote-sessions"),
      });
      out(rec);
      return 0;
    }
    case "coach-revoke":
      out(revokeCoach(dataDir, values.coach));
      return 0;
    case "coach-session-check": {
      try {
        const r = assertCoachSessionAllowed(dataDir, values.coach, { remote: values.remote === true });
        out({ allowed: true, ...r });
        return 0;
      } catch (err) {
        if (!(err instanceof EvalError)) throw err;
        out({ allowed: false, coachId: values.coach ?? null, remote: values.remote === true, reason: err.message });
        return 1;
      }
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
      out(
        "Commands: init | consent-add | import | status | verify | coach-check | third-party-check | coach-add | coach-revoke | coach-session-check | withdraw | retention. See the header of this file.",
      );
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
