import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Bell, Calendar, LayoutGrid, MessageSquare, ShieldCheck, Smartphone, TrendingDown, TrendingUp, Trophy, Users, Wand2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useRoles } from "../lib/useRoles";
import { supabase } from "../lib/supabase";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

// Internal admin tool only — same access model as AdminReviewers.tsx
// (hidden from nav, gated on isAdmin client-side, re-verified server-side
// by every RPC), and same reasoning for staying plain English rather than
// routed through the i18n system.
interface WaitlistRow {
  id: string;
  email: string;
  home_region: string;
  referral_source: string | null;
  status: string;
  created_at: string;
}

interface UserRow {
  id: string;
  name: string | null;
  username: string | null;
  email: string;
  photo_url: string | null;
  avatar_color: string | null;
  avatar_initials: string | null;
  has_onboarded: boolean;
  verified_golfer: boolean;
  is_admin: boolean;
  is_coach_reviewer: boolean;
  member_since: string;
}

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

interface CaddieAnalysisRow {
  id: string;
  owner_name: string | null;
  owner_email: string;
  swing_type: string | null;
  status: string;
  score: number | null;
  created_at: string;
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

const STATUS_STYLES: Record<string, string> = {
  waiting: "bg-fairway-50 text-fairway-700",
  invited: "bg-sky-50 text-sky-700",
  beta: "bg-sun-100 text-sun-700",
  declined: "bg-slate-100 text-slate-500",
};

export function AdminDashboard() {
  const { isDemo } = useAuth();
  const { isAdmin, loading: rolesLoading } = useRoles();

  const [waitlist, setWaitlist] = useState<WaitlistRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [caddieStats, setCaddieStats] = useState<CaddieStats | null>(null);
  const [caddieAnalyses, setCaddieAnalyses] = useState<CaddieAnalysisRow[]>([]);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [golfCallStats, setGolfCallStats] = useState<GolfCallStats | null>(null);
  const [communityStats, setCommunityStats] = useState<CommunityStats | null>(null);
  const [reputationDist, setReputationDist] = useState<ReputationDistributionRow[]>([]);
  const [messagingStats, setMessagingStats] = useState<MessagingStats | null>(null);
  const [pushStats, setPushStats] = useState<PushStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: w, error: wErr },
      { data: u, error: uErr },
      { data: cs, error: csErr },
      { data: ca, error: caErr },
      { data: ov, error: ovErr },
      { data: gc, error: gcErr },
      { data: co, error: coErr },
      { data: rd, error: rdErr },
      { data: ms, error: msErr },
      { data: ps, error: psErr },
    ] = await Promise.all([
      supabase.rpc("admin_list_waitlist_signups"),
      supabase.rpc("admin_list_users"),
      supabase.rpc("admin_caddie_stats"),
      supabase.rpc("admin_list_caddie_analyses", { p_limit: 50 }),
      supabase.rpc("admin_platform_overview"),
      supabase.rpc("admin_golf_call_stats"),
      supabase.rpc("admin_community_stats"),
      supabase.rpc("admin_reputation_distribution"),
      supabase.rpc("admin_messaging_stats"),
      supabase.rpc("admin_push_stats"),
    ]);
    if (wErr) console.error("GolfMe: admin_list_waitlist_signups failed.", wErr);
    if (uErr) console.error("GolfMe: admin_list_users failed.", uErr);
    if (csErr) console.error("GolfMe: admin_caddie_stats failed.", csErr);
    if (caErr) console.error("GolfMe: admin_list_caddie_analyses failed.", caErr);
    if (ovErr) console.error("GolfMe: admin_platform_overview failed.", ovErr);
    if (gcErr) console.error("GolfMe: admin_golf_call_stats failed.", gcErr);
    if (coErr) console.error("GolfMe: admin_community_stats failed.", coErr);
    if (rdErr) console.error("GolfMe: admin_reputation_distribution failed.", rdErr);
    if (msErr) console.error("GolfMe: admin_messaging_stats failed.", msErr);
    if (psErr) console.error("GolfMe: admin_push_stats failed.", psErr);
    setWaitlist((w ?? []) as WaitlistRow[]);
    setUsers((u ?? []) as UserRow[]);
    setCaddieStats(((cs as CaddieStats[]) ?? [])[0] ?? null);
    setCaddieAnalyses((ca ?? []) as CaddieAnalysisRow[]);
    setOverview(((ov as PlatformOverview[]) ?? [])[0] ?? null);
    setGolfCallStats(((gc as GolfCallStats[]) ?? [])[0] ?? null);
    setCommunityStats(((co as CommunityStats[]) ?? [])[0] ?? null);
    setReputationDist((rd ?? []) as ReputationDistributionRow[]);
    setMessagingStats(((ms as MessagingStats[]) ?? [])[0] ?? null);
    setPushStats(((ps as PushStats[]) ?? [])[0] ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [isAdmin, load]);

  if (isDemo) return <Navigate to="/" replace />;
  if (!rolesLoading && !isAdmin) return <Navigate to="/" replace />;
  if (rolesLoading || loading) return null;

  const statusCounts = waitlist.reduce<Record<string, number>>((acc, w) => {
    acc[w.status] = (acc[w.status] ?? 0) + 1;
    return acc;
  }, {});
  const regionCounts = waitlist
    .reduce<{ region: string; count: number }[]>((acc, w) => {
      const existing = acc.find((r) => r.region === w.home_region);
      if (existing) existing.count += 1;
      else acc.push({ region: w.home_region, count: 1 });
      return acc;
    }, [])
    .sort((a, b) => b.count - a.count);

  const onboardedCount = users.filter((u) => u.has_onboarded).length;

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Platform Dashboard</h1>
        <p className="text-sm text-slate-500">Waitlist, users, and every real-usage stat, at a glance.</p>
      </div>

      {overview && (
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <LayoutGrid size={15} className="text-fairway-600" /> Overview
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                { label: "Real users", value: overview.total_users },
                { label: "Onboarded", value: overview.onboarded_users },
                { label: "Golf Calls", value: overview.golf_calls_total },
                { label: "Rounds completed", value: overview.rounds_completed },
                { label: "Community posts", value: overview.community_posts_total },
                { label: "Messages sent", value: overview.messages_total },
                { label: "Caddie analyses", value: overview.caddie_analyses_total },
                { label: "Push tokens", value: overview.push_tokens_registered },
              ] satisfies { label: string; value: number }[]
            ).map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-slate-100 bg-white p-3">
                <p className="text-lg font-bold text-slate-800">{stat.value}</p>
                <p className="text-xs text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <ShieldCheck size={15} className="text-fairway-600" /> Waitlist
          </h2>
          <span className="text-sm font-semibold text-slate-500">{waitlist.length} total</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(statusCounts).map(([status, count]) => (
            <span
              key={status}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-500"}`}
            >
              {status}: {count}
            </span>
          ))}
        </div>

        {regionCounts.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {regionCounts.map((r, i) => (
              <div
                key={r.region}
                className={`flex items-center justify-between px-3.5 py-2 text-sm ${i > 0 ? "border-t border-slate-100" : ""}`}
              >
                <span className="text-slate-700">{r.region}</span>
                <span className="font-semibold text-slate-500">{r.count}</span>
              </div>
            ))}
          </div>
        )}

        {waitlist.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={20} />} title="No waitlist signups yet." />
        ) : (
          <div className="flex flex-col gap-2">
            {waitlist.slice(0, 100).map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{w.email}</p>
                  <p className="truncate text-xs text-slate-500">
                    {w.home_region}
                    {w.referral_source && <> · ref: {w.referral_source}</>} · {fmtDate(w.created_at)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[w.status] ?? "bg-slate-100 text-slate-500"}`}>
                  {w.status}
                </span>
              </div>
            ))}
            {waitlist.length > 100 && <p className="text-center text-xs text-slate-400">+{waitlist.length - 100} more</p>}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Users size={15} className="text-fairway-600" /> Registered Users
          </h2>
          <span className="text-sm font-semibold text-slate-500">
            {users.length} total · {onboardedCount} onboarded
          </span>
        </div>

        {users.length === 0 ? (
          <EmptyState icon={<Users size={20} />} title="No registered users yet." />
        ) : (
          <div className="flex flex-col gap-2">
            {users.slice(0, 100).map((u) => (
              <div key={u.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                <Avatar
                  golfer={{
                    avatarColor: u.avatar_color ?? "#5aa171",
                    avatarInitials: u.avatar_initials ?? "?",
                    photoUrl: u.photo_url ?? undefined,
                    verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: u.verified_golfer },
                  }}
                  size="sm"
                  showVerified={u.verified_golfer}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{u.name ?? "Unnamed"}</p>
                  <p className="truncate text-xs text-slate-500">
                    {u.username && <>@{u.username} · </>}
                    {u.email} · joined {fmtDate(u.member_since)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {!u.has_onboarded && <Badge tone="outline">mid-onboarding</Badge>}
                  {u.is_admin && <Badge tone="fairway">admin</Badge>}
                  {u.is_coach_reviewer && <Badge tone="sky">reviewer</Badge>}
                </div>
              </div>
            ))}
            {users.length > 100 && <p className="text-center text-xs text-slate-400">+{users.length - 100} more</p>}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Wand2 size={15} className="text-fairway-600" /> Caddie Usage
          </h2>
        </div>

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

        {caddieAnalyses.length === 0 ? (
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
          <Calendar size={15} className="text-fairway-600" /> Golf Calls
        </h2>
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
          <MessageSquare size={15} className="text-fairway-600" /> Community
        </h2>
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
        {reputationDist.length === 0 ? (
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
          <Bell size={15} className="text-fairway-600" /> Messaging &amp; Notifications
        </h2>
        {messagingStats && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                { label: "Conversations", value: messagingStats.conversations_total, trend: null },
                { label: "Total messages", value: messagingStats.messages_total, trend: null },
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
                { label: "Notifications sent", value: messagingStats.notifications_total, trend: null },
                { label: "Unread", value: messagingStats.notifications_unread, trend: null },
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
