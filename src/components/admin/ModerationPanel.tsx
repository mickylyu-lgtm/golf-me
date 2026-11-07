import { useState } from "react";
import { Ban, EyeOff, History, RotateCcw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { moderationReasonLabel } from "../../lib/moderation";
import type { ModerationAdminData } from "../../lib/useModerationAdminData";
import { EmptyState } from "../ui/EmptyState";

// Admin dashboard: removed content (restore), suspensions (lift) and the
// moderation log. Reads only through the admin-only RPCs of migration
// 20261107270000 (lib/useModerationAdminData); hidden until that migration
// is applied. Plain English, like the rest of the dashboard.

const ACTION_LABELS: Record<string, string> = {
  remove_post: "Removed post",
  restore_post: "Restored post",
  remove_comment: "Removed comment",
  restore_comment: "Restored comment",
  suspend_user: "Suspended",
  lift_suspension: "Lifted suspension",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function who(name: string | null, username: string | null) {
  return `${name ?? "Unknown"}${username ? ` (@${username})` : ""}`;
}

export function ModerationPanel({ data }: { data: ModerationAdminData }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!data.enabled) return null;

  async function run(id: string, fn: string, args: Record<string, unknown>) {
    setBusyId(id);
    const { error } = await supabase.rpc(fn, args);
    setBusyId(null);
    if (error) {
      console.error(`GolfMe: ${fn} failed.`, error);
      window.alert(`Couldn't do that: ${error.message}`);
      return;
    }
    await data.reload();
  }

  const activeSuspensions = data.suspensions.filter((s) => s.active);

  return (
    <>
      {data.error && (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <span className="font-semibold">Couldn't load moderation lists.</span> ({data.error})
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <EyeOff size={15} className="text-fairway-600" /> Removed content
          </h2>
          <span className="text-sm font-semibold text-slate-500">{data.removed.length} removed</span>
        </div>
        {data.removed.length === 0 ? (
          <EmptyState icon={<EyeOff size={20} />} title="Nothing removed." />
        ) : (
          <div className="flex flex-col gap-2">
            {data.removed.map((x) => (
              <div key={x.id} className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {x.kind === "post" ? "Post" : "Comment"} by {who(x.author_name, x.author_username)}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {moderationReasonLabel(x.removed_reason)} · removed {fmt(x.removed_at)}
                      {x.removed_by_name ? ` by ${x.removed_by_name}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === x.id}
                    onClick={() =>
                      run(x.id, x.kind === "post" ? "admin_restore_post" : "admin_restore_comment", x.kind === "post" ? { p_post_id: x.id } : { p_comment_id: x.id })
                    }
                    className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 disabled:opacity-40"
                  >
                    <RotateCcw size={12} /> Restore
                  </button>
                </div>
                {x.text && <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">{x.text}</p>}
                <p className="break-all text-[11px] text-slate-400">
                  {x.kind === "post" ? "Post" : "Comment"} {x.id}
                  {x.kind === "comment" && <> · on post {x.post_id}</>}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Ban size={15} className="text-fairway-600" /> Suspensions
          </h2>
          <span className="text-sm font-semibold text-slate-500">{activeSuspensions.length} active</span>
        </div>
        {data.suspensions.length === 0 ? (
          <EmptyState icon={<Ban size={20} />} title="No suspended accounts." />
        ) : (
          <div className="flex flex-col gap-2">
            {data.suspensions.map((s) => (
              <div key={s.user_id} className={`flex items-start justify-between gap-3 rounded-2xl border p-3 ${s.active ? "border-amber-200 bg-amber-50/40" : "border-slate-100 bg-white"}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{who(s.name, s.username)}</p>
                  <p className="text-xs text-slate-500">
                    {moderationReasonLabel(s.reason)} · {s.suspended_until ? `until ${fmt(s.suspended_until)}` : "until lifted"}
                    {s.hide_content ? " · content hidden" : ""}
                    {s.active ? "" : " · ended"}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Since {fmt(s.suspended_at)}
                    {s.suspended_by_name ? ` by ${s.suspended_by_name}` : ""} · {s.user_id}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === s.user_id}
                  onClick={() => run(s.user_id, "admin_lift_suspension", { p_user_id: s.user_id })}
                  className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 disabled:opacity-40"
                >
                  {s.active ? "Lift" : "Clear"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <History size={15} className="text-fairway-600" /> Moderation log
          </h2>
          <span className="text-sm font-semibold text-slate-500">Latest {data.actions.length}</span>
        </div>
        {data.actions.length === 0 ? (
          <EmptyState icon={<History size={20} />} title="No moderation actions yet." />
        ) : (
          <div className="flex flex-col divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white">
            {data.actions.map((a) => (
              <div key={a.id} className="px-3 py-2 text-xs text-slate-600">
                <p className="text-slate-800">
                  <span className="font-semibold">{ACTION_LABELS[a.action] ?? a.action}</span>
                  {a.target_user_id ? <> · {who(a.target_name, a.target_username)}</> : null}
                  {a.reason ? <> · {moderationReasonLabel(a.reason)}</> : null}
                </p>
                {a.note && <p className="whitespace-pre-wrap break-words text-slate-500">"{a.note}"</p>}
                <p className="text-[11px] text-slate-400">
                  {fmt(a.created_at)} by {a.admin_name ?? "a deleted admin"} · {a.target_type} {a.target_id}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
