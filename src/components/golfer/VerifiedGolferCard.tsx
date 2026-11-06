import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Camera, Check, Flag, Lock, MailCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import type { VerifiedGolferChecklist } from "../../lib/verifiedGolfer";
import { AddPhotoButton } from "../profile/AddPhotoButton";
import { VerifiedMedallion } from "./VerifiedMedallion";

const ACTION =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-fairway-300 bg-white px-3 py-1.5 text-xs font-semibold text-fairway-700 transition-colors duration-200 hover:bg-fairway-50 active:bg-fairway-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 disabled:opacity-50";

// One-time shine: the first time this device shows a golfer their earned badge.
function useFirstEarnedShine(userId: string, earned: boolean): boolean {
  const [shine, setShine] = useState(false);
  useEffect(() => {
    if (!earned) return;
    const key = `golfme:verified-shine-seen:${userId}`;
    let seen = false;
    try {
      seen = localStorage.getItem(key) === "1";
      if (!seen) localStorage.setItem(key, "1");
    } catch {
      seen = false;
    }
    if (!seen) setShine(true);
  }, [userId, earned]);
  return shine;
}

export function VerifiedGolferCard({
  userId,
  checklist,
  onPhotoAdded,
  confirmEmail,
}: {
  userId: string;
  checklist: VerifiedGolferChecklist;
  onPhotoAdded: (photoUrl: string) => void | Promise<unknown>;
  // Null when this account has no way to confirm from here.
  confirmEmail: { onClick: () => void; busy: boolean } | null;
}) {
  const { t } = useLocale();
  const earned = checklist.verified;
  const shine = useFirstEarnedShine(userId, earned);
  const total = 3;
  const done = [checklist.identityConfirmed, checklist.hasPhoto, checklist.hasQualifyingRound].filter(Boolean).length;

  const steps: { key: string; icon: LucideIcon; label: string; short: string; done: boolean; action: ReactNode }[] = [
    {
      key: "identity",
      icon: MailCheck,
      label: t("reputation.verifiedCheck.identity"),
      short: t("reputation.verified.short.identity"),
      done: checklist.identityConfirmed,
      action: confirmEmail ? (
        <button type="button" className={ACTION} disabled={confirmEmail.busy} onClick={confirmEmail.onClick}>
          {confirmEmail.busy ? t("reputation.resending") : t("reputation.verified.confirmEmail")}
        </button>
      ) : null,
    },
    {
      key: "photo",
      icon: Camera,
      label: t("reputation.verifiedCheck.photo"),
      short: t("reputation.verified.short.photo"),
      done: checklist.hasPhoto,
      action: (
        <AddPhotoButton className={ACTION} onChange={onPhotoAdded}>
          {t("reputation.verified.addPhoto")}
        </AddPhotoButton>
      ),
    },
    {
      key: "round",
      icon: Flag,
      label: t("reputation.verifiedCheck.round"),
      short: t("reputation.verified.short.round"),
      done: checklist.hasQualifyingRound,
      action: (
        <Link to="/find?tab=rounds" className={ACTION}>
          {t("reputation.verified.findRound")}
        </Link>
      ),
    },
  ];

  return (
    <section data-testid="verified-golfer-card" data-earned={earned ? "true" : "false"} aria-labelledby="verified-golfer-title">
      <div className="flex items-center gap-4">
        <VerifiedMedallion done={done} total={total} earned={earned} shine={shine} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="verified-golfer-title" className="text-base font-bold text-slate-900">
              {t("reputation.verified.title")}
            </h2>
            {!earned && (
              <span aria-hidden="true" className="shrink-0 text-xs font-semibold tabular-nums text-fairway-700">
                {t("reputation.verified.progress", { done, total })}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-snug text-slate-500">{earned ? t("reputation.verified.earnedLine") : t("reputation.verified.pitch")}</p>
          <p className="sr-only">{t("reputation.verified.progressSr", { done, total })}</p>
        </div>
      </div>

      {earned ? (
        <ul aria-label={t("reputation.verified.stepsLabel")} className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-3.5">
          {steps.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600" data-check={s.key} data-done="true">
              <Check size={13} strokeWidth={2.75} className="text-fairway-600" aria-hidden="true" />
              {s.short}
              <span className="sr-only">
                {" "}
                {t("reputation.verifiedCheck.done")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul aria-label={t("reputation.verified.stepsLabel")} className="mt-5 flex flex-col gap-3.5">
          {steps.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.key} className="flex items-center gap-3" data-check={s.key} data-done={s.done ? "true" : "false"}>
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${s.done ? "bg-fairway-50 text-fairway-600" : "bg-slate-50 text-slate-500"}`}
                >
                  <Icon size={17} strokeWidth={2} />
                </span>
                <span className={`min-w-0 flex-1 text-sm leading-snug ${s.done ? "text-slate-500" : "font-medium text-slate-800"}`}>
                  {s.label}
                  <span className="sr-only">
                    {", "}
                    {s.done ? t("reputation.verifiedCheck.done") : t("reputation.verifiedCheck.notYet")}
                  </span>
                </span>
                {s.done ? (
                  <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fairway-600 text-fixed-white">
                    <Check size={14} strokeWidth={3} />
                  </span>
                ) : (
                  (s.action ?? <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-full border-2 border-slate-200" />)
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-5 flex items-start gap-1.5 text-[11px] leading-snug text-slate-400">
        <Lock size={11} className="mt-px shrink-0" aria-hidden="true" />
        {t("reputation.verified.privacyNote")}
      </p>
    </section>
  );
}
