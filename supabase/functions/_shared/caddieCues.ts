// Per-checkpoint coaching cues (Caddie V3 Coach Replay). Pure helpers, no
// Deno/Supabase imports, so node --test (tests/caddieCues.test.ts) and the
// client (src/context/RealCaddieContext.tsx) use the same rules as
// analyze-swing and translate-caddie-analysis.
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

// Short enough to read on a frozen frame in one glance.
export const CUE_MAX_CHARS = 90;

// A cue is one plain line: strip the markdown/HTML Gemini sometimes adds,
// collapse whitespace, drop wrapping quotes, and cap the length (on a word
// boundary when there is one, so a Latin-script cue isn't cut mid-word; CJK
// has no spaces and is cut by code point). Returns null for anything that
// isn't a usable cue, including one carrying a link.
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
  const chars = Array.from(s);
  if (chars.length <= CUE_MAX_CHARS) return s;
  let cut = chars.slice(0, CUE_MAX_CHARS - 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace >= Math.floor(CUE_MAX_CHARS * 0.6)) cut = cut.slice(0, lastSpace);
  cut = cut.replace(/[\s,;:.\-–—、。，]+$/u, "");
  return cut ? `${cut}…` : null;
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
