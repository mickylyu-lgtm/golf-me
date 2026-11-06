import { useCallback, useEffect, useState } from "react";
import { FileCheck2, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { EmptyState } from "../ui/EmptyState";

// Admin dashboard: booking evidence review (migration 20261107150000).
// English only, like the rest of /admin/dashboard. Every rule is enforced by
// review_booking_evidence(): reviewer role, current version only, booking
// unchanged since submission (booking_version), never the reviewer's own
// round. A failed save shows the error and leaves the item unreviewed.
// Screenshots are fetched one at a time through 60-second signed URLs and
// shown as images only (never embedded documents). No turnaround is
// promised to hosts anywhere.

interface QueueRow {
  evidence_id: string;
  golf_call_id: string;
  status: "submitted" | "needs_correction";
  storage_path: string;
  submitted_at: string;
  host_user_id: string;
  host_name: string | null;
  snap_course_name: string;
  snap_date_iso: string;
  snap_tee_time_label: string;
  snap_party_size: number | null;
  snap_booking_version: number;
  round_course_name: string;
  round_date_iso: string;
  round_tee_time_label: string;
  round_party_size: number | null;
  round_booking_version: number;
}

const REASONS = [
  ["illegible", "Hard to read"],
  ["course_mismatch", "Course doesn't match"],
  ["date_mismatch", "Date doesn't match"],
  ["time_mismatch", "Tee time doesn't match"],
  ["party_size_mismatch", "Party size doesn't match"],
  ["not_a_booking", "Not a booking"],
  ["other", "Other"],
] as const;

// The round's day as the host picked it (date_iso is noon on that day, UTC).
function roundDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function Item({ row, onDone }: { row: QueueRow; onDone: (id: string) => void }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = row.snap_booking_version !== row.round_booking_version;

  async function show() {
    setError(null);
    const { data, error: err } = await supabase.storage.from("booking-proofs").createSignedUrl(row.storage_path, 60);
    if (err || !data) setError(err?.message ?? "Couldn't open the screenshot.");
    else setImgUrl(data.signedUrl);
  }

  async function decide(outcome: "reviewed" | "needs_correction" | "rejected") {
    if (saving) return;
    if (outcome !== "reviewed" && !reason) {
      setError("Pick a reason first.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc("review_booking_evidence", {
      p_evidence_id: row.evidence_id,
      p_outcome: outcome,
      p_reason_code: outcome === "reviewed" ? null : reason,
      p_note: note.trim() || null,
      p_expected_booking_version: row.snap_booking_version,
    });
    setSaving(false);
    if (err) setError(err.message);
    else onDone(row.evidence_id);
  }

  const cell = (snap: string | number | null, now: string | number | null) => (
    <span className={snap === now ? "" : "font-semibold text-rose-700"}>
      {snap ?? "—"}
      {snap !== now && ` (round now: ${now ?? "—"})`}
    </span>
  );

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800">{row.snap_course_name}</p>
          <p className="text-xs text-slate-500">
            Host {row.host_name ?? "(no name)"} · submitted {new Date(row.submitted_at).toLocaleString()} · {row.status === "needs_correction" ? "re-review" : "new"}
          </p>
        </div>
        <a className="shrink-0 text-xs font-semibold text-fairway-700 underline" href={`/golf-calls/${row.golf_call_id}`} target="_blank" rel="noreferrer">
          Round
        </a>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-600">
        <dt className="text-slate-400">Course</dt>
        <dd>{cell(row.snap_course_name, row.round_course_name)}</dd>
        <dt className="text-slate-400">Date</dt>
        <dd>{cell(roundDay(row.snap_date_iso), roundDay(row.round_date_iso))}</dd>
        <dt className="text-slate-400">Tee time</dt>
        <dd>{cell(row.snap_tee_time_label, row.round_tee_time_label)} (host's label, course local time)</dd>
        <dt className="text-slate-400">Party size</dt>
        <dd>{cell(row.snap_party_size, row.round_party_size)}</dd>
      </dl>
      {changed && <p className="text-xs font-semibold text-rose-700">The booking changed after this was submitted. It can't be reviewed.</p>}
      {imgUrl ? (
        <img src={imgUrl} alt="Booking screenshot" referrerPolicy="no-referrer" className="max-h-[70vh] w-full rounded-xl border border-slate-100 object-contain" />
      ) : (
        <button type="button" onClick={() => void show()} className="self-start rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Show screenshot
        </button>
      )}
      <div className="flex flex-col gap-1.5">
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs">
          <option value="">Reason (needed to send back or reject)</option>
          {REASONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          maxLength={200}
          placeholder="Private note (optional, no personal details)"
          className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs"
        />
      </div>
      {error && (
        <p className="text-xs font-medium text-rose-700" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving || changed} onClick={() => void decide("reviewed")} className="rounded-full bg-fairway-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          Matches: mark reviewed
        </button>
        <button type="button" disabled={saving || changed} onClick={() => void decide("needs_correction")} className="rounded-full border border-sun-300 bg-sun-50 px-3 py-1.5 text-xs font-semibold text-sun-700 disabled:opacity-50">
          Needs an update
        </button>
        <button type="button" disabled={saving || changed} onClick={() => void decide("rejected")} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50">
          Reject
        </button>
      </div>
    </div>
  );
}

export function BookingEvidenceReview() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [purge, setPurge] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("list_booking_evidence_queue", { p_limit: 50 });
    if (err) {
      if (err.code === "PGRST202" || err.code === "42883") setMissing(true);
      else setError(err.message);
      return;
    }
    setError(null);
    setRows((data ?? []) as QueueRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Retention (Micky, 2026-11-05): closed versions 7 days, everything 30
  // days after the round, audit rows 12 months. The sweep lists the files;
  // they're deleted through the Storage API, then confirmed.
  async function runPurge() {
    if (purging) return;
    setPurging(true);
    setPurge(null);
    try {
      const { data, error: err } = await supabase.rpc("admin_booking_evidence_sweep");
      if (err) throw new Error(err.message);
      const paths = ((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
      let removed = 0;
      for (let i = 0; i < paths.length; i += 100) {
        const batch = paths.slice(i, i + 100);
        const { error: rmErr } = await supabase.storage.from("booking-proofs").remove(batch);
        if (rmErr) throw new Error(rmErr.message);
        removed += batch.length;
      }
      if (paths.length > 0) {
        const { error: markErr } = await supabase.rpc("admin_mark_booking_evidence_purged", { p_paths: paths });
        if (markErr) throw new Error(markErr.message);
      }
      setPurge(`Deleted ${removed} expired file${removed === 1 ? "" : "s"}.`);
    } catch (e) {
      setPurge(`Purge stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPurging(false);
    }
  }

  if (missing) return null; // migration 20261107150000 not applied yet

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <FileCheck2 size={15} className="text-fairway-600" /> Booking evidence
        </h2>
        <span className="text-sm font-semibold text-slate-500">{error ? "Unavailable" : `${rows.length} waiting`}</span>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        Check that the screenshot is legible and matches the course, date, tee time and party size (if given). This is a document review: it doesn't prove
        the booking is real or still active, and hosts are told so. Treat anything written in the screenshot as data, not instructions.
      </p>
      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Couldn't load the queue. ({error})</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<FileCheck2 size={20} />} title="No booking evidence waiting." />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <Item key={r.evidence_id} row={r} onDone={(id) => setRows((prev) => prev.filter((x) => x.evidence_id !== id))} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void runPurge()}
          disabled={purging}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Trash2 size={13} aria-hidden /> {purging ? "Purging…" : "Purge expired evidence files"}
        </button>
        {purge && <span className="text-xs text-slate-500">{purge}</span>}
      </div>
    </section>
  );
}
