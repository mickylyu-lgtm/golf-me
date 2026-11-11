import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { RegisteredUsersSection } from "../components/admin/RegisteredUsersSection";
import type { AdminUserRow } from "../lib/adminUsers";
import { AnalyticsPanel } from "../components/admin/AnalyticsPanel";
import { fmtAgo } from "../lib/adminAnalytics";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import type { RefreshOutcome } from "../lib/useLiveRefresh";
import { Bell, Calendar, Flag, LayoutGrid, MessageSquare, Smartphone, TrendingDown, TrendingUp, Trophy, Wand2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useRoles } from "../lib/useRoles";
import { ReportChatImages } from "../components/admin/ReportChatImages";
import { supabase } from "../lib/supabase";
import { EmptyState } from "../components/ui/EmptyState";
import { BookingEvidenceReview } from "../components/admin/BookingEvidenceReview";
import { SafetyReview } from "../components/admin/SafetyReview";
import { ModerationPanel } from "../components/admin/ModerationPanel";
import { useModerationAdminData } from "../lib/useModerationAdminData";
import { RemoveContentDialog } from "../components/moderation/RemoveContentDialog";
import { SuspendUserDialog } from "../components/moderation/SuspendUserDialog";

// Internal admin tool only — same access model as AdminReviewers.tsx
// (hidden from nav, gated on isAdmin client-side, re-verified server-side
// by every RPC), and same reasoning for staying plain English rather than
// routed through the i18n system.
interface CaddieStats {
  total_analyses: number;
  analyses_last_24h: number;
  analyses_prev_24h: number;
  analyses_last_7d: number;
  analyses_prev_7d: number;
  processing_now: number;
  unique_users: number;
  avg_score: number | null;
  avg_score_prev_7d: number | null;
  score_low_count: number;
  score_mid_count: number;
  score_high_count: number;
  // Only knowable since analyze-swing's fail() stopped deleting the row on
  // failure (Phase 22) — a failed analysis used to leave nothing behind to
  // count.
  failed_total: number;
  failed_last_7d: number;
}

interface PlatformOverview {
  total_users: number;
  onboarded_users: number;
  golf_calls_total: number;
  rounds_completed: number;
  community_posts_total: number;
  messages_total: number;
  caddie_analyses_total: number;
  push_tokens_registered: number;
}

interface GolfCallStats {
  total: number;
  open_count: number;
  full_count: number;
  completed_count: number;
  cancelled_count: number;
  avg_participants: number | null;
  hosted_last_24h: number;
  hosted_prev_24h: number;
  hosted_last_7d: number;
  hosted_prev_7d: number;
}

interface CommunityStats {
  posts_total: number;
  posts_text: number;
  posts_photo: number;
  posts_course: number;
  posts_round: number;
  posts_swing: number;
  comments_total: number;
  votes_total: number;
  saved_total: number;
  hidden_total: number;
  posts_last_24h: number;
  posts_prev_24h: number;
  posts_last_7d: number;
  posts_prev_7d: number;
}

interface ReputationDistributionRow {
  tier_key: string;
  golfer_count: number;
}

interface MessagingStats {
  conversations_total: number;
  messages_total: number;
  messages_last_24h: number;
  messages_prev_24h: number;
  messages_last_7d: number;
  messages_prev_7d: number;
  notifications_total: number;
  notifications_unread: number;
}

interface PushStats {
  tokens_registered: number;
  users_with_token: number;
  push_enabled_count: number;
  push_disabled_count: number;
}

// Plain-English tier labels, independent of the i18n-driven
// tierDisplayName() the rest of the app uses — this page stays plain
// English throughout (see the file-header comment), same reasoning as
// every other label here.
const TIER_LABELS: Record<string, string> = {
  newcomer_1: "Newcomer I",
  newcomer_2: "Newcomer II",
  newcomer_3: "Newcomer III",
  established_1: "Established I",
  established_2: "Established II",
  established_3: "Established III",
  trusted_1: "Trusted I",
  trusted_2: "Trusted II",
  trusted_3: "Trusted III",
  premier_1: "Premier I",
  premier_2: "Premier II",
  premier_3: "Premier III",
  elite: "Elite",
};
const TIER_ORDER = Object.keys(TIER_LABELS);

// current vs the immediately-preceding comparable period (e.g. last 24h vs
// the 24h before that) — null previous means there's no prior-period data
// yet to compare against, so no arrow rather than a misleading one.
function TrendIndicator({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return null;
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta === 0) return <span className="text-xs font-semibold text-slate-400">—</span>;
  const isUp = delta > 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${isUp ? "text-fairway-600" : "text-rose-600"}`}>
      <Icon size={12} />
      {isUp ? "+" : ""}
      {delta}
    </span>
  );
}

interface WeekCounts {
  last: number; // added in the last 7 days
  prev: number; // added in the 7 days before that
}

const DAY_MS = 24 * 60 * 60 * 1000;

function weekCounts(dates: (string | null | undefined)[]): WeekCounts {
  const now = Date.now();
  let last = 0;
  let prev = 0;
  for (const d of dates) {
    const t = d ? Date.parse(d) : NaN;
    if (!Number.isFinite(t)) continue;
    const age = now - t;
    if (age < 7 * DAY_MS) last++;
    else if (age < 14 * DAY_MS) prev++;
  }
  return { last, prev };
}

// All-time totals: what was added in the last 7 days and the 7 days before,
// as plain counts. Replaces the 2026-10-28 percent badge: a "+5953%" on a
// small base (2026-11-08 screenshot) read as growth it wasn't.
function WeekAdded({ last, prev }: WeekCounts) {
  return (
    <p className="text-[11px] text-slate-400" title="Rows created in each 7-day window (every account, incl. test/admin)">
      +{last} last 7 days · +{prev} week before
    </p>
  );
}

function SectionError({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3">
      <p className="text-xs text-rose-700">
        <span className="font-semibold">Couldn't load {what}.</span> Nothing is shown rather than a wrong number. ({message})
      </p>
      <button type="button" onClick={onRetry} className="shrink-0 rounded-full border border-rose-300 bg-white px-3 py-1 text-xs font-semibold text-rose-700">
        Retry
      </button>
    </div>
  );
}

interface CaddieAnalysisRow {
  id: string;
  owner_name: string | null;
  owner_email: string;
  swing_type: string | null;
  status: string;
  score: number | null;
  created_at: string;
}

// admin_caddie_failure_stats() / admin_list_caddie_failures() (migration
// 20261107140000): classified categories and stages only — user ids, no
// names/emails, URLs or paths; detail is already redacted server-side.
interface CaddieFailureStatRow {
  failure_category: string;
  failure_stage: string;
  last_24h: number;
  last_7d: number;
  total: number;
}

interface CaddieFailureRow {
  id: string;
  owner_id: string;
  status: string;
  attempt: number;
  failure_stage: string | null;
  failure_category: string | null;
  provider_http_status: number | null;
  created_at: string;
  finished_at: string | null;
  detail: string | null;
}

const CADDIE_STATUS_STYLES: Record<string, string> = {
  complete: "bg-fairway-50 text-fairway-700",
  processing: "bg-sky-50 text-sky-700",
  // Failed rows persist now (Phase 22 fix) instead of being deleted, so
  // this list can genuinely show one.
  failed: "bg-rose-50 text-rose-700",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface ReportRow {
  id: string;
  reporter_id: string;
  reporter_name: string | null;
  reporter_username: string | null;
  reported_user_id: string | null;
  reported_name: string | null;
  reported_username: string | null;
  reported_message_id: string | null;
  round_id: string | null;
  // From 20261104120000; optional so rows from a database without it still render.
  reported_post_id?: string | null;
  reported_comment_id?: string | null;
  category: string;
  context: string;
  details: string;
  status: string;
  created_at: string;
}

const REPORT_STATUS_STYLES: Record<string, string> = {
  open: "bg-rose-50 text-rose-700",
  reviewed: "bg-sky-50 text-sky-700",
  actioned: "bg-fairway-50 text-fairway-700",
  dismissed: "bg-slate-100 text-slate-500",
};

// The three states an admin can move a report to — mirrors the allowed set
// in admin_set_report_status() ('open' is only the insert default). These
// only file the report; they never remove or hide anything (that's
// Remove post / Remove comment / Suspend above them), so the labels say "Mark".
const REPORT_ACTIONS = [
  { status: "reviewed", label: "Mark reviewed" },
  { status: "actioned", label: "Mark actioned" },
  { status: "dismissed", label: "Mark dismissed" },
] as const;

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function personLabel(name: string | null, username: string | null) {
  return `${name ?? "Unknown"}${username ? ` (@${username})` : ""}`;
}

export function AdminDashboard() {
  const { isDemo, authUser } = useAuth();
  const selfId = authUser?.id ?? null;
  const { isAdmin, loading: rolesLoading } = useRoles();

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [caddieStats, setCaddieStats] = useState<CaddieStats | null>(null);
  const [caddieAnalyses, setCaddieAnalyses] = useState<CaddieAnalysisRow[]>([]);
  const [caddieFailureStats, setCaddieFailureStats] = useState<CaddieFailureStatRow[]>([]);
  const [caddieFailures, setCaddieFailures] = useState<CaddieFailureRow[]>([]);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [golfCallStats, setGolfCallStats] = useState<GolfCallStats | null>(null);
  const [communityStats, setCommunityStats] = useState<CommunityStats | null>(null);
  const [reputationDist, setReputationDist] = useState<ReputationDistributionRow[]>([]);
  const [messagingStats, setMessagingStats] = useState<MessagingStats | null>(null);
  const [pushStats, setPushStats] = useState<PushStats | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  // Separate from the empty state: a failed load must never look like "no reports".
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [retryingReports, setRetryingReports] = useState(false);
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Moderation (migration 20261107270000; everything below stays hidden
  // until it's applied).
  const moderationData = useModerationAdminData();
  const [removeTarget, setRemoveTarget] = useState<{ kind: "post" | "comment"; id: string; authorName: string; reportId: string } | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<{ userId: string; name: string; reportId: string } | null>(null);

  // Per-RPC failures (key = RPC name): a failed query shows an error card,
  // never an empty state or a zero.
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});

  const load = useCallback(async (opts?: { silent?: boolean }): Promise<RefreshOutcome> => {
    if (!opts?.silent) setLoading(true);
    const [
      { data: u, error: uErr },
      { data: cs, error: csErr },
      { data: ca, error: caErr },
      { data: ov, error: ovErr },
      { data: gc, error: gcErr },
      { data: co, error: coErr },
      { data: rd, error: rdErr },
      { data: ms, error: msErr },
      { data: ps, error: psErr },
      { data: rp, error: rpErr },
      { data: cfs, error: cfsErr },
      { data: cfl, error: cflErr },
    ] = await Promise.all([
      supabase.rpc("admin_list_users"),
      supabase.rpc("admin_caddie_stats"),
      supabase.rpc("admin_list_caddie_analyses", { p_limit: 50 }),
      supabase.rpc("admin_platform_overview"),
      supabase.rpc("admin_golf_call_stats"),
      supabase.rpc("admin_community_stats"),
      supabase.rpc("admin_reputation_distribution"),
      supabase.rpc("admin_messaging_stats"),
      supabase.rpc("admin_push_stats"),
      supabase.rpc("admin_list_reports", { p_limit: 100 }),
      supabase.rpc("admin_caddie_failure_stats"),
      supabase.rpc("admin_list_caddie_failures", { p_limit: 30 }),
    ]);
    const errs: Record<string, { message: string } | null> = {
      admin_caddie_failure_stats: cfsErr,
      admin_list_caddie_failures: cflErr,
      admin_list_users: uErr,
      admin_caddie_stats: csErr,
      admin_list_caddie_analyses: caErr,
      admin_platform_overview: ovErr,
      admin_golf_call_stats: gcErr,
      admin_community_stats: coErr,
      admin_reputation_distribution: rdErr,
      admin_messaging_stats: msErr,
      admin_push_stats: psErr,
    };
    const nextErrors: Record<string, string> = {};
    for (const [name, err] of Object.entries(errs)) {
      if (err) {
        console.error(`GolfMe: ${name} failed.`, err);
        nextErrors[name] = err.message;
      }
    }
    if (rpErr) console.error("GolfMe: admin_list_reports failed.", rpErr);
    setLoadErrors(nextErrors);
    // A failed RPC keeps whatever was on screen (its error card says so);
    // only a successful one replaces the data.
    if (!cfsErr) setCaddieFailureStats((cfs ?? []) as CaddieFailureStatRow[]);
    if (!cflErr) setCaddieFailures((cfl ?? []) as CaddieFailureRow[]);
    if (!uErr) setUsers((u ?? []) as AdminUserRow[]);
    if (!csErr) setCaddieStats(((cs as CaddieStats[]) ?? [])[0] ?? null);
    if (!caErr) setCaddieAnalyses((ca ?? []) as CaddieAnalysisRow[]);
    if (!ovErr) setOverview(((ov as PlatformOverview[]) ?? [])[0] ?? null);
    if (!gcErr) setGolfCallStats(((gc as GolfCallStats[]) ?? [])[0] ?? null);
    if (!coErr) setCommunityStats(((co as CommunityStats[]) ?? [])[0] ?? null);
    if (!rdErr) setReputationDist((rd ?? []) as ReputationDistributionRow[]);
    if (!msErr) setMessagingStats(((ms as MessagingStats[]) ?? [])[0] ?? null);
    if (!psErr) setPushStats(((ps as PushStats[]) ?? [])[0] ?? null);
    if (rpErr) {
      setReportsError(rpErr.message);
    } else {
      setReportsError(null);
      setReports((rp ?? []) as ReportRow[]);
    }
    setLoading(false);
    return Object.keys(nextErrors).length > 0 || rpErr ? "error" : "ok";
  }, []);

  // Totals and lists below the analytics panel refresh quietly every 60 s
  // while the page is visible (same scheduler as the panel).
  const silentLoad = useCallback(() => load({ silent: true }), [load]);
  const totalsLive = useLiveRefresh(silentLoad, { enabled: isAdmin && !isDemo, intervalMs: 60_000 });
  const retryAll = () => void totalsLive.refreshNow();

  const retryReports = useCallback(async () => {
    setRetryingReports(true);
    const { data, error } = await supabase.rpc("admin_list_reports", { p_limit: 100 });
    if (error) {
      console.error("GolfMe: admin_list_reports failed.", error);
      setReportsError(error.message);
    } else {
      setReportsError(null);
      setReports((data ?? []) as ReportRow[]);
    }
    setRetryingReports(false);
  }, []);

  const setReportStatus = useCallback(async (reportId: string, status: string) => {
    setUpdatingReportId(reportId);
    const { error } = await supabase.rpc("admin_set_report_status", { p_report_id: reportId, p_status: status });
    if (error) {
      console.error("GolfMe: admin_set_report_status failed.", error);
      window.alert(`Couldn't update the report: ${error.message}`);
    } else {
      setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, status } : r)));
    }
    setUpdatingReportId(null);
  }, []);

  if (isDemo) return <Navigate to="/" replace />;
  if (!rolesLoading && !isAdmin) return <Navigate to="/" replace />;
  if (rolesLoading) return null;

  // Never offer "Suspend" on yourself or another admin (the server refuses
  // both too: admin_suspend_user, 22023).
  const adminIds = new Set(users.filter((u) => u.is_admin).map((u) => u.id));
  const canSuspend = (userId: string) => userId !== selfId && !adminIds.has(userId);

  // Signups by member_since. Onboarded uses the same date (when they joined,
  // not when they finished onboarding, which isn't stored per user).
  const usersWeek = weekCounts(users.map((u) => u.member_since));
  const onboardedWeek = weekCounts(users.filter((u) => u.has_onboarded).map((u) => u.member_since));
  const openReportCount = reports.filter((r) => r.status === "open").length;

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Platform Dashboard</h1>
        <p className="text-sm text-slate-500">Real golfer activity first; moderation and all-time totals below.</p>
      </div>

      <AnalyticsPanel />

      <BookingEvidenceReview />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Flag size={15} className="text-fairway-600" /> Reports
          </h2>
          <span className="text-sm font-semibold text-slate-500">
            {reportsError
              ? "Unavailable"
              : reports.length >= 100
                ? `Latest 100 shown · ${openReportCount} open among them (older reports not listed)`
                : `${reports.length} total · ${openReportCount} open`}
          </span>
        </div>

        {reportsError ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3.5">
            <p className="text-sm text-rose-700">
              <span className="font-semibold">Couldn't load reports.</span> There may be open reports you can't see. ({reportsError})
            </p>
            <button
              onClick={retryReports}
              disabled={retryingReports}
              className="shrink-0 rounded-full border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              {retryingReports ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : reports.length === 0 ? (
          <EmptyState icon={<Flag size={20} />} title="No user reports yet." />
        ) : (
          <div className="flex flex-col gap-2">
            {reports.map((r) => {
              const isOpen = r.status === "open";
              return (
                <div
                  key={r.id}
                  className={`flex flex-col gap-2 rounded-2xl border p-3 ${isOpen ? "border-rose-200 bg-rose-50/40" : "border-slate-100 bg-white"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {r.category} <span className="font-normal text-slate-500">· {r.context}</span>
                      </p>
                      <p className="truncate text-xs text-slate-500">{fmtDateTime(r.created_at)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${REPORT_STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-500"}`}>
                      {r.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">
                    <p className="truncate">
                      <span className="text-slate-400">Reporter:</span> {personLabel(r.reporter_name, r.reporter_username)}
                    </p>
                    <p className="truncate">
                      <span className="text-slate-400">Reported:</span>{" "}
                      {r.reported_user_id ? personLabel(r.reported_name, r.reported_username) : "(none)"}
                    </p>
                  </div>
                  {r.details && <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">{r.details}</p>}
                  {(r.context === "chat" || r.context === "round") && r.reported_user_id && <ReportChatImages reportId={r.id} />}
                  <p className="break-all text-[11px] text-slate-400">
                    Report {r.id}
                    {r.round_id && <> · Golf Call {r.round_id}</>}
                    {r.reported_message_id && <> · Message {r.reported_message_id}</>}
                    {r.reported_post_id && <> · Post {r.reported_post_id}</>}
                    {r.reported_comment_id && <> · Comment {r.reported_comment_id}</>}
                  </p>
                  {r.reported_post_id && (
                    <Link
                      to={`/community/${r.reported_post_id}`}
                      className="self-start text-xs font-semibold text-fairway-700 underline underline-offset-2"
                    >
                      {r.reported_comment_id ? "Open the post this comment is on" : "Open reported post"}
                    </Link>
                  )}
                  {moderationData.enabled && (r.reported_post_id || r.reported_comment_id || r.reported_user_id) && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.reported_comment_id ? (
                        moderationData.isRemoved(r.reported_comment_id) ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Comment removed</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRemoveTarget({ kind: "comment", id: r.reported_comment_id ?? "", authorName: r.reported_name ?? "the author", reportId: r.id })}
                            className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600"
                          >
                            Remove comment
                          </button>
                        )
                      ) : r.reported_post_id ? (
                        moderationData.isRemoved(r.reported_post_id) ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Post removed</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRemoveTarget({ kind: "post", id: r.reported_post_id ?? "", authorName: r.reported_name ?? "the author", reportId: r.id })}
                            className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600"
                          >
                            Remove post
                          </button>
                        )
                      ) : null}
                      {r.reported_user_id &&
                        canSuspend(r.reported_user_id) &&
                        (moderationData.isSuspended(r.reported_user_id) ? (
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Suspended</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSuspendTarget({ userId: r.reported_user_id ?? "", name: r.reported_name ?? "this user", reportId: r.id })}
                            className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600"
                          >
                            Suspend {(r.reported_name ?? "user").split(" ")[0]}
                          </button>
                        ))}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400">Report status only: marking a report doesn't remove or hide the content.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {REPORT_ACTIONS.map((a) => (
                      <button
                        key={a.status}
                        type="button"
                        disabled={updatingReportId === r.id || r.status === a.status}
                        onClick={() => setReportStatus(r.id, a.status)}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 disabled:opacity-40"
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <SafetyReview />

      <ModerationPanel data={moderationData} />

      {removeTarget && (
        <RemoveContentDialog
          kind={removeTarget.kind}
          id={removeTarget.id}
          authorName={removeTarget.authorName}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            const reportId = removeTarget.reportId;
            setRemoveTarget(null);
            void moderationData.reload();
            void setReportStatus(reportId, "actioned");
          }}
        />
      )}
      {suspendTarget && (
        <SuspendUserDialog
          userId={suspendTarget.userId}
          name={suspendTarget.name}
          onClose={() => setSuspendTarget(null)}
          onSuspended={() => {
            const reportId = suspendTarget.reportId;
            setSuspendTarget(null);
            void moderationData.reload();
            void setReportStatus(reportId, "actioned");
          }}
        />
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <LayoutGrid size={15} className="text-fairway-600" /> All-time totals
          </h2>
          <p className="text-[11px] text-slate-400">
            Cumulative row counts since launch across every account, including yours, admins and test accounts. Not activity: see Product analytics above for that.
            {totalsLive.lastSuccessAt !== null && <> Updated {fmtAgo(totalsLive.now - totalsLive.lastSuccessAt)}, refreshes every 60 s while open.</>}
          </p>
        </div>
        {loadErrors.admin_platform_overview ? (
          <SectionError what="the totals" message={loadErrors.admin_platform_overview} onRetry={retryAll} />
        ) : loading && !overview ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : overview ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                { label: "Accounts (all time)", value: overview.total_users, week: loadErrors.admin_list_users ? null : usersWeek },
                { label: "Onboarded accounts", value: overview.onboarded_users, week: loadErrors.admin_list_users ? null : onboardedWeek },
                { label: "Golf Calls hosted (all time)", value: overview.golf_calls_total, week: golfCallStats && { last: golfCallStats.hosted_last_7d, prev: golfCallStats.hosted_prev_7d } },
                { label: "Rounds marked completed by host", value: overview.rounds_completed, week: null },
                { label: "Community posts (all time)", value: overview.community_posts_total, week: communityStats && { last: communityStats.posts_last_7d, prev: communityStats.posts_prev_7d } },
                { label: "DMs stored (all time, incl. welcome DMs)", value: overview.messages_total, week: messagingStats && { last: messagingStats.messages_last_7d, prev: messagingStats.messages_prev_7d } },
                { label: "Caddie analyses (all time)", value: overview.caddie_analyses_total, week: caddieStats && { last: caddieStats.analyses_last_7d, prev: caddieStats.analyses_prev_7d } },
                { label: "Push devices registered (now)", value: overview.push_tokens_registered, week: null },
              ] satisfies { label: string; value: number; week: WeekCounts | null }[]
            ).map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-slate-100 bg-white p-3">
                <p className="text-lg font-bold tabular-nums text-slate-800">{stat.value}</p>
                <p className="text-xs text-slate-500">{stat.label}</p>
                {stat.week && <WeekAdded {...stat.week} />}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <RegisteredUsersSection
        users={users}
        loading={loading}
        error={loadErrors.admin_list_users
          ? <SectionError what="users" message={loadErrors.admin_list_users} onRetry={retryAll} />
          : null}
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Wand2 size={15} className="text-fairway-600" /> Caddie Usage (all accounts)
          </h2>
        </div>

        {loadErrors.admin_caddie_stats && <SectionError what="Caddie stats" message={loadErrors.admin_caddie_stats} onRetry={retryAll} />}
        {loadErrors.admin_caddie_failure_stats && <SectionError what="Caddie failure stats" message={loadErrors.admin_caddie_failure_stats} onRetry={retryAll} />}
        {loadErrors.admin_list_caddie_failures && <SectionError what="recent Caddie failures" message={loadErrors.admin_list_caddie_failures} onRetry={retryAll} />}

        {caddieStats && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  { label: "Total analyses", value: caddieStats.total_analyses, trend: null },
                  {
                    label: "Last 24h",
                    value: caddieStats.analyses_last_24h,
                    trend: <TrendIndicator current={caddieStats.analyses_last_24h} previous={caddieStats.analyses_prev_24h} />,
                  },
                  {
                    label: "Last 7d",
                    value: caddieStats.analyses_last_7d,
                    trend: <TrendIndicator current={caddieStats.analyses_last_7d} previous={caddieStats.analyses_prev_7d} />,
                  },
                  { label: "Processing now", value: caddieStats.processing_now, trend: null },
                  { label: "Unique users", value: caddieStats.unique_users, trend: null },
                  {
                    label: "Avg score",
                    value: caddieStats.avg_score ?? "—",
                    trend:
                      caddieStats.avg_score !== null ? <TrendIndicator current={caddieStats.avg_score} previous={caddieStats.avg_score_prev_7d} /> : null,
                  },
                  // Only knowable since Phase 22's analyze-swing fix — fail()
                  // used to delete the row outright, leaving nothing to count.
                  { label: "Failed (all time)", value: caddieStats.failed_total, trend: null },
                  { label: "Failed (7d)", value: caddieStats.failed_last_7d, trend: null },
                ] satisfies { label: string; value: number | string; trend: ReactNode }[]
              ).map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-slate-100 bg-white p-3">
                  <div className="flex items-center gap-1.5">
                    <p className="text-lg font-bold text-slate-800">{stat.value}</p>
                    {stat.trend}
                  </div>
                  <p className="text-xs text-slate-500">{stat.label}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">Last 24h/7d and avg score trends compare against the immediately preceding period of the same length.</p>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Score distribution (complete analyses)</p>
              <div className="flex overflow-hidden rounded-xl border border-slate-100 bg-white text-xs font-semibold">
                <div className="flex-1 bg-rose-50 p-2 text-center text-rose-700">0-39: {caddieStats.score_low_count}</div>
                <div className="flex-1 border-x border-slate-100 bg-sun-50 p-2 text-center text-sun-700">40-69: {caddieStats.score_mid_count}</div>
                <div className="flex-1 bg-fairway-50 p-2 text-center text-fairway-700">70-100: {caddieStats.score_high_count}</div>
              </div>
            </div>
          </>
        )}

        {caddieFailureStats.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Failures by category and stage</p>
            <div className="overflow-hidden rounded-xl border border-slate-100 bg-white text-xs">
              <div className="grid grid-cols-[1fr_1fr_3rem_3rem_3rem] gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5 font-semibold text-slate-500">
                <span>Category</span>
                <span>Stage</span>
                <span className="text-right">24h</span>
                <span className="text-right">7d</span>
                <span className="text-right">All</span>
              </div>
              {caddieFailureStats.map((r) => (
                <div key={`${r.failure_category}:${r.failure_stage}`} className="grid grid-cols-[1fr_1fr_3rem_3rem_3rem] gap-2 border-b border-slate-50 px-3 py-1.5 text-slate-700 last:border-b-0">
                  <span className="min-w-0 truncate">{r.failure_category}</span>
                  <span className="min-w-0 truncate text-slate-500">{r.failure_stage}</span>
                  <span className="text-right font-semibold">{r.last_24h}</span>
                  <span className="text-right">{r.last_7d}</span>
                  <span className="text-right text-slate-500">{r.total}</span>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">“unclassified” = failed before categories existed; “stuck_processing” = worker died, not yet swept.</p>
          </div>
        )}

        {caddieFailures.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent failures</p>
            <div className="flex flex-col gap-1.5">
              {caddieFailures.map((f) => (
                <div key={f.id} className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold text-slate-800">
                      {f.failure_category ?? (f.status === "processing" ? "stuck_processing" : "unclassified")}
                      <span className="font-normal text-slate-500"> @ {f.failure_stage ?? "—"}</span>
                    </span>
                    <span className="shrink-0 text-slate-500">
                      try {f.attempt}
                      {f.provider_http_status ? ` · HTTP ${f.provider_http_status}` : ""}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-slate-400">
                    {fmtDateTime(f.finished_at ?? f.created_at)} · user {f.owner_id.slice(0, 8)}
                    {f.detail ? ` · ${f.detail}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {loadErrors.admin_list_caddie_analyses ? (
          <SectionError what="the Caddie analyses list" message={loadErrors.admin_list_caddie_analyses} onRetry={retryAll} />
        ) : caddieAnalyses.length === 0 ? (
          <EmptyState icon={<Wand2 size={20} />} title="No Caddie analyses yet." />
        ) : (
          <div className="flex flex-col gap-2">
            {caddieAnalyses.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{a.owner_name ?? "Unnamed"} {a.swing_type && <span className="font-normal text-slate-500">· {a.swing_type}</span>}</p>
                  <p className="truncate text-xs text-slate-500">
                    {a.owner_email} · {fmtDate(a.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.score !== null && <span className="text-sm font-bold text-slate-700">{a.score}/100</span>}
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${CADDIE_STATUS_STYLES[a.status] ?? "bg-slate-100 text-slate-500"}`}>
                    {a.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <Calendar size={15} className="text-fairway-600" /> Golf Calls (all accounts)
        </h2>
        {loadErrors.admin_golf_call_stats && <SectionError what="Golf Call stats" message={loadErrors.admin_golf_call_stats} onRetry={retryAll} />}
        {golfCallStats && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  { label: "Total hosted", value: golfCallStats.total, trend: null },
                  {
                    label: "Last 24h",
                    value: golfCallStats.hosted_last_24h,
                    trend: <TrendIndicator current={golfCallStats.hosted_last_24h} previous={golfCallStats.hosted_prev_24h} />,
                  },
                  {
                    label: "Last 7d",
                    value: golfCallStats.hosted_last_7d,
                    trend: <TrendIndicator current={golfCallStats.hosted_last_7d} previous={golfCallStats.hosted_prev_7d} />,
                  },
                  { label: "Avg participants", value: golfCallStats.avg_participants ?? "—", trend: null },
                ] satisfies { label: string; value: number | string; trend: ReactNode }[]
              ).map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-slate-100 bg-white p-3">
                  <div className="flex items-center gap-1.5">
                    <p className="text-lg font-bold text-slate-800">{stat.value}</p>
                    {stat.trend}
                  </div>
                  <p className="text-xs text-slate-500">{stat.label}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">By status</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-fairway-50 px-2.5 py-1 text-xs font-semibold text-fairway-700">Open: {golfCallStats.open_count}</span>
                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">Full: {golfCallStats.full_count}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Completed: {golfCallStats.completed_count}</span>
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">Cancelled: {golfCallStats.cancelled_count}</span>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <MessageSquare size={15} className="text-fairway-600" /> Community (all accounts)
        </h2>
        {loadErrors.admin_community_stats && <SectionError what="Community stats" message={loadErrors.admin_community_stats} onRetry={retryAll} />}
        {communityStats && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  { label: "Total posts", value: communityStats.posts_total, trend: null },
                  {
                    label: "Last 24h",
                    value: communityStats.posts_last_24h,
                    trend: <TrendIndicator current={communityStats.posts_last_24h} previous={communityStats.posts_prev_24h} />,
                  },
                  {
                    label: "Last 7d",
                    value: communityStats.posts_last_7d,
                    trend: <TrendIndicator current={communityStats.posts_last_7d} previous={communityStats.posts_prev_7d} />,
                  },
                  { label: "Comments", value: communityStats.comments_total, trend: null },
                  { label: "Votes (posts + comments)", value: communityStats.votes_total, trend: null },
                  { label: "Saved", value: communityStats.saved_total, trend: null },
                  { label: "Hidden", value: communityStats.hidden_total, trend: null },
                ] satisfies { label: string; value: number | string; trend: ReactNode }[]
              ).map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-slate-100 bg-white p-3">
                  <div className="flex items-center gap-1.5">
                    <p className="text-lg font-bold text-slate-800">{stat.value}</p>
                    {stat.trend}
                  </div>
                  <p className="text-xs text-slate-500">{stat.label}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">By post type</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Text: {communityStats.posts_text}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Photo: {communityStats.posts_photo}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Course: {communityStats.posts_course}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Round: {communityStats.posts_round}</span>
                <span className="rounded-full bg-fairway-50 px-2.5 py-1 text-xs font-semibold text-fairway-700">Swing: {communityStats.posts_swing}</span>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <Trophy size={15} className="text-fairway-600" /> Reputation Distribution
        </h2>
        <p className="text-xs text-slate-500">Current tier of every real, onboarded golfer — computed live via get_reputation_state(), same source of truth the app itself reads.</p>
        {loadErrors.admin_reputation_distribution ? (
          <SectionError what="the Reputation distribution" message={loadErrors.admin_reputation_distribution} onRetry={retryAll} />
        ) : reputationDist.length === 0 ? (
          <EmptyState icon={<Trophy size={20} />} title="No onboarded real golfers yet." />
        ) : (
          (() => {
            const countByTier = new Map(reputationDist.map((r) => [r.tier_key, r.golfer_count]));
            const maxCount = Math.max(...reputationDist.map((r) => r.golfer_count), 1);
            return (
              <div className="flex flex-col gap-1.5">
                {TIER_ORDER.filter((key) => (countByTier.get(key) ?? 0) > 0).map((key) => {
                  const count = countByTier.get(key) ?? 0;
                  return (
                    <div key={key} className="flex items-center gap-2.5">
                      <span className="w-24 shrink-0 text-xs font-semibold text-slate-600">{TIER_LABELS[key]}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-fairway-500" style={{ width: `${(count / maxCount) * 100}%` }} />
                      </div>
                      <span className="w-6 shrink-0 text-right text-xs font-bold text-slate-700">{count}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <Bell size={15} className="text-fairway-600" /> Messaging &amp; Notifications (all accounts)
        </h2>
        {loadErrors.admin_messaging_stats && <SectionError what="messaging stats" message={loadErrors.admin_messaging_stats} onRetry={retryAll} />}
        {messagingStats && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                { label: "Conversations (all time)", value: messagingStats.conversations_total, trend: null },
                { label: "DMs (all time)", value: messagingStats.messages_total, trend: null },
                {
                  label: "Messages (24h)",
                  value: messagingStats.messages_last_24h,
                  trend: <TrendIndicator current={messagingStats.messages_last_24h} previous={messagingStats.messages_prev_24h} />,
                },
                {
                  label: "Messages (7d)",
                  value: messagingStats.messages_last_7d,
                  trend: <TrendIndicator current={messagingStats.messages_last_7d} previous={messagingStats.messages_prev_7d} />,
                },
                { label: "Notifications created (all time)", value: messagingStats.notifications_total, trend: null },
                { label: "Notifications unread (now)", value: messagingStats.notifications_unread, trend: null },
              ] satisfies { label: string; value: number | string; trend: ReactNode }[]
            ).map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-slate-100 bg-white p-3">
                <div className="flex items-center gap-1.5">
                  <p className="text-lg font-bold text-slate-800">{stat.value}</p>
                  {stat.trend}
                </div>
                <p className="text-xs text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <Smartphone size={15} className="text-fairway-600" /> Push Notification Health
        </h2>
        {loadErrors.admin_push_stats && <SectionError what="push stats" message={loadErrors.admin_push_stats} onRetry={retryAll} />}
        {pushStats && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  { label: "Devices registered", value: pushStats.tokens_registered },
                  { label: "Users with a token", value: pushStats.users_with_token },
                  { label: "Push enabled (pref)", value: pushStats.push_enabled_count },
                  { label: "Push disabled (pref)", value: pushStats.push_disabled_count },
                ] satisfies { label: string; value: number }[]
              ).map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-slate-100 bg-white p-3">
                  <p className="text-lg font-bold text-slate-800">{stat.value}</p>
                  <p className="text-xs text-slate-500">{stat.label}</p>
                </div>
              ))}
            </div>
            {pushStats.tokens_registered === 0 && (
              <p className="rounded-xl border border-sun-200 bg-sun-50 px-3 py-2 text-xs font-semibold text-sun-700">
                No device has ever registered a push token — either nobody has granted the permission prompt yet, or there's a registration bug worth checking on a physical device.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
