import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ShieldCheck, TrendingDown, TrendingUp, Users, Wand2 } from "lucide-react";
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
}

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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: w, error: wErr }, { data: u, error: uErr }, { data: cs, error: csErr }, { data: ca, error: caErr }] = await Promise.all([
      supabase.rpc("admin_list_waitlist_signups"),
      supabase.rpc("admin_list_users"),
      supabase.rpc("admin_caddie_stats"),
      supabase.rpc("admin_list_caddie_analyses", { p_limit: 50 }),
    ]);
    if (wErr) console.error("Golf Me: admin_list_waitlist_signups failed.", wErr);
    if (uErr) console.error("Golf Me: admin_list_users failed.", uErr);
    if (csErr) console.error("Golf Me: admin_caddie_stats failed.", csErr);
    if (caErr) console.error("Golf Me: admin_list_caddie_analyses failed.", caErr);
    setWaitlist((w ?? []) as WaitlistRow[]);
    setUsers((u ?? []) as UserRow[]);
    setCaddieStats(((cs as CaddieStats[]) ?? [])[0] ?? null);
    setCaddieAnalyses((ca ?? []) as CaddieAnalysisRow[]);
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
        <p className="text-sm text-slate-500">Waitlist signups and registered users, at a glance.</p>
      </div>

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
            {/* Failure rate isn't tracked here on purpose — a failed
                analysis deletes its own row (see analyze-swing/index.ts's
                fail()) rather than leaving a 'failed' entry behind, so
                there's nothing left to count after the fact. Tracking that
                for real would mean retaining failed rows or a separate
                event log — a deliberate follow-up if it's ever wanted. */}
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
    </div>
  );
}
