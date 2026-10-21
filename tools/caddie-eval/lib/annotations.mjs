// Key-frame annotations by the K00 annotator (Micky): PROTOTYPE labels for
// measuring the local pose source, NOT validated ground truth. The rules
// (keypoint definitions, key-frame definitions, visibility codes, golfer's
// own left/right, corrections) are in
// docs/caddie-v2/KEYFRAME_ANNOTATION_GUIDE.md; this file enforces them.
//
// Storage, inside the data folder (never in the repo):
//   annotators/K00.json                       who K00 is, pseudonymously (no name)
//   annotations/<clip ID>-K00.v001.json       first version
//   annotations/<clip ID>-K00.v002.json       a correction: new file, never an overwrite
// Versions are append-only (written with the exclusive-create flag). Every
// version after the first carries a correction block (reason code, note,
// date, the version it supersedes). Scorers use the LATEST valid version.
// withdraw / retention delete the files with the clip (prefix <clip ID>-).
//
// Pure validators plus small file helpers. No network. No dependency on the
// rest of the tool, so import-clip.mjs can use it without a cycle.
import fs from "node:fs";
import path from "node:path";

export const ANNOTATION_SCHEMA = 1;
export const ANNOTATION_KIND = "caddie_v2_keyframe_annotation";
/** Written into every annotation and every report row that uses one. */
export const ANNOTATION_LABEL_STATUS = "prototype_not_validated";
export const ANNOTATION_GUIDE_VERSION = "1.0";
export const ANNOTATOR_SCHEMA = 1;
/**
 * Annotator IDs that are NOT coaches. K00 = Micky (Micky's decision,
 * 2026-10-21). coach-add refuses these IDs, so K00 can never pass the coach
 * session gate or count as a coach in inter-rater agreement.
 */
export const ANNOTATOR_IDS = Object.freeze(["K00"]);
export const ANNOTATOR_ROLE = "owner_prototype_annotator";

/** Same 13 names, same order, as POSE_KEYPOINT_NAMES in src/lib/caddie/v2/types.ts (a test checks). */
export const ANNOTATION_KEYPOINTS = Object.freeze([
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
]);

/** Key frames, in swing order. Definitions: KEYFRAME_ANNOTATION_GUIDE.md §3 (same as the coach t_* fields). */
export const KEYFRAME_EVENTS = Object.freeze(["address", "top", "impact", "finish"]);

/**
 * Per-point visibility codes (guide §4):
 *   visible       clearly seen; x, y = the joint as defined
 *   occluded      partly hidden; x, y = best estimate reasoned from what IS visible
 *   not_visible   cannot be located (fully hidden, blurred beyond use); no x, y
 *   out_of_frame  outside the picture; no x, y
 */
export const VISIBILITY_CODES = Object.freeze(["visible", "occluded", "not_visible", "out_of_frame"]);
const CODES_WITH_POSITION = new Set(["visible", "occluded"]);

/** Key-frame status: labeled, or why it could not be. */
export const KEYFRAME_STATUSES = Object.freeze(["labeled", "not_in_clip", "cant_tell"]);

export const CORRECTION_REASONS = Object.freeze(["misplaced_point", "wrong_frame", "visibility_code", "left_right_swap", "guide_change", "other"]);
export const MAX_NOTE_CHARS = 200;

export const ANNOTATION_FILE_RE = /^(C\d{3}-\d{4})-(K\d{2})\.v(\d{3})\.json$/;
const CLIP_ID_RE = /^C\d{3}-\d{4}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOP_KEYS = ["schema", "kind", "label_status", "clip_id", "annotator_id", "version", "created_on", "guide_version", "correction", "frame_source", "keyframes"];
const FRAME_SOURCE_KEYS = ["export_schema", "analysis_fps", "frame_width", "frame_height", "frame_count"];

export function annotationFileName(clipId, annotatorId, version) {
  return `${clipId}-${annotatorId}.v${String(version).padStart(3, "0")}.json`;
}

function isIsoDate(s) {
  return typeof s === "string" && ISO_DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

function validatePoint(name, p, src, where) {
  const problems = [];
  if (typeof p !== "object" || p === null || Array.isArray(p)) return [`${where}.${name}: must be an object with a "v" code`];
  for (const k of Object.keys(p)) if (!["v", "x", "y"].includes(k)) problems.push(`${where}.${name}: unexpected field "${k}"`);
  if (!VISIBILITY_CODES.includes(p.v)) return [...problems, `${where}.${name}.v must be one of: ${VISIBILITY_CODES.join(", ")}`];
  if (CODES_WITH_POSITION.has(p.v)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) problems.push(`${where}.${name}: "${p.v}" needs numeric x and y`);
    else if (src && (p.x < 0 || p.y < 0 || p.x > src.frame_width || p.y > src.frame_height)) problems.push(`${where}.${name}: x, y outside the frame (use "out_of_frame")`);
  } else if ("x" in p || "y" in p) {
    problems.push(`${where}.${name}: "${p.v}" must not have x or y (no guessed positions)`);
  }
  return problems;
}

/**
 * Validates one annotation version. Returns problems (empty = valid).
 * `clipId`, `annotatorId`, `version` come from the file name when known;
 * `previous` is the latest earlier version (for correction checks).
 */
export function validateAnnotation(rec, { clipId, annotatorId, version, previous = null } = {}) {
  const problems = [];
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) return ["not an object"];
  for (const k of Object.keys(rec)) if (!TOP_KEYS.includes(k)) problems.push(`unexpected field "${k}" (no names, notes outside the correction block, or extra data)`);
  if (rec.schema !== ANNOTATION_SCHEMA) problems.push("schema");
  if (rec.kind !== ANNOTATION_KIND) problems.push(`kind must be "${ANNOTATION_KIND}"`);
  if (rec.label_status !== ANNOTATION_LABEL_STATUS) problems.push(`label_status must be "${ANNOTATION_LABEL_STATUS}" (prototype labels, not validated ground truth)`);
  if (!CLIP_ID_RE.test(rec.clip_id ?? "")) problems.push("clip_id must look like C001-0001");
  if (!ANNOTATOR_IDS.includes(rec.annotator_id)) problems.push(`annotator_id must be one of: ${ANNOTATOR_IDS.join(", ")}`);
  if (clipId && rec.clip_id !== clipId) problems.push("clip_id does not match the file name");
  if (annotatorId && rec.annotator_id !== annotatorId) problems.push("annotator_id does not match the file name");
  if (!(Number.isInteger(rec.version) && rec.version >= 1 && rec.version <= 999)) problems.push("version must be an integer 1..999");
  if (version !== undefined && rec.version !== version) problems.push("version does not match the file name");
  if (!isIsoDate(rec.created_on)) problems.push("created_on must be YYYY-MM-DD");
  if (rec.guide_version !== ANNOTATION_GUIDE_VERSION) problems.push(`guide_version must be "${ANNOTATION_GUIDE_VERSION}"`);

  // Corrections: v1 has none; every later version says why and what it replaces.
  if (rec.version === 1) {
    if (rec.correction !== null) problems.push("version 1 must have correction: null");
  } else if (Number.isInteger(rec.version)) {
    const c = rec.correction;
    if (typeof c !== "object" || c === null || Array.isArray(c)) problems.push("a correction (version 2 or later) needs a correction block: reason, note, date, supersedes_version");
    else {
      for (const k of Object.keys(c)) if (!["reason", "note", "date", "supersedes_version"].includes(k)) problems.push(`correction: unexpected field "${k}"`);
      if (!CORRECTION_REASONS.includes(c.reason)) problems.push(`correction.reason must be one of: ${CORRECTION_REASONS.join(", ")}`);
      if (typeof c.note !== "string" || c.note.length > MAX_NOTE_CHARS || (c.reason === "other" && !c.note.trim())) {
        problems.push(`correction.note must be a string of at most ${MAX_NOTE_CHARS} characters (required for "other"; no names)`);
      }
      if (!isIsoDate(c.date)) problems.push("correction.date must be YYYY-MM-DD");
      if (c.supersedes_version !== rec.version - 1) problems.push("correction.supersedes_version must be the previous version number");
      if (previous && isIsoDate(c.date) && isIsoDate(previous.created_on) && c.date < previous.created_on) problems.push("correction is dated before the version it corrects");
    }
  }

  const src = rec.frame_source;
  let srcOk = false;
  if (typeof src !== "object" || src === null || Array.isArray(src)) problems.push("frame_source");
  else {
    for (const k of Object.keys(src)) if (!FRAME_SOURCE_KEYS.includes(k)) problems.push(`frame_source: unexpected field "${k}"`);
    srcOk = [src.analysis_fps, src.frame_width, src.frame_height].every((v) => Number.isFinite(v) && v > 0) && Number.isInteger(src.frame_count) && src.frame_count > 0;
    if (!srcOk) problems.push("frame_source needs analysis_fps, frame_width, frame_height > 0 and an integer frame_count");
  }

  const kf = rec.keyframes;
  if (typeof kf !== "object" || kf === null || Array.isArray(kf)) return [...problems, "keyframes must be an object keyed by event"];
  for (const k of Object.keys(kf)) if (!KEYFRAME_EVENTS.includes(k)) problems.push(`keyframes: unknown event "${k}"`);
  let lastIndex = -1;
  for (const ev of KEYFRAME_EVENTS) {
    const e = kf[ev];
    if (e === undefined) {
      problems.push(`keyframes.${ev} missing (use status "not_in_clip" or "cant_tell" if it can't be labeled)`);
      continue;
    }
    if (typeof e !== "object" || e === null) {
      problems.push(`keyframes.${ev} must be an object`);
      continue;
    }
    if (!KEYFRAME_STATUSES.includes(e.status)) {
      problems.push(`keyframes.${ev}.status must be one of: ${KEYFRAME_STATUSES.join(", ")}`);
      continue;
    }
    if (e.status !== "labeled") {
      for (const k of Object.keys(e)) if (k !== "status") problems.push(`keyframes.${ev}: "${e.status}" must not carry "${k}"`);
      continue;
    }
    for (const k of Object.keys(e)) if (!["status", "frame_index", "t", "points"].includes(k)) problems.push(`keyframes.${ev}: unexpected field "${k}"`);
    if (!Number.isInteger(e.frame_index) || e.frame_index < 0 || (srcOk && e.frame_index >= src.frame_count)) problems.push(`keyframes.${ev}.frame_index must be an exported frame`);
    else {
      if (srcOk && !(Number.isFinite(e.t) && Math.abs(e.t - e.frame_index / src.analysis_fps) < 0.0005)) problems.push(`keyframes.${ev}.t must equal frame_index / analysis_fps`);
      if (e.frame_index <= lastIndex) problems.push(`keyframes.${ev}: key frames must be in swing order (address < top < impact < finish)`);
      lastIndex = e.frame_index;
    }
    if (typeof e.points !== "object" || e.points === null || Array.isArray(e.points)) {
      problems.push(`keyframes.${ev}.points`);
      continue;
    }
    for (const name of Object.keys(e.points)) if (!ANNOTATION_KEYPOINTS.includes(name)) problems.push(`keyframes.${ev}: unknown keypoint "${name}"`);
    for (const name of ANNOTATION_KEYPOINTS) {
      if (!(name in e.points)) problems.push(`keyframes.${ev}.${name} missing (every point gets a code)`);
      else problems.push(...validatePoint(name, e.points[name], srcOk ? src : null, `keyframes.${ev}`));
    }
  }
  return problems;
}

/** Validates an annotator record (no names, emails, or notes). */
export function validateAnnotatorRecord(rec) {
  const problems = [];
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) return ["not an object"];
  const keys = ["schema", "annotatorId", "role", "scope", "labelStatus", "recordedOn", "status"];
  for (const k of Object.keys(rec)) if (!keys.includes(k)) problems.push(`unexpected field "${k}" (no names, emails, or notes allowed)`);
  if (rec.schema !== ANNOTATOR_SCHEMA) problems.push("schema");
  if (!ANNOTATOR_IDS.includes(rec.annotatorId)) problems.push(`annotatorId must be one of: ${ANNOTATOR_IDS.join(", ")}`);
  if (rec.role !== ANNOTATOR_ROLE) problems.push(`role must be "${ANNOTATOR_ROLE}"`);
  if (rec.scope !== "keyframe_keypoints") problems.push('scope must be "keyframe_keypoints"');
  if (rec.labelStatus !== ANNOTATION_LABEL_STATUS) problems.push(`labelStatus must be "${ANNOTATION_LABEL_STATUS}"`);
  if (!isIsoDate(rec.recordedOn)) problems.push("recordedOn");
  if (!["active", "retired"].includes(rec.status)) problems.push("status");
  return problems;
}

/** Lists the annotation version files for one clip and annotator, sorted by version. */
export function listAnnotationVersions(annotationsDir, clipId, annotatorId) {
  if (!fs.existsSync(annotationsDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(annotationsDir)) {
    const m = ANNOTATION_FILE_RE.exec(name);
    if (m && m[1] === clipId && m[2] === annotatorId) out.push({ version: Number(m[3]), file: path.join(annotationsDir, name), name });
  }
  return out.sort((a, b) => a.version - b.version);
}

/**
 * Reads and validates every version; returns { latest, versions, problems }.
 * `latest` is the highest-numbered version, only when the whole chain is
 * valid and gap-free (a broken chain is reported, never silently skipped).
 */
export function readAnnotationChain(annotationsDir, clipId, annotatorId) {
  const files = listAnnotationVersions(annotationsDir, clipId, annotatorId);
  const problems = [];
  const versions = [];
  let previous = null;
  for (const [i, f] of files.entries()) {
    if (f.version !== i + 1) {
      problems.push(`${f.name}: versions must run 1, 2, 3, ... without gaps`);
      break;
    }
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(f.file, "utf8"));
    } catch {
      problems.push(`${f.name}: not valid JSON`);
      break;
    }
    const p = validateAnnotation(rec, { clipId, annotatorId, version: f.version, previous });
    if (p.length) {
      problems.push(...p.map((x) => `${f.name}: ${x}`));
      break;
    }
    versions.push(rec);
    previous = rec;
  }
  return { latest: problems.length ? null : (versions.at(-1) ?? null), versions, problems };
}

/**
 * Converts an annotation into the scorer's keyframe_keypoints shape
 * (tools/caddie-eval/pose-accuracy.mjs): visible -> [x, y];
 * occluded -> { occluded: [x, y] }; not_visible / out_of_frame -> "not_visible".
 */
export function annotationToScorerLabels(rec) {
  const frames = [];
  for (const ev of KEYFRAME_EVENTS) {
    const e = rec.keyframes[ev];
    if (!e || e.status !== "labeled") continue;
    const points = {};
    for (const [name, p] of Object.entries(e.points)) {
      if (p.v === "visible") points[name] = [p.x, p.y];
      else if (p.v === "occluded") points[name] = { occluded: [p.x, p.y] };
      else points[name] = "not_visible";
    }
    frames.push({ phase: ev, t: e.t, frame_index: e.frame_index, points });
  }
  return { frame_width: rec.frame_source.frame_width, frame_height: rec.frame_source.frame_height, frames };
}

/** Builds the next version from a draft (keyframes + frame_source), with the correction block when needed. */
export function buildNextVersion({ clipId, annotatorId, draft, previous, correction, today }) {
  const version = previous ? previous.version + 1 : 1;
  return {
    schema: ANNOTATION_SCHEMA,
    kind: ANNOTATION_KIND,
    label_status: ANNOTATION_LABEL_STATUS,
    clip_id: clipId,
    annotator_id: annotatorId,
    version,
    created_on: today,
    guide_version: ANNOTATION_GUIDE_VERSION,
    correction: previous ? { reason: correction?.reason, note: correction?.note ?? "", date: today, supersedes_version: previous.version } : null,
    frame_source: draft?.frame_source,
    keyframes: draft?.keyframes,
  };
}
