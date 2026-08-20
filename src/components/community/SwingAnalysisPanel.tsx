import { Sparkles } from "lucide-react";
import type { SwingAnalysisStatus } from "../../types";
import type { SwingAnalysisSection } from "../../lib/swingAnalysis";
import { useLocale } from "../../i18n/LocaleContext";

interface SwingAnalysisPanelProps {
  status: SwingAnalysisStatus | undefined;
  // Present only once a real provider has actually produced a result — as
  // of today, no code path ever sets this, since swingAnalysisProvider
  // always throws (see src/lib/swingAnalysis.ts). The prop exists so the
  // "complete" rendering path is ready the moment one does.
  result?: SwingAnalysisSection;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fairway-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// Concise by construction — a fixed set of short sections, never one long
// wall of text. Collapsed detail (address/backswing/top/downswing/impact/
// follow-through) sits behind a <details> so the default view is just the
// overall take + what's working + problems + drills, per the "concise
// rather than a wall of text" requirement.
export function SwingAnalysisPanel({ status, result }: SwingAnalysisPanelProps) {
  const { t } = useLocale();
  // No real analysis provider is connected, so a `status` with no `result`
  // would otherwise sit at "processing" forever — hidden rather than
  // showing a spinner that implies work is actively happening. Existing
  // posts from before Caddie requests were disabled can carry this stuck
  // "pending" status; hiding it here is the honest state until a real
  // provider exists.
  if (!status || !result) return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-fairway-100 bg-fairway-50/40 p-4">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-fairway-700">
        <Sparkles size={13} /> {t("swingAnalysis.title")}
      </p>
      <Section title={t("swingAnalysis.overall")}>{result.overallFeedback}</Section>
      <Section title={t("swingAnalysis.whatsWorking")}>
        <BulletList items={result.whatsGoingWell} />
      </Section>
      <Section title={t("swingAnalysis.keyProblems")}>
        <BulletList items={result.keyProblems} />
      </Section>
      <Section title={t("swingAnalysis.tryThis")}>
        <BulletList items={result.priorityDrills} />
      </Section>
      <details className="group">
        <summary className="cursor-pointer text-xs font-semibold text-fairway-700">{t("swingAnalysis.fullBreakdown")}</summary>
        <div className="mt-2 flex flex-col gap-2.5 border-t border-fairway-100 pt-2.5">
          <Section title={t("swingAnalysis.address")}>{result.address}</Section>
          <Section title={t("swingAnalysis.backswing")}>{result.backswing}</Section>
          <Section title={t("swingAnalysis.topOfBackswing")}>{result.topOfBackswing}</Section>
          <Section title={t("swingAnalysis.downswing")}>{result.downswing}</Section>
          <Section title={t("swingAnalysis.impact")}>{result.impact}</Section>
          <Section title={t("swingAnalysis.followThrough")}>{result.followThrough}</Section>
        </div>
      </details>
    </div>
  );
}
