import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp, Flag } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { GOLFCORE_TEE_PILOT_ROW_COUNTS } from "../../lib/golfCoreTeePilot";
import { supabase } from "../../lib/supabase";

type Result = { kind: "unavailable" | "failed" } | { kind: "ready"; html: string };

export function GolfCoreTeeRatings({ courseId }: { courseId: string }) {
  const { t, locale } = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ locale: string; value: Result } | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => {
      controller.abort();
      setResult({ locale, value: { kind: "failed" } });
    }, 10_000);
    function finish(value: Result) {
      if (controller.signal.aborted) return;
      window.clearTimeout(deadline);
      setResult({ locale, value });
    }
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (controller.signal.aborted) return;
        if (error || !data.session?.access_token) return finish({ kind: "failed" });
        const response = await fetch("/api/course-tee-panel", {
          method: "POST", cache: "no-store", redirect: "error", signal: controller.signal,
          headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ courseId, locale }),
        });
        if (response.status === 404) return finish({ kind: "unavailable" });
        if (!response.ok || response.headers.get("X-GolfMe-View") !== "course-tee-panel-v1" ||
            !response.headers.get("Content-Type")?.startsWith("text/html")) return finish({ kind: "failed" });
        const html = await response.text();
        // The SPA rewrite's shell is also text/html; never embed that on a
        // missing endpoint or unexpected response from the first-party route.
        if (!html.startsWith("<!doctype html><html lang=") || html.length > 16_384) return finish({ kind: "failed" });
        finish({ kind: "ready", html });
      } catch {
        finish({ kind: "failed" });
      }
    })();
    return () => {
      window.clearTimeout(deadline);
      controller.abort();
    };
  }, [open, attempt, courseId, locale]);
  const value = result?.locale === locale ? result.value : undefined;
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900">
    <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left" aria-expanded={open} aria-controls={id} onClick={() => { setResult(null); setOpen(!open); }}>
      <span className="flex items-center gap-2 font-bold text-slate-900"><Flag size={18} className="text-fairway-700" />{t("teeRatings.title")}</span>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
    </button>
    {open && <div id={id} className="mt-3">
      {value?.kind === "ready" ? <iframe title={t("teeRatings.title")} className="w-full border-0"
        srcDoc={value.html} sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer" style={{ height: 165 + 55 * (GOLFCORE_TEE_PILOT_ROW_COUNTS[courseId] ?? 1) }} /> :
        <p role="status" className="text-sm text-slate-500">{t(value?.kind === "failed" ? "teeRatings.failed" : value?.kind === "unavailable" ? "teeRatings.unavailable" : "teeRatings.loading")}</p>}
      {value?.kind === "failed" && <button type="button" className="mt-2 min-h-11 rounded-xl border border-slate-200 px-4 font-semibold text-fairway-800" onClick={() => { setResult(null); setAttempt((n) => n + 1); }}>{t("teeRatings.retry")}</button>}
    </div>}
  </section>;
}
