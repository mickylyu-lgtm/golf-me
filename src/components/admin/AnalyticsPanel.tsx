import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { Activity, Calendar, MessageSquare, RefreshCw, Shield, Stethoscope, Users, Wand2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  REPORTING_TIMEZONE_LABEL,
  addDays,
  classifyRpcError,
  fmtAgo,
  fmtDuration,
  fmtRate,
  fmtRetention,
  nextSectionState,
  presetRange,
  reportingToday,
  validateRange,
} from "../../lib/adminAnalytics";
import type {
  ActivityData,
  CaddieData,
  DateRange,
  ExclusionsData,
  GolfCallsData,
  RangeKey,
  RetentionData,
  SectionState,
  SocialData,
} from "../../lib/adminAnalytics";
import { useLiveRefresh } from "../../lib/useLiveRefresh";

// Product analytics for /admin/dashboard (definitions: docs/ANALYTICS_CONTRACT.md).
// Every number comes from an admin-only server function; this component
// never computes a metric, never shows 0 for "unavailable" or "failed", and
// keeps the last good numbers (marked stale) when a refresh fails.

const RANGE_TABS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "custom", label: "Custom" },
];

const RETENTION_COHORT_DAYS = 90;

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<{ data: T } | { error: { code?: string; message?: string } }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error };
  return { data: data as T };
}

function Tile({ label, value, detail, title, emphasis }: { label: string; value: ReactNode; detail?: ReactNode; title?: string; emphasis?: boolean }) {
  return (
    <div title={title} className={`rounded-2xl border p-3 ${emphasis ? "border-fairway-100 bg-fairway-50/40" : "border-slate-100 bg-white"}`}>
      <p className="text-lg font-bold tabular-nums text-slate-800">{value}</p>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      {detail && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{detail}</p>}
    </div>
  );
}

function Section<T>({
  title,
  icon,
  state,
  onRetry,
  note,
  children,
}: {
  title: string;
  icon: ReactNode;
  state: SectionState<T>;
  onRetry: () => void;
  note?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const data = state.kind === "ok" ? state.data : state.kind === "error" ? state.data : undefined;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
        {icon} {title}
      </h3>
      {state.kind === "loading" && <p className="rounded-2xl border border-slate-100 bg-white p-3 text-xs text-slate-400">Loading…</p>}
      {state.kind === "unavailable" && (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">Unavailable. {state.reason}</p>
      )}
      {state.kind === "error" && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs text-rose-700">
            <span className="font-semibold">Couldn't load this.</span> {data ? "Showing the last numbers that loaded." : "No numbers shown rather than wrong ones."} ({state.message})
          </p>
          <button type="button" onClick={onRetry} className="shrink-0 rounded-full border border-rose-300 bg-white px-3 py-1 text-xs font-semibold text-rose-700">
            Retry
          </button>
        </div>
      )}
      {data !== undefined && <div className={state.kind === "error" ? "opacity-60" : undefined}>{children(data)}</div>}
      {note && data !== undefined && <p className="text-[11px] leading-snug text-slate-400">{note}</p>}
    </section>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>;
}

export function AnalyticsPanel() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("7d");
  const [custom, setCustom] = useState<DateRange>(() => presetRange("30d"));
  const range = rangeKey === "custom" ? custom : presetRange(rangeKey);
  const rangeError = rangeKey === "custom" ? validateRange(custom) : null;

  const [activity, setActivity] = useState<SectionState<ActivityData>>({ kind: "loading" });
  const [retention, setRetention] = useState<SectionState<RetentionData>>({ kind: "loading" });
  const [golf, setGolf] = useState<SectionState<GolfCallsData>>({ kind: "loading" });
  const [social, setSocial] = useState<SectionState<SocialData>>({ kind: "loading" });
  const [caddie, setCaddie] = useState<SectionState<CaddieData>>({ kind: "loading" });
  const [exclusions, setExclusions] = useState<SectionState<ExclusionsData>>({ kind: "loading" });
  const lastRangeKey = useRef("");

  const refresh = useCallback(async () => {
    if (rangeError) return "skip" as const;
    const args = { p_from: range.from, p_to: range.to };
    const today = reportingToday();
    const [a, r, g, s, c, x] = await Promise.all([
      call<ActivityData>("admin_analytics_activity", args),
      call<RetentionData>("admin_analytics_retention", { p_from: addDays(today, -(RETENTION_COHORT_DAYS - 1)), p_to: today }),
      call<GolfCallsData>("admin_analytics_golf_calls", args),
      call<SocialData>("admin_analytics_social", args),
      call<CaddieData>("admin_analytics_caddie", args),
      call<ExclusionsData>("admin_analytics_exclusions"),
    ]);
    // A range change must not show the old range's numbers as "last good".
    const rangeChanged = lastRangeKey.current !== `${range.from}:${range.to}`;
    lastRangeKey.current = `${range.from}:${range.to}`;
    const keep = <T,>(prev: SectionState<T>): SectionState<T> => (rangeChanged ? { kind: "loading" } : prev);
    setActivity((p) => nextSectionState(keep(p), a));
    setRetention((p) => nextSectionState(p, r));
    setGolf((p) => nextSectionState(keep(p), g));
    setSocial((p) => nextSectionState(keep(p), s));
    setCaddie((p) => nextSectionState(keep(p), c));
    setExclusions((p) => nextSectionState(p, x));
    const kinds: string[] = [];
    for (const [name, o] of Object.entries({ a, r, g, s, c, x })) {
      if ("error" in o) {
        console.error(`GolfMe: analytics ${name} failed.`, o.error);
        kinds.push(classifyRpcError(o.error).kind);
      } else kinds.push("ok");
    }
    if (kinds.every((k) => k === "unavailable")) return "not_set_up" as const;
    return kinds.some((k) => k === "error") ? ("error" as const) : ("ok" as const);
  }, [range.from, range.to, rangeError]);

  // Re-runs on its own when the range (and so `refresh`) changes.
  const live = useLiveRefresh(refresh, { enabled: true });

  const changeRange = (key: RangeKey) => setRangeKey(key);

  const statusChip = (() => {
    switch (live.status) {
      case "live":
        return { dot: "bg-fairway-500", text: "Live", tone: "text-fairway-700" };
      case "paused":
        return { dot: "bg-slate-300", text: "Paused while this page is hidden", tone: "text-slate-500" };
      case "stale":
        return { dot: "bg-sun-500", text: "Stale: updates are failing, retrying with backoff", tone: "text-sun-700" };
      case "not_set_up":
        return { dot: "bg-slate-300", text: "Not set up yet", tone: "text-slate-500" };
      default:
        return { dot: "bg-slate-300", text: "Connecting…", tone: "text-slate-500" };
    }
  })();

  const isPartial = range.to >= reportingToday();
  const prevLabel = rangeKey === "today" ? "yesterday so far" : "previous period";

  return (
    <section className="flex flex-col gap-4" aria-labelledby="analytics-heading">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="analytics-heading" className="flex items-center gap-1.5 text-base font-bold text-slate-900">
              <Activity size={16} className="text-fairway-600" /> Product analytics
            </h2>
            <p className="text-[11px] text-slate-500">
              Active = joined a round someone else hosts, or sent a message to another real golfer. Excludes your account, admins, test accounts and bots. {REPORTING_TIMEZONE_LABEL}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void live.refreshNow()}
            disabled={live.refreshing}
            aria-label="Refresh analytics now"
            className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            <RefreshCw size={12} className={live.refreshing ? "motion-safe:animate-spin" : undefined} /> Refresh
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" aria-live="polite">
          <span className={`inline-flex items-center gap-1.5 font-semibold ${statusChip.tone}`}>
            <span className={`h-2 w-2 rounded-full ${statusChip.dot}`} aria-hidden="true" />
            {statusChip.text}
          </span>
          {live.lastSuccessAt !== null && <span className="text-slate-400">Updated {fmtAgo(live.now - live.lastSuccessAt)} · refreshes every 30 s while open</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Date range">
          {RANGE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={rangeKey === t.key}
              onClick={() => changeRange(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${rangeKey === t.key ? "bg-slate-800 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
          {rangeKey === "custom" && (
            <span className="flex items-center gap-1 text-xs text-slate-600">
              <input
                type="date"
                aria-label="Start date"
                value={custom.from}
                max={reportingToday()}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="rounded-lg border border-slate-200 bg-white px-1.5 py-0.5"
              />
              to
              <input
                type="date"
                aria-label="End date"
                value={custom.to}
                max={reportingToday()}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="rounded-lg border border-slate-200 bg-white px-1.5 py-0.5"
              />
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-400">
          {range.from === range.to ? range.from : `${range.from} to ${range.to}`}
          {isPartial ? " · includes today so far (partial day)" : ""}
          {rangeError ? <span className="text-rose-600"> · {rangeError}</span> : null}
        </p>
      </div>

      <Section title="Active golfers" icon={<Users size={15} className="text-fairway-600" />} state={activity} onRetry={() => void live.refreshNow()}
        note={(() => {
          const d = activity.kind === "ok" ? activity.data : activity.kind === "error" ? activity.data : undefined;
          if (!d) return null;
          const start = d.coverage.events_tracking_started_at;
          return `Now / today / 7 / 30 days are rolling and don't follow the range. "Now" = activity in the last 5 minutes, not who has the app open. Join history before ${start ? new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "tracking started"} keeps only each golfer's latest join per round.`;
        })()}
      >
        {(d) => (
          <div className="flex flex-col gap-2">
            <Grid>
              <Tile emphasis label="Active now" value={d.active_last_5_min} detail="last 5 minutes" />
              <Tile emphasis label="Active today" value={d.dau_today} detail="since midnight ET" />
              <Tile emphasis label="Active 7 days" value={d.wau_rolling_7d} detail="rolling" />
              <Tile emphasis label="Active 30 days" value={d.mau_rolling_30d} detail={`avg ${d.stickiness_30d.avg_dau ?? "—"}/day over 30 full days`} />
            </Grid>
            <Grid>
              <Tile label="Active in range" value={d.active_users} detail={`${d.prev_active_users} in the ${prevLabel}`} />
              <Tile label="New" value={d.new_active_users} detail="first activity ever in range" />
              <Tile label="Returning" value={d.returning_active_users} detail="also active before the range" />
              <Tile
                label="How they were active"
                value={<span className="text-sm">{d.by_source.round_join} / {d.by_source.dm} / {d.by_source.round_message}</span>}
                detail="joined a round / DM / round chat (golfers can be in several)"
              />
            </Grid>
          </div>
        )}
      </Section>

      <Section title="Golf Calls & matching" icon={<Calendar size={15} className="text-fairway-600" />} state={golf} onRetry={() => void live.refreshNow()}
        note="Rounds = hosted in range by real golfers. Joins = by real golfers in range, into any round (incl. yours). Fill counts the host's slot and current members only. Played is never inferred from the date.">
        {(g) => (
          <div className="flex flex-col gap-2">
            <Grid>
              <Tile emphasis label="Rounds joined" value={g.joins} detail={`${g.repeat_joiners} golfers joined 2+ rounds`} />
              <Tile emphasis label="Unique joiners" value={g.unique_joiners} detail={g.joiners_into_excluded_hosts_rounds > 0 ? `${g.joiners_into_excluded_hosts_rounds} joined your rounds` : undefined} />
              <Tile emphasis label="Fill rate" value={fmtRate(g.fill.slots_taken_now, g.fill.slots_total)} detail={`${g.fill.slots_taken_now} of ${g.fill.slots_total} slots · ${g.fill.rounds_full_now} full`} />
              <Tile label="Rounds hosted" value={g.rounds_hosted} detail={`${g.unique_hosts} hosts · ${fmtRate(g.rounds_with_a_join, g.rounds_hosted)} got a join`} />
              <Tile label="Time to first join" value={fmtDuration(g.median_minutes_to_first_join)} detail="median, after hosting" />
              <Tile label="No joins, tee time passed" value={g.zero_join_past_rounds} detail={`${g.zero_join_upcoming_rounds} upcoming still waiting`} />
              <Tile label="Upcoming now" value={g.upcoming_now} detail="open or full, tee time ahead" />
              <Tile label="Cancelled" value={g.cancelled_rounds} detail="of rounds hosted in range" />
              <Tile label="Played: host-confirmed" value={g.played.host_confirmed} detail="host marked completed" />
              <Tile label="Played: golfer-confirmed" value={g.played.participant_confirmed} detail={`a joined golfer's review said someone showed up · ${g.played.both} both · ${g.played.combined_deduped} total`} />
              <Tile label="Estimated played" value="—" detail="Unavailable until a rule is agreed" />
              <Tile label="Golfer pairs who shared a round" value={g.co_participation_pairs} detail="not friendship or proof they met" />
            </Grid>
          </div>
        )}
      </Section>

      <Section title="Social" icon={<MessageSquare size={15} className="text-fairway-600" />} state={social} onRetry={() => void live.refreshNow()}
        note="Messages to real golfers only (the automated welcome DM and chats with test accounts don't count). Unsent messages still count as sent. Messaging is itself activity, so the messaging share of active golfers is shown separately from Community.">
        {(s) => (
          <Grid>
            <Tile emphasis label="Two-way conversations" value={s.two_way_dm_conversations} detail={`DMs where both golfers wrote · ${s.new_two_way_dm_conversations} new`} />
            <Tile label="Golfers messaging" value={s.messaging_users} detail={`${s.dm_senders} DM · ${s.round_chat_senders} round chat · ${fmtRate(s.active_messaging, s.active_users)} of active`} />
            <Tile label="Messages per active golfer" value={s.messages_per_active_user ?? "—"} detail={`${s.dm_messages} DMs · ${s.round_chat_messages} round chat`} />
            <Tile label="Round chats" value={s.round_chats_active} detail={`${s.round_chats_two_way} with 2+ golfers writing`} />
            <Tile label="Active in Community" value={fmtRate(s.active_in_community, s.active_users)} detail={`${s.active_in_community} of ${s.active_users} active golfers`} />
            <Tile label="Post creators" value={s.post_creators} detail={`${s.posts} posts`} />
            <Tile label="Commenters" value={s.commenters} />
            <Tile label="Liked or commented" value={s.post_interactors} detail={`${s.community_users} golfers used Community`} />
          </Grid>
        )}
      </Section>

      <Section title="Acquisition & retention" icon={<Shield size={15} className="text-fairway-600" />} state={retention} onRetry={() => void live.refreshNow()}
        note={`Signups in the last ${RETENTION_COHORT_DAYS} days (fixed, not the range). Dn = active on exactly day n after signup. Days that haven't ended yet are pending, never 0.`}>
        {(r) => {
          const d1 = fmtRetention(r.d1);
          const d7 = fmtRetention(r.d7);
          const d30 = fmtRetention(r.d30);
          return (
            <Grid>
              <Tile label="Signups" value={r.cohort_users} detail={`${fmtRate(r.onboarded_users, r.cohort_users)} finished onboarding`} />
              <Tile label="Day 1 retention" value={d1.value} detail={d1.detail} />
              <Tile label="Day 7 retention" value={d7.value} detail={d7.detail} />
              <Tile label="Day 30 retention" value={d30.value} detail={d30.detail} />
              <Tile
                label="Signup to first activity"
                value={r.first_activity.median_hours == null ? "—" : fmtDuration(Number(r.first_activity.median_hours) * 60)}
                detail={`median · ${r.first_activity.users_without_activity} not active yet`}
              />
            </Grid>
          );
        }}
      </Section>

      <Section title="Caddie" icon={<Wand2 size={15} className="text-fairway-600" />} state={caddie} onRetry={() => void live.refreshNow()}
        note="One analysis = one job (retries are the same job). Deleted analyses are gone. Caddie use is a feature metric and doesn't count as activity.">
        {(c) => (
          <Grid>
            <Tile emphasis label="Caddie repeat users" value={c.repeat_users} detail={`2+ analyses in range · ${c.unique_users} users`} />
            <Tile label="Returning Caddie users" value={c.returning_users} detail="also used Caddie before the range" />
            <Tile label="Analyses" value={c.analyses} detail={`${c.complete} complete · ${c.failed} failed · ${c.processing} processing`} />
            <Tile label="Failure rate" value={fmtRate(c.failed, c.complete + c.failed)} detail="of finished analyses" />
          </Grid>
        )}
      </Section>

      <section className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <Stethoscope size={15} className="text-fairway-600" /> Product health &amp; live activity feed
        </h3>
        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          Unavailable: needs new tracking (send failures, video playback errors, auth failures, push delivery) that doesn't exist yet. Planned in docs/ANALYTICS_CONTRACT.md. Caddie failures are in Caddie Usage below.
        </p>
      </section>

      <Section title="Who's excluded" icon={<Shield size={15} className="text-slate-400" />} state={exclusions} onRetry={() => void live.refreshNow()}>
        {(x) => (
          <p className="text-xs text-slate-500">
            {x.excluded_total} accounts excluded: {x.by_role.length} by role (admin, test, app reviewer, bot, seeded), {x.listed.length} pinned by account id.
            {x.listed.length === 0 && <span className="font-semibold text-sun-700"> Your account isn't pinned by id yet (it's excluded through the admin role). Run analytics-seed-exclusions.sql to pin it.</span>}
          </p>
        )}
      </Section>
    </section>
  );
}
