// Per-checkpoint coaching cues (Caddie V3 Coach Replay). Pure helpers, no
// Deno/Supabase imports, so node --test (tests/caddieCues.test.ts) and the
// client (src/context/RealCaddieContext.tsx) use the same rules as
// analyze-swing and translate-caddie-analysis.
//
// Also the optional work_on[].checkpoint tag (see below).
//
// Gemini may write one short cue per key moment it placed in `phases`. The
// field is optional and additive: it is stored as
// analysis_json.checkpoint_cues ONLY after passing sanitizeCheckpointCues(),
// and a missing, malformed or entirely invalid value never fails an
// analysis; it is simply left out. Old rows have no cues and old clients
// ignore the field. No column or migration: analysis_json is already jsonb
// under caddie_analyses' owner-only RLS.

// The key moments analyze-swing's Gemini step names in `phases`. The client's
// Coach Replay "finish" checkpoint is this follow_through on the live (V1)
// pipeline, which has no separate held-finish phase.
export const CUE_CHECKPOINTS = ["address", "top", "impact", "follow_through"] as const;
export type CueCheckpoint = (typeof CUE_CHECKPOINTS)[number];
export type CheckpointCues = Partial<Record<CueCheckpoint, string>>;

// What the prompt asks for: short enough to read on a frozen frame in one
// glance. A cue that runs over is still shown whole up to CUE_HARD_MAX_CHARS.
export const CUE_MAX_CHARS = 90;
// Beyond this, the cue keeps its first complete sentence(s) that fit, or is
// dropped. A cue is never cut mid-sentence with "…" (Micky, 2026-11-08: a
// half-finished "Remember" line looks broken).
export const CUE_HARD_MAX_CHARS = 160;

// A cue is one plain line: strip the markdown/HTML Gemini sometimes adds,
// collapse whitespace, drop wrapping quotes. Returns null for anything that
// isn't a usable cue, including one carrying a link, and for a cue an
// earlier version of this helper already cut short (it ends in "…"), so old
// stored analyses stop showing a broken line too.
export function sanitizeCue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw;
  if (/https?:\/\/|www\./i.test(s)) return null;
  s = s.replace(/<[^>]*>/g, " "); // HTML tags
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"); // [text](url), ![alt](src)
  s = s.replace(/^\s*(?:#{1,6}|>|[-*+•]|\d+[.)])\s+/gm, ""); // heading / quote / list markers
  s = s.replace(/[*_`~]+/g, ""); // emphasis, code, strike
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^["'“‘「『]+|["'”’」』]+$/g, "").trim();
  if (!s) return null;
  if (/(?:…|\.\.\.)$/u.test(s)) return null;
  const chars = Array.from(s);
  if (chars.length <= CUE_HARD_MAX_CHARS) return s;
  // Too long: keep whole sentences that fit, never a fragment.
  const head = chars.slice(0, CUE_HARD_MAX_CHARS).join("");
  const ends = [...head.matchAll(/[.!?。！？](?=\s|$)/gu)];
  const last = ends.length ? ends[ends.length - 1] : null;
  if (!last || last.index === undefined) return null;
  const kept = head.slice(0, last.index + 1).trim();
  return kept.length >= 12 ? kept : null;
}

// Keeps only known checkpoint keys with a usable cue. When `placed` is
// given, a cue for a moment the analysis itself didn't place is dropped
// too: Coach Replay never freezes there, and the cue would be advice about
// a moment nobody identified. Returns undefined when nothing survives, so
// callers store no field at all rather than an empty object.
export function sanitizeCheckpointCues(raw: unknown, placed?: ReadonlySet<CueCheckpoint>): CheckpointCues | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const out: CheckpointCues = {};
  let any = false;
  for (const key of CUE_CHECKPOINTS) {
    if (placed && !placed.has(key)) continue;
    const cue = sanitizeCue(input[key]);
    if (cue) {
      out[key] = cue;
      any = true;
    }
  }
  return any ? out : undefined;
}

// Which key moments the analysis's own `phases` (raw Gemini snake_case
// shape) actually placed: a numeric timestamp for address/top/
// follow_through, a numeric window for impact.
export function placedCueCheckpoints(rawPhases: unknown): Set<CueCheckpoint> {
  const placed = new Set<CueCheckpoint>();
  if (!rawPhases || typeof rawPhases !== "object") return placed;
  const phases = rawPhases as Record<string, Record<string, unknown> | null | undefined>;
  const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  for (const key of ["address", "top", "follow_through"] as const) {
    if (isNum(phases[key]?.timestamp_seconds)) placed.add(key);
  }
  if (isNum(phases.impact?.window_start_seconds) && isNum(phases.impact?.window_end_seconds)) placed.add("impact");
  return placed;
}

// ── work_on[].checkpoint ────────────────────────────────────────────────
// Gemini may tag each work_on item with the key moment it shows most, or
// whole_swing. Optional and additive like the cues: an unknown or missing
// tag is simply removed from that item (the item itself is kept), so it can
// never fail an analysis. Old rows have no tag; Coach Replay then falls back
// to its own placement (the main focus on the weakest checkpoint).
export const WORK_ON_CHECKPOINTS = ["address", "top", "impact", "follow_through", "whole_swing"] as const;
export type WorkOnCheckpoint = (typeof WORK_ON_CHECKPOINTS)[number];

export function sanitizeWorkOnCheckpoint(raw: unknown): WorkOnCheckpoint | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  return (WORK_ON_CHECKPOINTS as readonly string[]).includes(v) ? (v as WorkOnCheckpoint) : undefined;
}

// Rewrites each work_on item's `checkpoint` to its sanitized value, or
// removes the key. Leaves everything else (including non-object items and
// a non-array work_on, which analyze-swing's own shape check handles)
// exactly as it was. Never throws.
export function withSanitizedWorkOnCheckpoints<T extends Record<string, unknown>>(json: T): T {
  try {
    if (!Array.isArray(json.work_on)) return json;
    const workOn = json.work_on.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const { checkpoint, ...rest } = item as Record<string, unknown>;
      const tag = sanitizeWorkOnCheckpoint(checkpoint);
      return tag ? { ...rest, checkpoint: tag } : rest;
    });
    return { ...json, work_on: workOn };
  } catch {
    return json;
  }
}

// Replaces whatever Gemini put in checkpoint_cues with the sanitized value,
// or removes the field. Never throws, whatever the input: a bad cue must
// not cost the golfer the analysis.
export function withSanitizedCheckpointCues<T extends Record<string, unknown>>(json: T): T {
  const { checkpoint_cues: rawCues, ...rest } = json;
  let cues: CheckpointCues | undefined;
  try {
    cues = sanitizeCheckpointCues(rawCues, placedCueCheckpoints(json.phases));
  } catch {
    cues = undefined;
  }
  return (cues ? { ...rest, checkpoint_cues: cues } : rest) as T;
}
