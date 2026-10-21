import { useCallback, useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatFoundingNumber } from "../../lib/founder";
import { EmptyState } from "../ui/EmptyState";

// Founding Golfer manual reviews (20261022120000). Admin dashboard only, so
// plain English like the rest of that page. Rendered only for admins by
// AdminDashboard; every RPC re-checks the admin role server-side. Before the
// migration is applied the list RPC doesn't exist, so the section says
// "unavailable" instead of pretending there are no reviews.
interface ReviewRow {
  id: number;
  user_id: string | null;
  name: string | null;
  username: string | null;
  reason: string;
  status: string;
  flags: string[];
  window_ends_at: string;
  window_anchor_source: string;
  counted_moves: number;
  previous_area_label: string | null;
  previous_distance_mi: number | null;
  area_label: string | null;
  distance_mi: number | null;
  current_area_label: string | null;
  current_in_zone: boolean | null;
  member_number: number | null;
  first_detected_at: string;
  last_detected_at: string;
}

const REASON_LABELS: Record<string, string> = {
  outside_window: "Moved into the zone after the 14-day window",
  correction_over_cap: "Too many location changes inside the window",
  in_window_correction: "Corrected inside the window (auto-awarded)",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function area(label: string | null, miles: number | null) {
  if (!label && miles == null) return "(none)";
  return `${label ?? "(no label)"}${miles != null ? ` · ${miles} mi from Midtown` : ""}`;
}

export function FoundingReviewsSection() {
  const [pending, setPending] = useState<ReviewRow[]>([]);
  const [autoAwarded, setAutoAwarded] = useState<ReviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [{ data: p, error: pErr }, { data: a, error: aErr }] = await Promise.all([
      supabase.rpc("admin_list_founding_reviews", { p_status: "pending", p_limit: 100 }),
      supabase.rpc("admin_list_founding_reviews", { p_status: "auto_awarded", p_limit: 20 }),
    ]);
    const err = pErr ?? aErr;
    if (err) {
      console.error("GolfMe: admin_list_founding_reviews failed.", err);
      setError(err.message);
      return;
    }
    setError(null);
    setPending((p ?? []) as ReviewRow[]);
    setAutoAwarded((a ?? []) as ReviewRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(
    async (row: ReviewRow, approve: boolean) => {
      const who = row.name ?? row.username ?? "this golfer";
      const note = window.prompt(
        approve ? `Approve ${who} as a Founding Golfer? Optional note:` : `Dismiss the review for ${who}? Optional note:`,
        "",
      );
      if (note === null) return;
      setBusyId(row.id);
      const { data, error: rpcError } = approve
        ? await supabase.rpc("admin_approve_founding_review", { p_review_id: row.id, p_note: note })
        : await supabase.rpc("admin_dismiss_founding_review", { p_review_id: row.id, p_note: note });
      setBusyId(null);
      if (rpcError) {
        window.alert(`Couldn't ${approve ? "approve" : "dismiss"}: ${rpcError.message}`);
        return;
      }
      if (approve && typeof data === "number") window.alert(`Awarded ${formatFoundingNumber(data)}.`);
      load();
    },
    [load],
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <Flag size={15} className="text-sun-600" /> Founding Golfer reviews
        </h2>
        <span className="text-sm font-semibold text-slate-500">{error ? "Unavailable" : `${pending.length} pending`}</span>
      </div>

      {error ? (
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-600">
          Couldn't load Founding reviews. ({error})
        </p>
      ) : pending.length === 0 ? (
        <EmptyState icon={<Flag size={20} />} title="No pending Founding reviews." />
      ) : (
        <div className="flex flex-col gap-2">
          {pending.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 rounded-2xl border border-sun-300/60 bg-sun-50/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {r.name ?? "(no name)"} {r.username && <span className="font-normal text-slate-500">@{r.username}</span>}
                  </p>
                  <p className="text-xs text-slate-500">{REASON_LABELS[r.reason] ?? r.reason}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${r.current_in_zone ? "bg-fairway-50 text-fairway-700" : "bg-slate-100 text-slate-500"}`}>
                  {r.current_in_zone ? "In zone now" : "Not in zone now"}
                </span>
              </div>
              <div className="text-xs text-slate-600">
                <p className="truncate"><span className="text-slate-400">From:</span> {area(r.previous_area_label, r.previous_distance_mi)}</p>
                <p className="truncate"><span className="text-slate-400">To:</span> {area(r.area_label, r.distance_mi)}</p>
                <p className="truncate"><span className="text-slate-400">Now:</span> {r.current_area_label ?? "(none)"}</p>
                <p>
                  <span className="text-slate-400">Window ended:</span> {fmt(r.window_ends_at)}
                  {r.window_anchor_source === "created_at" && " (measured from signup, pre-migration account)"} ·{" "}
                  <span className="text-slate-400">Moves counted:</span> {r.counted_moves}
                </p>
                {r.flags.length > 0 && <p><span className="text-slate-400">Flags:</span> {r.flags.join(", ")}</p>}
                <p className="text-slate-400">First seen {fmt(r.first_detected_at)} · last {fmt(r.last_detected_at)}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busyId === r.id || !r.current_in_zone}
                  onClick={() => decide(r, true)}
                  className="rounded-full border border-fairway-300 bg-white px-2.5 py-1 text-xs font-semibold text-fairway-700 disabled:opacity-40"
                >
                  Approve and award
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => decide(r, false)}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 disabled:opacity-40"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!error && autoAwarded.length > 0 && (
        <details className="rounded-2xl border border-slate-100 bg-white p-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700">
            Recent in-window corrections (auto-awarded): {autoAwarded.length}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {autoAwarded.map((r) => (
              <li key={r.id}>
                {r.member_number != null && <span className="font-semibold tabular-nums">{formatFoundingNumber(r.member_number)} </span>}
                {r.name ?? r.username ?? "(no name)"}: {area(r.previous_area_label, r.previous_distance_mi)} to {area(r.area_label, r.distance_mi)}
                {r.flags.length > 0 && <span className="text-sun-700"> · {r.flags.join(", ")}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-slate-400">A mistaken award can be revoked with admin_revoke_founding_award; the number stays consumed.</p>
        </details>
      )}
    </section>
  );
}
