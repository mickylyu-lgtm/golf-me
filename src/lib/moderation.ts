// Admin moderation (migration 20261107270000_admin_moderation): soft removal
// of posts/comments, account suspension, audit log. The server is the only
// enforcement: these helpers just shape requests/answers for the UI.
//
// Feature detection: my_moderation_status() exists only once the migration
// is applied. Until then (function missing) every admin control and the
// suspension banner stay hidden.

/** Same keys as private.moderation_reasons() (and the CHECK constraints). */
export const MODERATION_REASONS = ["impersonation", "spam", "harassment", "hate", "sexual", "violence", "scam", "other"] as const;
export type ModerationReason = (typeof MODERATION_REASONS)[number];

// Admin-only UI, plain English like the admin dashboard.
export const MODERATION_REASON_LABELS: Record<ModerationReason, string> = {
  impersonation: "Impersonation",
  spam: "Spam or advertising",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual content",
  violence: "Violence or threats",
  scam: "Scam or fraud",
  other: "Other (add a note)",
};

export function moderationReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "-";
  return (MODERATION_REASON_LABELS as Record<string, string>)[reason]?.replace(" (add a note)", "") ?? reason;
}

export const MODERATION_NOTE_MAX = 500;

/** Mirrors private.moderation_check_reason: null when OK, else what to fix. */
export function moderationInputProblem(reason: string | null, note: string): string | null {
  if (!reason || !(MODERATION_REASONS as readonly string[]).includes(reason)) return "Pick a reason.";
  if (reason === "other" && note.trim() === "") return 'Add a short note for "Other".';
  if (note.trim().length > MODERATION_NOTE_MAX) return `The note can be at most ${MODERATION_NOTE_MAX} characters.`;
  return null;
}

export const SUSPENSION_DURATIONS = [
  { key: "1d", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "indefinite", label: "Until lifted", ms: null },
] as const;
export type SuspensionDurationKey = (typeof SUSPENSION_DURATIONS)[number]["key"];

/** The p_until argument: an ISO time, or null for "until lifted". */
export function suspensionUntil(key: SuspensionDurationKey, now: number = Date.now()): string | null {
  const d = SUSPENSION_DURATIONS.find((x) => x.key === key);
  if (!d || d.ms === null) return null;
  return new Date(now + d.ms).toISOString();
}

// The suspension trigger (private.reject_suspended_write) raises P0001 with
// this token in the message prefix and the hint.
export const ACCOUNT_SUSPENDED_TOKEN = "account_suspended";

// Not `instanceof Error`: contexts either rethrow the raw PostgrestError or
// wrap its message in a new Error (same as isObjectionableContentError).
export function isAccountSuspendedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { message, hint } = err as { message?: unknown; hint?: unknown };
  return [message, hint].some((s) => typeof s === "string" && s.includes(ACCOUNT_SUSPENDED_TOKEN));
}

export interface ModerationStatus {
  /** The migration is applied (my_moderation_status exists). */
  available: boolean;
  isAdmin: boolean;
  suspended: boolean;
  /** null with suspended = until lifted. */
  suspendedUntil: string | null;
}

export const MODERATION_UNAVAILABLE: ModerationStatus = { available: false, isAdmin: false, suspended: false, suspendedUntil: null };

interface RpcErrorLike {
  code?: string;
  message?: string;
}

/** PostgREST's "function not found" (schema cache) or Postgres' undefined_function. */
export function isMissingFunctionError(error: RpcErrorLike | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

/**
 * Turns the my_moderation_status() answer into UI state. A missing function
 * (not applied yet) or any other error leaves every moderation control off:
 * failing closed only hides admin buttons and the banner; the server still
 * enforces a suspension either way.
 */
export function parseModerationStatus(data: unknown, error: RpcErrorLike | null | undefined): ModerationStatus {
  if (error) return MODERATION_UNAVAILABLE;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { is_admin?: unknown; suspended?: unknown; suspended_until?: unknown }
    | null
    | undefined;
  if (!row || typeof row !== "object") return MODERATION_UNAVAILABLE;
  const suspended = row.suspended === true;
  return {
    available: true,
    isAdmin: row.is_admin === true,
    suspended,
    suspendedUntil: suspended && typeof row.suspended_until === "string" ? row.suspended_until : null,
  };
}
