// Safety Review (migration 20261108180000_safety_review): admin-only,
// shadow-mode behaviour flags. Pure helpers for the admin component; no
// Supabase/React imports (tests/safetyReview.test.ts). The server is the
// only authority on transitions and access; these just shape the UI.

export const SAFETY_SIGNALS = ["new_recipients", "duplicate_public", "distinct_reporters"] as const;
export type SafetySignal = (typeof SAFETY_SIGNALS)[number];
export const SAFETY_STATUSES = ["new", "in_review", "dismissed", "actioned", "appealed"] as const;
export type SafetyStatus = (typeof SAFETY_STATUSES)[number];

// Plain English, like the rest of the admin dashboard.
export const SIGNAL_LABELS: Record<SafetySignal, { title: string; unit: string; source: "automated" | "reports" }> = {
  new_recipients: { title: "Many new people messaged", unit: "new conversations started", source: "automated" },
  duplicate_public: { title: "Repeated public posts or comments", unit: "identical posts/comments", source: "automated" },
  distinct_reporters: { title: "Reported by several people", unit: "different people reported", source: "reports" },
};
export const STATUS_LABELS: Record<SafetyStatus, string> = {
  new: "New",
  in_review: "In review",
  dismissed: "Dismissed",
  actioned: "Violation confirmed",
  appealed: "Appealed",
};

/** Mirrors admin_safety_review's allowed transitions (the server re-checks). */
export function allowedTransitions(status: SafetyStatus): SafetyStatus[] {
  switch (status) {
    case "new":
      return ["in_review", "dismissed", "actioned"];
    case "in_review":
      return ["new", "dismissed", "actioned"];
    case "actioned":
      return ["appealed"];
    case "appealed":
      return ["dismissed", "actioned"];
    case "dismissed":
      return ["in_review"];
  }
}
export function transitionNeedsReason(to: SafetyStatus): boolean {
  return to === "dismissed" || to === "actioned" || to === "appealed";
}
export const TRANSITION_LABELS: Record<SafetyStatus, string> = {
  new: "Back to new",
  in_review: "Start review",
  dismissed: "Dismiss",
  actioned: "Confirm violation",
  appealed: "Record appeal",
};

export function formatWindow(seconds: number): string {
  if (seconds % 86400 === 0) return seconds === 86400 ? "24 hours" : `${seconds / 86400} days`;
  if (seconds % 3600 === 0) return seconds === 3600 ? "1 hour" : `${seconds / 3600} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}

/** "10 new conversations started in 10 minutes (threshold 10, rule v1)". */
export function flagSummary(f: { signal: string; observed_count: number; threshold: number; window_seconds: number; rule_version: number }): string {
  const meta = (SIGNAL_LABELS as Record<string, { unit: string }>)[f.signal];
  return `${f.observed_count} ${meta?.unit ?? "events"} in ${formatWindow(f.window_seconds)} (threshold ${f.threshold}, rule v${f.rule_version})`;
}

export interface SafetyStatusPayload {
  detector_enabled: boolean;
  last_run_at: string | null;
  last_run_ok: boolean | null;
  last_run_error: string | null;
  unconfirmed_retention_days: number;
  confirmed_retention_days: number;
  rules: { signal: string; version: number; threshold: number; window_seconds: number; note: string | null }[];
  open_counts: Record<string, number>;
}

export type SafetyAvailability =
  | { kind: "ready"; status: SafetyStatusPayload }
  /** Migration not applied (function missing): Reports still work. */
  | { kind: "not_installed" }
  /** Any other failure: never shown as "no flags". */
  | { kind: "error"; message: string };

export function availabilityFrom(data: unknown, error: { code?: string; message?: string } | null | undefined): SafetyAvailability {
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "")) return { kind: "not_installed" };
    return { kind: "error", message: error.message ?? "Unknown error" };
  }
  if (!data || typeof data !== "object") return { kind: "error", message: "Empty answer from the server" };
  return { kind: "ready", status: data as SafetyStatusPayload };
}

/** What the queue's header says, so a detector problem never reads as "no abuse". */
export function detectorNotice(s: SafetyStatusPayload, now: number = Date.now()): { tone: "off" | "error" | "stale" | "ok"; text: string } {
  if (!s.detector_enabled) return { tone: "off", text: "Detector off: no automated flags are being produced. Reports and blocking work as usual." };
  if (s.last_run_ok === false) return { tone: "error", text: `The last detector run failed${s.last_run_error ? ` (${s.last_run_error})` : ""}. Missing flags don't mean there's no abuse.` };
  if (!s.last_run_at) return { tone: "stale", text: "The detector hasn't run yet (it runs every 5 minutes)." };
  if (now - new Date(s.last_run_at).getTime() > 20 * 60 * 1000) return { tone: "stale", text: "The detector hasn't run for over 20 minutes. Missing flags don't mean there's no abuse." };
  return { tone: "ok", text: "Shadow mode: flags are for review only. Nothing is done to any account automatically." };
}

export const SINCE_OPTIONS = [
  { key: "24h", label: "24 h", ms: 24 * 3600 * 1000 },
  { key: "7d", label: "7 days", ms: 7 * 24 * 3600 * 1000 },
  { key: "30d", label: "30 days", ms: 30 * 24 * 3600 * 1000 },
  { key: "all", label: "All", ms: null },
] as const;
export type SinceKey = (typeof SINCE_OPTIONS)[number]["key"];
export function sinceIso(key: SinceKey, now: number = Date.now()): string | null {
  const o = SINCE_OPTIONS.find((x) => x.key === key);
  return o && o.ms !== null ? new Date(now - o.ms).toISOString() : null;
}
