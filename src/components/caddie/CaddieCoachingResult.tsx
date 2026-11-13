import { useCallback, useRef, useState } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import { coachingPriority } from "../../lib/coachReplay";
import type { CoachText } from "../../lib/coachReplay";
import { CaddieSwingReplay } from "./CaddieSwingReplay";
import type { CaddieSwingReplayProps } from "./CaddieSwingReplay";

// Stored coaching remains separate from pose findings. Neither a shared
// checkpoint nor a similar sentence proves that a cue/drill fixes a fault.
export function CaddieCoachingResult(props: Omit<CaddieSwingReplayProps, "sourceMediaUrl"> & { sourceMediaUrl?: string }) {
  const { t } = useLocale();
  const priority = coachingPriority(props.coaching, props.phases);
  const focusRef = useRef<HTMLDivElement>(null);
  const [inspection, setInspection] = useState<{ timeSeconds: number; source: string } | undefined>();
  const [confirmed, setConfirmed] = useState<{ request: typeof inspection; mediaUrl: string | undefined }>();
  const [mediaUrl, setMediaUrl] = useState(props.sourceMediaUrl);
  if (mediaUrl !== props.sourceMediaUrl) {
    setMediaUrl(props.sourceMediaUrl);
    setConfirmed(undefined);
  }
  const inspectionReady = confirmed?.request === inspection && confirmed?.mediaUrl === props.sourceMediaUrl;
  const inspectionConfirmed = useCallback(() => setConfirmed({ request: inspection, mediaUrl: props.sourceMediaUrl }), [inspection, props.sourceMediaUrl]);
  const [inspectionFailed, setInspectionFailed] = useState(false);
  const inspectionUnavailable = useCallback(() => { setInspection(undefined); setInspectionFailed(true); }, []);
  const activeInspection = inspection?.source === priority?.claim.source && inspection?.timeSeconds === priority?.moment?.timeSeconds ? inspection : undefined;
  const text = (value: CoachText) => value.kind === "stored" ? value.text : t(value.key);
  const drill = props.coaching?.drill;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {props.score && <p className="text-3xl font-bold text-brand-forest">{t("caddie.scoreOutOf100", { score: props.score.total })}</p>}
      {priority && (
        <div ref={focusRef} tabIndex={-1} className="rounded-2xl border border-fairway-200 bg-fairway-50/60 p-4" data-testid="caddie-work-on-next">
          <h2 className="text-xs font-bold uppercase tracking-wide text-brand-forest">{t("caddie.fixFirst")}</h2>
          {priority.claim.title && <p className="mt-2 break-words text-base font-bold text-slate-900">{text(priority.claim.title)}</p>}
          <p className="mt-1 break-words text-sm text-slate-700">{text(priority.claim.body)}</p>
          {priority.moment && props.sourceMediaUrl && (
            <button type="button" className="mt-3 min-h-11 rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white" onClick={() => { setInspectionFailed(false); setConfirmed(undefined); setInspection({ timeSeconds: priority.moment!.timeSeconds, source: priority.claim.source }); }}>
              {t("caddie.inspectMoment")}{priority.moment.approximate ? ` · ${t("coachReplay.approximate")}` : ""}
            </button>
          )}
        </div>
      )}
      {drill?.name?.trim() && (
        <div className="rounded-2xl border border-fairway-100 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fairway-700">{t("caddie.drill")}</h2>
          <p className="mt-1 break-words text-sm font-semibold text-slate-900">{drill.name}</p>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-slate-600">
            {drill.steps.map((step, i) => <li key={i} className="break-words">{step}</li>)}
          </ol>
        </div>
      )}
      {activeInspection && !inspectionReady && <p role="status" className="text-sm text-slate-600">{t("caddie.openingMoment")}</p>}
      {inspectionFailed && <p role="status" className="text-sm text-slate-600">{t("caddie.momentUnavailable")}</p>}
      {props.sourceMediaUrl && <CaddieSwingReplay {...props} sourceMediaUrl={props.sourceMediaUrl} inspectMoment={activeInspection} onInspectionUnavailable={inspectionUnavailable} onInspectionReady={inspectionConfirmed} />}
      {activeInspection && inspectionReady && (
        <button type="button" className="min-h-11 self-start rounded-full border border-fairway-200 px-4 py-2 text-sm font-semibold text-brand-forest" onClick={() => {
          setInspection(undefined);
          focusRef.current?.focus();
          focusRef.current?.scrollIntoView({ block: "center" });
        }}>{t("caddie.backToFocus")}</button>
      )}
    </div>
  );
}
