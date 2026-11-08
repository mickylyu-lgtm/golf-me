// Admin product analytics (Platform Dashboard): pure helpers + types for the
// admin_analytics_* RPCs (migration 20261108120000). Definitions live in
// docs/ANALYTICS_CONTRACT.md. Nothing here computes a metric: every number
// comes from the server. This file only decides how to ask, how to read an
// error, when to refresh and how to label what came back.

export const REPORTING_TIMEZONE = "America/New_York";
export const REPORTING_TIMEZONE_LABEL = "Eastern Time (America/New_York)";

// ---------------------------------------------------------------- ranges

export type RangeKey = "today" | "7d" | "30d" | "custom";

export interface DateRange {
  from: string; // YYYY-MM-DD, reporting timezone, inclusive
  to: string; // YYYY-MM-DD, reporting timezone, inclusive
}

/** Today's calendar date in the reporting timezone, as YYYY-MM-DD. */
export function reportingToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Calendar arithmetic on a YYYY-MM-DD string (no timezone involved). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysInclusive(range: DateRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Preset ranges end today (a partial day, labelled as such in the UI). */
export function presetRange(key: Exclude<RangeKey, "custom">, now: Date = new Date()): DateRange {
  const today = reportingToday(now);
  if (key === "today") return { from: today, to: today };
  return { from: addDays(today, key === "7d" ? -6 : -29), to: today };
}

/** Server limit is 366 days, no future start; returns an error string or null. */
export function validateRange(range: DateRange, now: Date = new Date()): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(range.from) || !re.test(range.to)) return "Pick a start and end date.";
  if (range.to < range.from) return "The end date is before the start date.";
  if (range.from > reportingToday(now)) return "The range starts in the future.";
  if (daysInclusive(range) > 366) return "Pick at most 366 days.";
  return null;
}

// ---------------------------------------------------------------- results

export type SectionState<T> =
  | { kind: "loading" }
  | { kind: "ok"; data: T }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string; data?: T }; // data = last good value, shown as stale

interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

export const NOT_SET_UP_REASON =
  "Not set up yet: migration 20261108120000 (admin product analytics) is prepared but not applied.";

/**
 * A missing function (migration not applied) is "unavailable", never zero
 * and never a generic failure. Everything else is an error.
 */
export function classifyRpcError(error: RpcErrorLike): { kind: "unavailable"; reason: string } | { kind: "error"; message: string } {
  const code = error.code ?? "";
  const message = error.message ?? "Unknown error";
  if (code === "PGRST202" || code === "42883" || /could not find the function/i.test(message)) {
    return { kind: "unavailable", reason: NOT_SET_UP_REASON };
  }
  if (code === "42501") return { kind: "error", message: "Not authorized (admin role required)." };
  return { kind: "error", message };
}

/** Next state after a refresh: a failed refresh keeps the last good data, marked stale. */
export function nextSectionState<T>(prev: SectionState<T>, outcome: { data: T } | { error: RpcErrorLike }): SectionState<T> {
  if ("data" in outcome) return { kind: "ok", data: outcome.data };
  const c = classifyRpcError(outcome.error);
  if (c.kind === "unavailable") return c;
  const last = prev.kind === "ok" ? prev.data : prev.kind === "error" ? prev.data : undefined;
  return { kind: "error", message: c.message, data: last };
}

// ---------------------------------------------------------------- live refresh

export const LIVE_INTERVAL_MS = 30_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
export const NOT_SET_UP_INTERVAL_MS = 5 * 60_000;

/** 30 s while healthy; doubling up to 5 min after consecutive failures. */
export function nextDelayMs(consecutiveFailures: number, base: number = LIVE_INTERVAL_MS): number {
  if (consecutiveFailures <= 0) return base;
  return Math.min(base * 2 ** consecutiveFailures, MAX_BACKOFF_MS);
}

export type LiveStatus = "starting" | "live" | "paused" | "stale" | "not_set_up";

/**
 * Live = the last successful refresh is recent. Stale = it isn't (failures,
 * or the timer stopped). Paused = the page is hidden (no refreshes).
 */
export function liveStatus(opts: {
  hidden: boolean;
  lastSuccessAt: number | null;
  now: number;
  notSetUp: boolean;
  intervalMs?: number;
}): LiveStatus {
  if (opts.notSetUp) return "not_set_up";
  if (opts.hidden) return "paused";
  if (opts.lastSuccessAt === null) return "starting";
  const interval = opts.intervalMs ?? LIVE_INTERVAL_MS;
  return opts.now - opts.lastSuccessAt > interval * 2 + 5_000 ? "stale" : "live";
}

// ---------------------------------------------------------------- formatting

/** "42%" or a pending/empty label; never turns "no data" into 0%. */
export function fmtRate(numerator: number | null | undefined, denominator: number | null | undefined): string {
  if (numerator == null || denominator == null) return "—";
  if (denominator === 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

/** Dn retention: pending when no cohort member is old enough yet. */
export function fmtRetention(d: { mature_users: number; retained: number; pending_users: number }): { value: string; detail: string } {
  if (d.mature_users === 0) {
    return { value: "Pending", detail: d.pending_users > 0 ? `${d.pending_users} too recent to measure` : "No signups in range" };
  }
  const pending = d.pending_users > 0 ? ` · ${d.pending_users} pending` : "";
  return { value: fmtRate(d.retained, d.mature_users), detail: `${d.retained} of ${d.mature_users}${pending}` };
}

export function fmtDuration(minutes: number | string | null | undefined): string {
  if (minutes == null) return "—";
  const m = Number(minutes);
  if (!Number.isFinite(m)) return "—";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 48 * 60) return `${Math.round((m / 60) * 10) / 10} h`;
  return `${Math.round((m / 1440) * 10) / 10} days`;
}

export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

// ---------------------------------------------------------------- RPC shapes (version 1)

interface RangeInfo {
  from: string;
  to: string;
  start_at: string;
  end_at: string;
  partial: boolean;
  prev_start?: string;
  prev_end?: string;
  days?: number;
}

export interface ActivityData {
  version: 1;
  timezone: string;
  range: RangeInfo;
  active_users: number;
  prev_active_users: number;
  new_active_users: number;
  returning_active_users: number;
  by_source: { round_join: number; dm: number; round_message: number };
  daily: { day: string; active: number; partial: boolean }[];
  active_last_5_min: number;
  dau_today: number;
  wau_rolling_7d: number;
  mau_rolling_30d: number;
  stickiness_30d: { avg_dau: number | string | null; unique_users: number };
  coverage: { events_tracking_started_at: string | null; join_history: string; deleted_accounts: string };
}

interface RetentionDay {
  mature_users: number;
  retained: number;
  pending_users: number;
}

export interface RetentionData {
  version: 1;
  timezone: string;
  range: RangeInfo;
  cohort_users: number;
  onboarded_users: number;
  onboarding_events_since_tracking: number;
  cohorts: { day: string; size: number; onboarded: number; d1: number | null; d7: number | null; d30: number | null }[];
  d1: RetentionDay;
  d7: RetentionDay;
  d30: RetentionDay;
  first_activity: { users_with_activity: number; users_without_activity: number; median_hours: number | string | null };
  coverage: Record<string, string | null>;
}

export interface GolfCallsData {
  version: 1;
  range: RangeInfo;
  rounds_hosted: number;
  unique_hosts: number;
  rounds_with_a_join: number;
  fill: { rounds: number; slots_total: number; slots_taken_now: number; rounds_full_now: number };
  median_minutes_to_first_join: number | string | null;
  zero_join_past_rounds: number;
  zero_join_upcoming_rounds: number;
  cancelled_rounds: number;
  cancel_events_in_range: number;
  upcoming_now: number;
  played: { host_confirmed: number; participant_confirmed: number; both: number; combined_deduped: number; estimated: null };
  joins: number;
  unique_joiners: number;
  joiners_into_excluded_hosts_rounds: number;
  repeat_joiners: number;
  co_participation_pairs: number;
  coverage: Record<string, string | null>;
}

export interface SocialData {
  version: 1;
  range: RangeInfo;
  active_users: number;
  messaging_users: number;
  dm_senders: number;
  round_chat_senders: number;
  dm_messages: number;
  dm_messages_later_unsent: number;
  round_chat_messages: number;
  messages_per_active_user: number | string | null;
  two_way_dm_conversations: number;
  new_two_way_dm_conversations: number;
  round_chats_active: number;
  round_chats_two_way: number;
  post_creators: number;
  posts: number;
  commenters: number;
  post_interactors: number;
  community_users: number;
  active_in_community: number;
  active_messaging: number;
  coverage: Record<string, string>;
}

export interface CaddieData {
  version: 1;
  range: RangeInfo;
  analyses: number;
  unique_users: number;
  repeat_users: number;
  returning_users: number;
  complete: number;
  failed: number;
  processing: number;
  coverage: Record<string, string>;
}

export interface ExclusionsData {
  version: 1;
  listed: { user_id: string; name: string | null; reason: string; added_at: string }[];
  by_role: { user_id: string; name: string | null; role: string }[];
  excluded_total: number;
}
