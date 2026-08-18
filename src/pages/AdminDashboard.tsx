import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ShieldCheck, Users } from "lucide-react";
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: w, error: wErr }, { data: u, error: uErr }] = await Promise.all([
      supabase.rpc("admin_list_waitlist_signups"),
      supabase.rpc("admin_list_users"),
    ]);
    if (wErr) console.error("Golf Me: admin_list_waitlist_signups failed.", wErr);
    if (uErr) console.error("Golf Me: admin_list_users failed.", uErr);
    setWaitlist((w ?? []) as WaitlistRow[]);
    setUsers((u ?? []) as UserRow[]);
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
    </div>
  );
}
