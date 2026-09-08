// Session/diversity-group identification.
//
// Decision (locked in with Micky, see task history): automatic heuristic
// only -- no folder-based grouping convention. Videos are clustered into a
// session by (a) a normalized "source signature" derived from the filename
// (which app/device produced it -- "WhatsApp Video ...", "VIDEO-...", etc.),
// then (b) walking each signature's videos in timestamp order and starting a
// new session whenever the gap to the previous video exceeds
// SESSION_GAP_HOURS.
//
// The gap threshold is intentionally generous (see constant below): the
// failure mode we must avoid is UNDER-merging -- splitting one real
// continuous filming session into multiple "sessions" would let the
// train/val/test splitter (a later phase) treat clips from the same
// golfer/camera/lighting as independent diversity, which is the exact bug
// this whole pipeline exists to prevent. Over-merging two genuinely
// different sessions just makes the split slightly more conservative than
// strictly necessary -- a much smaller cost. When the heuristic is wrong,
// fix it explicitly via session-overrides.json rather than fighting the
// threshold.
import { readFile, writeFile } from "node:fs/promises";

export const SESSION_GAP_HOURS = 4;

export interface VideoTimestamp {
  key: string; // manifest key: path relative to raw_videos, e.g. "batch_02/foo.mp4" or "foo.mp4"
  filename: string;
  timestampMs: number;
  timestampSource: "filename" | "mtime";
}

// Matches the two source patterns seen in this project's footage so far.
// Falls back to file mtime for anything else (screen recordings, AirDrop
// exports, future camera apps with different naming) -- this is a heuristic,
// not an exhaustive parser, so unknown formats degrade gracefully rather
// than throwing.
const FILENAME_TIMESTAMP_PATTERNS: { regex: RegExp; toDate: (m: RegExpMatchArray) => Date }[] = [
  {
    // VIDEO-2026-08-21-19-00-50.mp4
    regex: /VIDEO-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/,
    toDate: (m) => new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])),
  },
  {
    // "WhatsApp Video 2026-09-07 at 22.51.28.mp4" (an optional " (1)" dedup suffix before the extension is fine, the regex doesn't need to match to the end)
    regex: /(\d{4})-(\d{2})-(\d{2}) at (\d{2})\.(\d{2})\.(\d{2})/,
    toDate: (m) => new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])),
  },
];

export function parseFilenameTimestamp(filename: string): number | undefined {
  for (const { regex, toDate } of FILENAME_TIMESTAMP_PATTERNS) {
    const m = filename.match(regex);
    if (m) {
      const d = toDate(m);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
  }
  return undefined;
}

// Normalizes a filename down to "what produced this file" by stripping
// timestamps, numbers, dedup suffixes like " (1)", and the extension --
// two videos only share a signature if they share this remainder.
export function sourceSignature(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\d{2}[:.]\d{2}[:.]\d{2}/g, "")
    .replace(/\bat\b/g, "")
    .replace(/\(\d+\)/g, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\d+/g, "")
    .trim()
    .replace(/\s+/g, "-") || "unknown-source";
}

export interface SessionAssignment {
  key: string;
  sessionId: string;
}

// Groups videos into sessions. `overrides` (from session-overrides.json)
// wins unconditionally over the heuristic -- the manual escape hatch for
// when the automatic clustering gets a real session wrong.
export function assignSessions(videos: VideoTimestamp[], overrides: Record<string, string>, gapHours = SESSION_GAP_HOURS): SessionAssignment[] {
  const gapMs = gapHours * 60 * 60 * 1000;
  const bySignature = new Map<string, VideoTimestamp[]>();
  for (const v of videos) {
    if (overrides[v.key]) continue; // handled separately below
    const sig = sourceSignature(v.filename);
    if (!bySignature.has(sig)) bySignature.set(sig, []);
    bySignature.get(sig)!.push(v);
  }

  const assignments: SessionAssignment[] = [];
  for (const key of Object.keys(overrides)) {
    assignments.push({ key, sessionId: overrides[key] });
  }

  for (const [sig, group] of bySignature) {
    const sorted = [...group].sort((a, b) => a.timestampMs - b.timestampMs);
    let sessionStart = sorted[0].timestampMs;
    let sessionIndex = 0;
    let previous = sorted[0].timestampMs;
    // Local-time date slug, not toISOString() -- these timestamps are
    // parsed/compared as local wall-clock time (see the filename patterns
    // above), so a UTC-based slug could label a session with the wrong
    // calendar date whenever local time is behind UTC.
    const dateSlug = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    let sessionId = `${sig}_${dateSlug(sessionStart)}`;
    for (const v of sorted) {
      if (v.timestampMs - previous > gapMs) {
        sessionIndex += 1;
        sessionStart = v.timestampMs;
        sessionId = `${sig}_${dateSlug(sessionStart)}${sessionIndex > 0 ? `-${sessionIndex}` : ""}`;
      }
      assignments.push({ key: v.key, sessionId });
      previous = v.timestampMs;
    }
  }
  return assignments;
}

export interface SessionMetadataEntry {
  golferHandedness: "left" | "right" | "unknown";
  cameraAngle: "face-on" | "down-the-line" | "unknown";
  lightingCondition: "indoor" | "outdoor-sunny" | "outdoor-overcast" | "unknown";
  notes: string;
}

const BLANK_SESSION_METADATA: SessionMetadataEntry = {
  golferHandedness: "unknown",
  cameraAngle: "unknown",
  lightingCondition: "unknown",
  notes: "",
};

// Creates/updates session-metadata.json with a blank stub for every session
// id the heuristic has produced, WITHOUT touching entries a human has
// already filled in. This is the manual-tagging escape hatch for everything
// pixel diagnostics can't see (handedness, camera angle, lighting, and
// free-text notes on occlusion/hand-overlap/club-position) -- optional, pure
// enrichment, never blocks the pipeline if left untouched.
export async function ensureSessionMetadataStubs(path: string, sessionIds: string[]): Promise<Record<string, SessionMetadataEntry>> {
  let existing: Record<string, SessionMetadataEntry> = {};
  try {
    existing = JSON.parse(await readFile(path, "utf8"));
  } catch {
    existing = {};
  }
  let changed = false;
  for (const id of sessionIds) {
    if (!existing[id]) {
      existing[id] = { ...BLANK_SESSION_METADATA };
      changed = true;
    }
  }
  if (changed) {
    await writeFile(path, JSON.stringify(existing, null, 2));
  }
  return existing;
}

export async function loadSessionOverrides(path: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}
