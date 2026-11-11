// Caddie > Upload a swing video: preparing a picked video before it becomes
// the draft. Each pick first reads the clip's length (decides trim selector
// or not) and copies the bytes into memory (the WebKit eviction fix in
// AnalyzeSwing). Both are awaits of unbounded length (up to a 200 MB copy,
// a metadata read with its own timeout), and the picker stays usable
// meanwhile, so: pick A, pick B, B is ready first, then A finishing late
// used to overwrite B in the draft (or open the trim selector on A).
//
// The gate hands out one token per pick. Only the newest token, while the
// page is open, may set the draft, open the selector or clear the
// "preparing" state. Remove, a newer pick and leaving the page all
// invalidate the older one. Neither read can be aborted (no AbortSignal on
// a <video> metadata read or File.arrayBuffer), so this never depends on
// cancellation: a stale read just finishes and its result is dropped. The
// preview object URL is only created for the winner, so a dropped result
// has nothing to revoke.

import { caddieDurationRejection } from "./caddieUploadLimit.ts";
import type { CaddieDurationRejection } from "./caddieUploadLimit.ts";

export interface VideoSelectionGate {
  /** Starts preparing a pick; supersedes any earlier one. Never current while closed. */
  begin(): number;
  /** True only for the newest token of an open gate that nobody cancelled. */
  isCurrent(token: number): boolean;
  /** Ends this token's pending state (no-op for an older one). */
  end(token: number): void;
  /** Drops the pick being prepared (Remove). */
  cancel(): void;
  /** Leaving the page: drops the pending pick and refuses later ones until reopened. */
  close(): void;
  /** The page is (again) mounted. */
  open(): void;
  readonly pending: boolean;
}

export function createVideoSelectionGate(): VideoSelectionGate {
  let seq = 0;
  let active: number | null = null;
  let isOpen = true;
  return {
    begin() {
      seq += 1;
      active = isOpen ? seq : null;
      return seq;
    },
    isCurrent(token) {
      return isOpen && active === token;
    },
    end(token) {
      if (active === token) active = null;
    },
    cancel() {
      active = null;
    },
    close() {
      isOpen = false;
      active = null;
    },
    open() {
      isOpen = true;
    },
    get pending() {
      return active !== null;
    },
  };
}

/**
 * Why a picked file can't be used at all, checked before anything is read:
 * not a video (a native pick that couldn't be read arrives as an empty
 * untyped file, lib/mediaPicker.ts unreadablePickFile), an empty file, or
 * over the size cap. Null if it's worth preparing. Such a pick still
 * supersedes an older one (Micky, 2026-11-06: the newest selection wins,
 * even an invalid one; the older pick is never silently restored).
 */
export function videoPickRejection(file: { type: string; size: number }, maxBytes: number): "unsupported" | "too_large" | null {
  if (!file.type.startsWith("video/") || file.size === 0) return "unsupported";
  if (file.size > maxBytes) return "too_large";
  return null;
}

export type VideoSelectionOutcome<F> =
  // A newer pick, Remove or leaving the page won: do nothing at all (no
  // draft, no selector, no toast, no loading change).
  | { kind: "stale" }
  | { kind: "rejected"; reason: CaddieDurationRejection }
  // Only a known, positive source duration of under 10 seconds is ready.
  | { kind: "ready"; file: F; duration: number };

/**
 * Reads the length and makes the stable copy for one pick, then answers
 * only if that pick is still the newest. Reject an overlong or unreadable
 * source before making the in-memory copy. A copy failure keeps the original
 * file; a stale result is never reported.
 */
export async function prepareVideoSelection<F>(opts: {
  gate: VideoSelectionGate;
  token: number;
  file: F;
  readDuration: (file: F) => Promise<number>;
  /** Returns the copy to keep (or the same file when none is needed). */
  stabilize: (file: F) => Promise<F>;
  onStabilizeError?: (err: unknown) => void;
}): Promise<VideoSelectionOutcome<F>> {
  const { gate, token, file } = opts;
  try {
    let duration: number | undefined;
    try {
      duration = await opts.readDuration(file);
    } catch {
      duration = undefined;
    }
    if (!gate.isCurrent(token)) return { kind: "stale" };
    const rejection = caddieDurationRejection(duration);
    if (rejection) return { kind: "rejected", reason: rejection };
    let stable = file;
    try {
      stable = await opts.stabilize(file);
    } catch (err) {
      if (gate.isCurrent(token)) opts.onStabilizeError?.(err);
    }
    if (!gate.isCurrent(token)) return { kind: "stale" };
    return { kind: "ready", file: stable, duration: duration! };
  } finally {
    gate.end(token);
  }
}
