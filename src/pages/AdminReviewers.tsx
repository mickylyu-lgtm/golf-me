import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Check, Copy, Search, ShieldCheck, UserMinus, UserPlus, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useRoles } from "../lib/useRoles";
import { supabase } from "../lib/supabase";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";

// Internal admin tool only — never linked from nav, gated on the caller's
// own admin role (re-verified server-side by every RPC it calls, not just
// this client-side redirect). Deliberately plain English throughout rather
// than routed through the app's i18n system: this page is reachable by
// nobody but the founder/ops admins, unlike every other page in the app.
const DAY_MS = 24 * 60 * 60 * 1000;

interface SearchUserRow {
  id: string;
  name: string | null;
  username: string | null;
  photo_url: string | null;
  avatar_color: string | null;
  avatar_initials: string | null;
  email: string;
  is_coach_reviewer: boolean;
  is_admin: boolean;
}

interface ReviewerRow {
  user_id: string;
  name: string | null;
  username: string | null;
  photo_url: string | null;
  avatar_color: string | null;
  avatar_initials: string | null;
  active: boolean;
  granted_at: string;
  granted_by_name: string | null;
  revoked_at: string | null;
}

interface InviteRow {
  id: string;
  invite_token: string;
  created_by_name: string | null;
  created_at: string;
  expires_at: string;
  redeemed_by_name: string | null;
  redeemed_at: string | null;
  status: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function inviteUrl(token: string) {
  return `${window.location.origin}/coach-invite/${token}`;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-fairway-50 text-fairway-700",
  redeemed: "bg-slate-100 text-slate-500",
  expired: "bg-amber-50 text-amber-700",
  revoked: "bg-red-50 text-red-600",
};

export function AdminReviewers() {
  const { isDemo } = useAuth();
  const { isAdmin, loading: rolesLoading } = useRoles();
  const { showToast } = useToast();

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUserRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [reviewers, setReviewers] = useState<ReviewerRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    setSearching(true);
    const { data, error } = await supabase.rpc("admin_search_users", { p_query: q });
    if (error) console.error("Golf Me: admin_search_users failed.", error);
    setSearchResults((data ?? []) as SearchUserRow[]);
    setSearching(false);
  }, []);

  const loadReviewers = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_list_coach_reviewers");
    if (error) console.error("Golf Me: admin_list_coach_reviewers failed.", error);
    setReviewers((data ?? []) as ReviewerRow[]);
  }, []);

  const loadInvites = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_list_reviewer_invites");
    if (error) console.error("Golf Me: admin_list_reviewer_invites failed.", error);
    setInvites((data ?? []) as InviteRow[]);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    runSearch("");
    loadReviewers();
    loadInvites();
  }, [isAdmin, runSearch, loadReviewers, loadInvites]);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = window.setTimeout(() => runSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isAdmin]);

  if (isDemo) return <Navigate to="/" replace />;
  if (!rolesLoading && !isAdmin) return <Navigate to="/" replace />;
  if (rolesLoading) return null;

  async function grant(userId: string) {
    setBusyId(userId);
    const { error } = await supabase.rpc("grant_coach_reviewer", { p_user_id: userId });
    setBusyId(null);
    if (error) {
      showToast(error.message, "warning");
      return;
    }
    showToast("Coach Reviewer access granted.", "success");
    runSearch(query.trim());
    loadReviewers();
  }

  async function revoke(userId: string) {
    setBusyId(userId);
    const { error } = await supabase.rpc("revoke_coach_reviewer", { p_user_id: userId });
    setBusyId(null);
    if (error) {
      showToast(error.message, "warning");
      return;
    }
    showToast("Coach Reviewer access revoked.", "success");
    runSearch(query.trim());
    loadReviewers();
  }

  async function createInvite() {
    setCreatingInvite(true);
    const { error } = await supabase.rpc("create_reviewer_invite", { p_expires_in_days: 14 });
    setCreatingInvite(false);
    if (error) {
      showToast(error.message, "warning");
      return;
    }
    showToast("Invite created.", "success");
    loadInvites();
  }

  async function revokeInvite(id: string) {
    setBusyId(id);
    const { error } = await supabase.rpc("revoke_reviewer_invite", { p_invite_id: id });
    setBusyId(null);
    if (error) {
      showToast(error.message, "warning");
      return;
    }
    loadInvites();
  }

  async function copyInvite(row: InviteRow) {
    try {
      await navigator.clipboard.writeText(inviteUrl(row.invite_token));
      setCopiedId(row.id);
      window.setTimeout(() => setCopiedId((c) => (c === row.id ? null : c)), 1500);
    } catch {
      showToast("Couldn't copy — long-press the link to copy it manually.", "warning");
    }
  }

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <ShieldCheck size={20} className="text-fairway-600" /> Coach Reviewers
        </h1>
        <p className="text-sm text-slate-500">Grant and manage who can leave Coach Reviews on swing posts.</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-slate-800">Grant access</h2>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, username, or email"
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-3.5 text-sm text-slate-800 outline-none transition focus:border-fairway-400 focus:ring-2 focus:ring-fairway-100"
          />
        </div>
        {searching ? (
          <p className="py-4 text-center text-sm text-slate-400">Searching…</p>
        ) : searchResults.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title="No users found." />
        ) : (
          <div className="flex flex-col gap-2">
            {searchResults.map((u) => (
              <div key={u.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                <Avatar
                  golfer={{
                    avatarColor: u.avatar_color ?? "#5aa171",
                    avatarInitials: u.avatar_initials ?? "?",
                    photoUrl: u.photo_url ?? undefined,
                    verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: false },
                  }}
                  size="sm"
                  showVerified={false}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{u.name ?? "Unnamed"}</p>
                  <p className="truncate text-xs text-slate-500">
                    {u.username && <>@{u.username} · </>}
                    {u.email}
                  </p>
                </div>
                {u.is_admin ? (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Admin</span>
                ) : u.is_coach_reviewer ? (
                  <Button size="sm" variant="outline" icon={<UserMinus size={14} />} disabled={busyId === u.id} onClick={() => revoke(u.id)}>
                    Remove
                  </Button>
                ) : (
                  <Button size="sm" icon={<UserPlus size={14} />} disabled={busyId === u.id} onClick={() => grant(u.id)}>
                    Grant
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-slate-800">Active &amp; past reviewers</h2>
        {reviewers.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={20} />} title="No Coach Reviewers yet." />
        ) : (
          <div className="flex flex-col gap-2">
            {reviewers.map((r) => (
              <div key={r.user_id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                <Avatar
                  golfer={{
                    avatarColor: r.avatar_color ?? "#5aa171",
                    avatarInitials: r.avatar_initials ?? "?",
                    photoUrl: r.photo_url ?? undefined,
                    verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: false },
                  }}
                  size="sm"
                  showVerified={false}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{r.name ?? "Unnamed"}</p>
                  <p className="truncate text-xs text-slate-500">
                    {r.active ? `Granted ${fmtDate(r.granted_at)}` : `Disabled ${r.revoked_at ? fmtDate(r.revoked_at) : ""}`}
                    {r.granted_by_name && <> · by {r.granted_by_name}</>}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${r.active ? "bg-fairway-50 text-fairway-700" : "bg-slate-100 text-slate-500"}`}>
                  {r.active ? "Active" : "Disabled"}
                </span>
                {r.active ? (
                  <Button size="sm" variant="outline" disabled={busyId === r.user_id} onClick={() => revoke(r.user_id)}>
                    Disable
                  </Button>
                ) : (
                  <Button size="sm" disabled={busyId === r.user_id} onClick={() => grant(r.user_id)}>
                    Reactivate
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">Invites</h2>
          <Button size="sm" icon={<UserPlus size={14} />} disabled={creatingInvite} onClick={createInvite}>
            New invite
          </Button>
        </div>
        {invites.length === 0 ? (
          <EmptyState icon={<UserPlus size={20} />} title="No invites yet." description="Create one to send a friend a Coach Reviewer invite link." />
        ) : (
          <div className="flex flex-col gap-2">
            {invites.map((inv) => {
              const daysLeft = Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / DAY_MS);
              return (
                <div key={inv.id} className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[inv.status] ?? "bg-slate-100 text-slate-500"}`}>
                      {inv.status}
                    </span>
                    <span className="text-xs text-slate-400">Created {fmtDate(inv.created_at)}</span>
                  </div>
                  <p className="truncate rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-500">{inviteUrl(inv.invite_token)}</p>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>
                      {inv.status === "redeemed" && inv.redeemed_by_name
                        ? `Redeemed by ${inv.redeemed_by_name}`
                        : inv.status === "pending"
                          ? `Expires in ${Math.max(daysLeft, 0)}d`
                          : ""}
                    </span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => copyInvite(inv)} className="flex items-center gap-1 font-semibold text-fairway-700 hover:text-fairway-800">
                        {copiedId === inv.id ? (
                          <>
                            <Check size={13} /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={13} /> Copy link
                          </>
                        )}
                      </button>
                      {inv.status === "pending" && (
                        <button
                          onClick={() => revokeInvite(inv.id)}
                          disabled={busyId === inv.id}
                          className="flex items-center gap-1 font-semibold text-red-500 hover:text-red-600 disabled:opacity-40"
                        >
                          <X size={13} /> Revoke
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
