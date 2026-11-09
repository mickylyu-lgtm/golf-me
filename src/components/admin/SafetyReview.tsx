import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SuspendUserDialog } from "../moderation/SuspendUserDialog";
import {
  SAFETY_SIGNALS,
  SAFETY_STATUSES,
  SIGNAL_LABELS,
  SINCE_OPTIONS,
  STATUS_LABELS,
  TRANSITION_LABELS,
  allowedTransitions,
  availabilityFrom,
  detectorNotice,
  flagSummary,
  formatWindow,
  sinceIso,
  transitionNeedsReason,
  type SafetyAvailability,
  type SafetySignal,
  type SafetyStatus,
  type SinceKey,
} from "../../lib/safetyReview";

// Admin dashboard: the Safety Review queue (migration 20261108180000).
// Self-contained: mounted with one line in AdminDashboard, below Reports
// (which it never replaces). Shadow mode: everything here is for a person to
// review; nothing is done to an account unless an admin uses the existing
// Suspend / Remove tools. Plain English, like the rest of the dashboard.

interface FlagRow {
  id: string;
  subject_user_id: string;
  subject_name: string | null;
  subject_username: string | null;
  account_age_days: number | null;
  signal: SafetySignal;
  rule_version: number;
  threshold: number;
  window_seconds: number;
  observed_count: number;
  first_observed_at: string;
  last_observed_at: string;
  status: SafetyStatus;
  status_reason: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  revision: number;
  created_at: string;
  subject_suspended: boolean;
}
interface EvidenceRow {
  kind: "post" | "comment" | "report" | "minute";
  item_id: string | null;
  post_id: string | null;
  at: string;
  count: number | null;
  label: string | null;
}

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "-";
}
const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? "border-fairway-300 bg-fairway-50 text-fairway-800" : "border-slate-200 bg-white text-slate-600"}`;

export function SafetyReview() {
  const [availability, setAvailability] = useState<SafetyAvailability | null>(null);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [status, setStatus] = useState<SafetyStatus | "all">("new");
  const [signal, setSignal] = useState<SafetySignal | "all">("all");
  const [since, setSince] = useState<SinceKey>("30d");
  const [busy, setBusy] = useState<string | null>(null);
  const [detectorReason, setDetectorReason] = useState("");

  const loadStatus = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_safety_status");
    setAvailability(availabilityFrom(data, error));
  }, []);

  const loadFlags = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await supabase.rpc("admin_safety_list_flags", {
      p_status: status === "all" ? null : status,
      p_signal: signal === "all" ? null : signal,
      p_since: sinceIso(since),
      p_limit: 100,
    });
    setLoadingList(false);
    if (error) {
      setListError(error.message);
      return;
    }
    setListError(null);
    setFlags((data ?? []) as FlagRow[]);
  }, [status, signal, since]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  useEffect(() => {
    if (availability?.kind === "ready") void loadFlags();
  }, [availability?.kind, loadFlags]);

  async function setDetector(enabled: boolean) {
    if (!detectorReason.trim()) return;
    setBusy("detector");
    const { error } = await supabase.rpc("admin_safety_set_detector", { p_enabled: enabled, p_reason: detectorReason.trim() });
    setBusy(null);
    if (error) {
      window.alert(`Couldn't change the detector: ${error.message}`);
      return;
    }
    setDetectorReason("");
    await loadStatus();
  }

  async function runNow() {
    setBusy("run");
    const { error } = await supabase.rpc("admin_safety_run_now");
    setBusy(null);
    if (error) window.alert(`Couldn't run the detector: ${error.message}`);
    await loadStatus();
    await loadFlags();
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="safety-review-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="safety-review-heading" className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <ShieldAlert size={15} className="text-fairway-600" /> Safety Review
        </h2>
        {availability?.kind === "ready" && (
          <span className="text-xs font-semibold text-slate-500">
            {(availability.status.open_counts.new ?? 0) + (availability.status.open_counts.in_review ?? 0) + (availability.status.open_counts.appealed ?? 0)} open
          </span>
        )}
      </div>

      {availability === null && <p className="text-sm text-slate-500">Loading Safety Review…</p>}
      {availability?.kind === "not_installed" && (
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          Safety Review isn't set up on this database yet (migration 20261108180000). Reports above work as usual.
        </p>
      )}
      {availability?.kind === "error" && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm text-rose-700">
            <span className="font-semibold">Couldn't load Safety Review.</span> This is not the same as "no flags". ({availability.message})
          </p>
          <button type="button" onClick={() => void loadStatus()} className="shrink-0 rounded-full border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700">
            Retry
          </button>
        </div>
      )}

      {availability?.kind === "ready" && (
        <>
          <DetectorPanel
            availability={availability}
            busy={busy}
            reason={detectorReason}
            onReason={setDetectorReason}
            onToggle={setDetector}
            onRunNow={runNow}
          />

          <div className="flex flex-col gap-2" role="group" aria-label="Filters">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
              {(["all", ...SAFETY_STATUSES] as const).map((s) => (
                <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={chip(status === s)}>
                  {s === "all" ? "All" : STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="text-xs text-slate-500" htmlFor="safety-signal">
                Signal
              </label>
              <select
                id="safety-signal"
                value={signal}
                onChange={(e) => setSignal(e.target.value as SafetySignal | "all")}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
              >
                <option value="all">All signals</option>
                {SAFETY_SIGNALS.map((s) => (
                  <option key={s} value={s}>
                    {SIGNAL_LABELS[s].title}
                  </option>
                ))}
              </select>
              <span className="ml-1 text-xs text-slate-500">Last seen</span>
              {SINCE_OPTIONS.map((o) => (
                <button key={o.key} type="button" aria-pressed={since === o.key} onClick={() => setSince(o.key)} className={chip(since === o.key)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {listError ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-sm text-rose-700">
                <span className="font-semibold">Couldn't load flags.</span> There may be flags you can't see. ({listError})
              </p>
              <button type="button" onClick={() => void loadFlags()} className="shrink-0 rounded-full border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700">
                Retry
              </button>
            </div>
          ) : loadingList && flags.length === 0 ? (
            <p className="text-sm text-slate-500">Loading flags…</p>
          ) : flags.length === 0 ? (
            <p className="rounded-2xl border border-slate-100 bg-white p-4 text-center text-sm text-slate-500">
              No flags match these filters.
              {!availability.status.detector_enabled && " The detector is off, so no automated flags are being produced."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {flags.map((f) => (
                <FlagCard key={f.id} flag={f} onChanged={() => void Promise.all([loadFlags(), loadStatus()])} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function DetectorPanel({
  availability,
  busy,
  reason,
  onReason,
  onToggle,
  onRunNow,
}: {
  availability: Extract<SafetyAvailability, { kind: "ready" }>;
  busy: string | null;
  reason: string;
  onReason: (v: string) => void;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void;
}) {
  const s = availability.status;
  const notice = detectorNotice(s);
  const tone =
    notice.tone === "ok"
      ? "border-slate-100 bg-white text-slate-600"
      : notice.tone === "off"
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <div className={`flex flex-col gap-2 rounded-2xl border p-3 text-sm ${tone}`} role={notice.tone === "error" ? "alert" : "status"}>
      <p>
        <span className="font-semibold">Detector {s.detector_enabled ? "on" : "off"}.</span> {notice.text}
      </p>
      <p className="text-xs text-slate-500">
        Last run {fmt(s.last_run_at)} · Rules:{" "}
        {s.rules.map((r) => `${SIGNAL_LABELS[r.signal as SafetySignal]?.title ?? r.signal} ${r.threshold} / ${formatWindow(r.window_seconds)} (v${r.version})`).join("; ")} ·
        Unconfirmed flags deleted after {s.unconfirmed_retention_days} days, confirmed after {s.confirmed_retention_days}.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={reason}
          onChange={(e) => onReason(e.target.value.slice(0, 500))}
          placeholder={s.detector_enabled ? "Reason for turning it off" : "Reason for turning it on"}
          aria-label="Reason for changing the detector"
          className="min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800"
        />
        <button
          type="button"
          disabled={!reason.trim() || busy === "detector"}
          onClick={() => onToggle(!s.detector_enabled)}
          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
        >
          {s.detector_enabled ? "Turn detector off" : "Turn detector on (shadow)"}
        </button>
        {s.detector_enabled && (
          <button type="button" disabled={busy === "run"} onClick={onRunNow} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">
            {busy === "run" ? "Running…" : "Run now"}
          </button>
        )}
      </div>
    </div>
  );
}

function FlagCard({ flag: f, onChanged }: { flag: FlagRow; onChanged: () => void }) {
  const meta = SIGNAL_LABELS[f.signal];
  const [pending, setPending] = useState<SafetyStatus | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[] | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const name = `${f.subject_name ?? "Unknown"}${f.subject_username ? ` (@${f.subject_username})` : ""}`;

  async function apply(to: SafetyStatus) {
    if (transitionNeedsReason(to) && !reason.trim()) {
      setPending(to);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.rpc("admin_safety_review", { p_flag_id: f.id, p_status: to, p_reason: reason.trim() || null, p_revision: f.revision });
    setSaving(false);
    if (e) {
      setError(e.code === "40001" ? "Someone else changed this flag. It has been reloaded; check it and try again." : e.message);
      if (e.code === "40001") onChanged();
      return;
    }
    setPending(null);
    setReason("");
    onChanged();
  }

  async function loadEvidence() {
    const { data, error: e } = await supabase.rpc("admin_safety_flag_evidence", { p_flag_id: f.id });
    if (e) {
      setEvidenceError(e.message);
      return;
    }
    setEvidenceError(null);
    setEvidence((data ?? []) as EvidenceRow[]);
  }

  return (
    <li className={`flex flex-col gap-2 rounded-2xl border p-3 ${f.status === "new" ? "border-amber-200 bg-amber-50/40" : "border-slate-100 bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">{meta.title}</p>
          <p className="truncate text-xs text-slate-600">{name}</p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{STATUS_LABELS[f.status]}</span>
      </div>
      <p className="text-xs text-slate-500">
        {meta.source === "reports" ? "From user reports (validated, distinct reporters). Reports can be coordinated: review them before acting." : "Automated flag, shadow mode: nothing was done to this account."}
      </p>
      <p className="text-sm text-slate-700">{flagSummary(f)}</p>
      <p className="text-xs text-slate-500">
        First seen {fmt(f.first_observed_at)} · last seen {fmt(f.last_observed_at)}
        {f.account_age_days !== null && <> · account {f.account_age_days} days old (context only, not a signal)</>}
        {f.subject_suspended && <> · currently suspended</>}
      </p>
      {f.status_reason && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {STATUS_LABELS[f.status]}: "{f.status_reason}"{f.reviewed_by_name ? ` by ${f.reviewed_by_name}` : ""} {f.reviewed_at ? `· ${fmt(f.reviewed_at)}` : ""}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Link to={`/golfer/${f.subject_user_id}`} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-fairway-700">
          Open profile
        </Link>
        <button type="button" onClick={() => void loadEvidence()} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
          {evidence ? "Refresh evidence" : "Show evidence"}
        </button>
        {allowedTransitions(f.status).map((to) => (
          <button
            key={to}
            type="button"
            disabled={saving}
            onClick={() => void apply(to)}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold disabled:opacity-40 ${to === "actioned" ? "border-red-200 bg-white text-red-600" : "border-slate-200 bg-white text-slate-600"}`}
          >
            {TRANSITION_LABELS[to]}
          </button>
        ))}
        {(f.status === "actioned" || f.status === "appealed") && !f.subject_suspended && (
          <button type="button" onClick={() => setSuspendOpen(true)} className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600">
            Suspend…
          </button>
        )}
      </div>

      {pending && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2">
          <label className="text-xs font-semibold text-slate-600" htmlFor={`reason-${f.id}`}>
            Reason for "{TRANSITION_LABELS[pending]}" (required, only admins see it)
          </label>
          <textarea
            id={`reason-${f.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={2}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          />
          <div className="flex gap-1.5">
            <button type="button" onClick={() => { setPending(null); setReason(""); }} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
              Cancel
            </button>
            <button type="button" disabled={!reason.trim() || saving} onClick={() => void apply(pending)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 disabled:opacity-40">
              {saving ? "Saving…" : TRANSITION_LABELS[pending]}
            </button>
          </div>
          {pending === "actioned" && (
            <p className="text-xs text-slate-500">Confirming records the decision only. Suspending or removing content is a separate, explicit step.</p>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}

      {evidenceError && <p role="alert" className="text-xs text-rose-700">Couldn't load evidence: {evidenceError}</p>}
      {evidence && (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {evidence.length === 0 ? (
            <p>No evidence rows (the items may have been deleted).</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {evidence.map((e, i) => (
                <li key={`${e.kind}-${e.item_id ?? e.at}-${i}`}>
                  {e.kind === "minute" ? (
                    <>
                      {fmt(e.at)} · {e.count} new conversation{e.count === 1 ? "" : "s"} started (no message content is shown or stored)
                    </>
                  ) : e.kind === "report" ? (
                    <>
                      {fmt(e.at)} · report: {e.label} (see Reports above)
                    </>
                  ) : (
                    <>
                      {fmt(e.at)} · {e.kind}{" "}
                      {e.post_id && (
                        <Link to={`/community/${e.post_id}`} className="font-semibold text-fairway-700 underline underline-offset-2">
                          open
                        </Link>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {suspendOpen && (
        <SuspendUserDialog
          userId={f.subject_user_id}
          name={f.subject_name ?? "this user"}
          onClose={() => setSuspendOpen(false)}
          onSuspended={() => {
            setSuspendOpen(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}
