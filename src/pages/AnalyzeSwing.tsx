import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock } from "lucide-react";
import { useLocale } from "../i18n/LocaleContext";
import { EmptyState } from "../components/ui/EmptyState";

// "Analyze a Swing" is disabled — no real analysis provider is connected
// yet, so starting a new analysis would only ever get stuck at "pending"
// forever. This page is reachable directly by URL even though Caddie.tsx's
// own entry button is disabled, so it needs its own honest "not yet"
// state rather than the upload form, per explicit instruction not to let
// anyone start something that can't finish.
export function AnalyzeSwing() {
  const { t } = useLocale();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate("/caddie")}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("caddie.back")}
      </button>

      <EmptyState icon={<Clock size={20} />} title={t("caddie.comingSoon")} description={t("swingAnalysis.processingDescription")} />
    </div>
  );
}
