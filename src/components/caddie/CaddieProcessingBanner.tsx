import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Check, Loader2 } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useLocale } from "../../i18n/LocaleContext";

const DONE_VISIBLE_MS = 2800;

// Unlike NotificationPopupHost's transient "something just happened" banner
// (auto-dismisses after 4.5s, fires once per event), this one is a live
// status indicator — pinned at the top for the ENTIRE time any of the
// caller's own caddie_analyses rows are status='processing', across
// navigation, even across a reload (it's derived straight from real data,
// not session-only state, so reopening the app mid-analysis still shows
// it). Flips to a brief checkmark the moment nothing is processing
// anymore, then hides itself — never a persistent "done" state to dismiss.
export function CaddieProcessingBanner() {
  const { caddieAnalyses } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [phase, setPhase] = useState<"hidden" | "processing" | "done">("hidden");
  const prevProcessingIdsRef = useRef<Set<string>>(new Set());
  const doneAnalysisIdRef = useRef<string | undefined>(undefined);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const processing = caddieAnalyses.filter((a) => a.status === "processing");
    const currentIds = new Set(processing.map((a) => a.id));
    const prevIds = prevProcessingIdsRef.current;

    if (currentIds.size > 0) {
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      setPhase("processing");
    } else if (prevIds.size > 0) {
      // Just finished — surface whichever one wrapped up (if several were
      // in flight, any of them is a reasonable link; multiple simultaneous
      // Caddie requests isn't a real scenario the UI needs to distinguish).
      doneAnalysisIdRef.current = [...prevIds][0];
      setPhase("done");
      doneTimerRef.current = setTimeout(() => setPhase("hidden"), DONE_VISIBLE_MS);
    }
    prevProcessingIdsRef.current = currentIds;
  }, [caddieAnalyses]);

  useEffect(() => () => {
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
  }, []);

  if (phase === "hidden") return null;

  const processingId = caddieAnalyses.find((a) => a.status === "processing")?.id;
  const targetId = phase === "processing" ? processingId : doneAnalysisIdRef.current;
  // Already looking at the exact analysis this banner would link to — a
  // banner on top of a page that's already live-updating via realtime
  // would be redundant, same reasoning NotificationPopupHost uses for an
  // open DM thread.
  if (targetId && location.pathname === `/caddie/${targetId}`) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[105] flex justify-center px-3"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", pointerEvents: "none" }}
    >
      <button
        onClick={() => targetId && navigate(`/caddie/${targetId}`)}
        className="flex w-full max-w-sm items-center gap-2.5 rounded-2xl bg-slate-900/90 p-3 text-left shadow-lg shadow-black/30 backdrop-blur-md transition-opacity duration-200"
        style={{ pointerEvents: "auto" }}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
          {phase === "processing" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} className="text-fairway-400" />}
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium text-white">
          {phase === "processing" ? t("caddie.bannerProcessing") : t("caddie.bannerDone")}
        </span>
      </button>
    </div>
  );
}
