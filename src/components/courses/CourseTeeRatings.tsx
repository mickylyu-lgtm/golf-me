import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp, Flag } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { loadCourseTeeRatings, type CourseTeeRatings as Ratings, type TeeRatingSet } from "../../lib/courseTeeRatings";

const available = (r: TeeRatingSet) => r.course != null || r.slope != null || r.bogey != null;
type Segment = "overall" | "front" | "back";

// Provenance is supplied only when the server independently verifies the
// official source. Check URL/date shape before surfacing that metadata.
function scorecardSource(source: Ratings["source"], locale: string) {
  if (!source || !/^\d{4}-\d{2}-\d{2}$/.test(source.reviewedOn)) return null;
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const date = new Date(source.reviewedOn + "T00:00:00Z");
    if (date.toISOString().slice(0, 10) !== source.reviewedOn) return null;
    return { href: url.href, date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date) };
  } catch {
    return null;
  }
}

// Exact conventional labels only; arbitrary names never imply a tee color.
const TEE_SWATCHES = new Map([
  ["black", "#111827"], ["blue", "#2563eb"], ["gold", "#eab308"],
  ["green", "#16a34a"], ["orange", "#ea580c"], ["red", "#dc2626"],
  ["silver", "#94a3b8"], ["white", "#ffffff"], ["yellow", "#facc15"],
]);
function teeSwatch(name: string) {
  return TEE_SWATCHES.get(name.trim().toLowerCase().replace(/ tees?$/, ""));
}

/** Presentation is shared by the live section and the explicitly labelled local fixture. */
export function TeeRatingsPanel({ data }: { data: Ratings }) {
  const { t, locale } = useLocale();
  const id = useId();
  const [selected, setSelected] = useState(0);
  const [segment, setSegment] = useState<Segment>("overall");
  const tee = data.tees[selected] ?? data.tees[0];
  if (!tee) return <p>{t("teeRatings.unavailable")}</p>;
  // A standalone nine is one full round, not an 18-hole front/back split.
  // Some providers encode its sole rating in Front 9 rather than Overall.
  const segments: Segment[] = tee.holes === 9
    ? available(tee.overall) ? ["overall"] : available(tee.front) && !available(tee.back) ? ["front"] : []
    : (["overall", "front", "back"] as const).filter((s) => available(tee[s]));
  const active = segments.includes(segment) ? segment : segments[0];
  const rating = active ? tee[active] : null;
  const source = scorecardSource(data.source, locale);
  const format = (n: number, digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  const label = (s: Segment) => tee.holes === 9 ? t("teeRatings.nine") : s === "overall" ? tee.holes === 18 ? t("teeRatings.eighteen") : t("teeRatings.overall") : t(s === "front" ? "teeRatings.front" : "teeRatings.back");
  return <div className="space-y-4">
    <div>
      <p id={id} className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("teeRatings.choose")}</p>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-labelledby={id}>
        {data.tees.map((option, i) => {
          const swatch = teeSwatch(option.name);
          return <button type="button" key={`${option.name}:${option.group}:${i}`} aria-pressed={selected === i} onClick={() => { setSelected(i); setSegment("overall"); }} className={`min-h-14 min-w-24 flex-1 rounded-xl border px-3 py-2 text-left ${selected === i ? "border-fairway-800 bg-fairway-800 text-white" : "border-slate-200 bg-white text-slate-700"}`}><span className="flex items-center gap-1.5 text-sm font-bold">{swatch && <span aria-hidden="true" className="size-3 shrink-0 rounded-[3px] border border-slate-400" style={{ backgroundColor: swatch }} />}{option.name}</span><span className={`mt-0.5 block whitespace-nowrap text-[10px] ${selected === i ? "text-fairway-100" : "text-slate-500"}`}>{t(option.group === "women" ? "teeRatings.women" : "teeRatings.men")}</span></button>;
        })}
      </div>
    </div>
    {segments.length > 1 ? <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label={t("teeRatings.holes")}>
      {segments.map((s) => <button type="button" key={s} aria-pressed={active === s} onClick={() => setSegment(s)} className={`min-h-11 flex-1 rounded-lg px-2 text-sm font-semibold ${active === s ? "bg-white text-fairway-800 shadow-sm" : "text-slate-500"}`}>{label(s)}</button>)}
    </div> : active ? <p className="text-sm font-semibold text-slate-600">{label(active)}</p> : null}
    {rating && (rating.course != null || rating.slope != null) && <div className={`grid gap-3 ${rating.course != null && rating.slope != null ? "grid-cols-2" : "grid-cols-1"}`}>
      {rating.course != null && <div className="rounded-2xl bg-fairway-50 p-4"><p className="text-xs font-medium text-slate-600">{t("teeRatings.course")}</p><p className="mt-1 text-3xl font-bold tabular-nums text-fairway-900">{format(rating.course, 1)}</p></div>}
      {rating.slope != null && <div className="rounded-2xl bg-fairway-50 p-4"><p className="text-xs font-medium text-slate-600">{t("teeRatings.slope")}</p><p className="mt-1 text-3xl font-bold tabular-nums text-fairway-900">{format(rating.slope, 0)}</p><p className="mt-1 text-xs leading-snug text-slate-600">{t("teeRatings.slopeScale")}</p></div>}
    </div>}
    {!rating && <p className="text-sm text-slate-500">{t("teeRatings.noVerifiedMetrics")}</p>}
    {rating && (rating.course == null || rating.slope == null) && <p className="text-xs text-slate-500">{t("teeRatings.partial")}</p>}
    <p className="text-xs leading-relaxed text-slate-500">{t("teeRatings.explain")}</p>
    {source && <p className="text-xs text-slate-500"><a href={source.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-fairway-800 underline underline-offset-2">{t("teeRatings.scorecard")}</a>{" · "}{t("teeRatings.verified", { date: source.date })}</p>}
    {rating?.bogey != null && <details className="border-t border-slate-100 pt-3"><summary className="cursor-pointer py-1 text-sm font-semibold text-slate-600">{t("teeRatings.more")}</summary><dl className="mt-3 flex items-center justify-between text-sm"><dt className="text-slate-500">{t("teeRatings.bogey")}</dt><dd className="font-semibold tabular-nums text-slate-900">{format(rating.bogey, 1)}</dd></dl></details>}
  </div>;
}

export function CourseTeeRatings({ courseId, enabled }: { courseId?: string; enabled: boolean }) {
  const { t } = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ id: string; data: Ratings | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!open || !enabled || !courseId) return;
    let cancelled = false;
    setResult(null);
    loadCourseTeeRatings(courseId).then((data) => { if (!cancelled) setResult({ id: courseId, data, failed: false }); }, () => { if (!cancelled) setResult({ id: courseId, data: null, failed: true }); });
    return () => { cancelled = true; };
  }, [open, enabled, courseId, attempt]);
  const current = result?.id === courseId ? result : null;
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900">
    <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span className="flex items-center gap-2 font-bold text-slate-900"><Flag size={18} className="text-fairway-700" />{t("teeRatings.title")}</span>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
    </button>
    {open && <div id={id} className="mt-3" aria-live="polite">
      {!enabled || !courseId ? <p className="text-sm text-slate-500">{t("teeRatings.unavailable")}</p> : !current ? <p role="status" className="text-sm text-slate-500">{t("teeRatings.loading")}</p> : current.data?.tees.length ? <TeeRatingsPanel key={courseId} data={current.data} /> : <div className="space-y-3"><p className="text-sm text-slate-500">{t(current.failed ? "teeRatings.failed" : "teeRatings.unavailable")}</p>{current.failed && <button type="button" className="min-h-11 rounded-xl border border-slate-200 px-4 font-semibold text-fairway-800" onClick={() => setAttempt((n) => n + 1)}>{t("teeRatings.retry")}</button>}</div>}
    </div>}
  </section>;
}
