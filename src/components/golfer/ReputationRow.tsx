import type { ReactNode } from "react";
import type { GolferProfile } from "../../types";
import { isNewAccount, memberSinceLabel } from "../../lib/format";
import { useLocale } from "../../i18n/LocaleContext";
import { ProfileStatCell, ProfileStatTile } from "../profile/ProfileStatTile";

interface ReputationRowProps {
  golfer: GolferProfile;
  compact?: boolean;
  followerStat?: ReactNode;
}

export function ReputationRow({ golfer, compact, followerStat }: ReputationRowProps) {
  const { t, locale } = useLocale();
  const isNew = isNewAccount(golfer.reputation.completedRounds);

  if (!compact) {
    const membership = memberSinceLabel(golfer.memberSince, t, locale);
    return <div>
      {isNew && <p className="mb-2 text-xs font-medium text-slate-500">{t("member.new")}</p>}
      <div data-testid="profile-stats-grid" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ProfileStatTile value={golfer.reputation.completedRounds.toLocaleString(locale)} label={t("profileStats.completedRounds")} />
        {followerStat && <ProfileStatCell>{followerStat}</ProfileStatCell>}
        {!isNew && <>
          <ProfileStatTile value={golfer.reputation.wouldPlayAgainPct + "%"} label={t("profileStats.wouldPlayAgain")} />
          <ProfileStatTile value={golfer.reputation.showUpRatePct + "%"} label={t("profileStats.showUpRate")} />
          <ProfileStatTile value={golfer.reputation.onTimePct + "%"} label={t("profileStats.onTime")} />
          {membership && <ProfileStatTile value={membership} label={t("profileStats.membership")} valueClassName="text-sm leading-snug" />}
        </>}
      </div>
    </div>;
  }

  if (isNew) {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 font-medium text-slate-500 ${compact ? "text-xs" : "text-sm"}`}>
        <span>New Golfer · {golfer.reputation.completedRounds} Completed Round{golfer.reputation.completedRounds === 1 ? "" : "s"}</span>
        {followerStat && <><span aria-hidden="true" className="text-slate-300">·</span>{followerStat}</>}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 ${compact ? "text-xs" : "text-sm"}`}>
      <span>
        <strong className="font-semibold text-slate-800">{golfer.reputation.completedRounds}</strong> rounds
      </span>
      {followerStat && <><span aria-hidden="true" className="text-slate-300">·</span>{followerStat}</>}
      <span className="text-slate-300">·</span>
      <span>
        <strong className="font-semibold text-slate-800">{golfer.reputation.wouldPlayAgainPct}%</strong> would play again
      </span>
      <span className="text-slate-300">·</span>
      <span>
        <strong className="font-semibold text-slate-800">{golfer.reputation.showUpRatePct}%</strong> show-up rate
      </span>
      {!compact && (
        <>
          <span className="text-slate-300">·</span>
          <span>
            <strong className="font-semibold text-slate-800">{golfer.reputation.onTimePct}%</strong> on-time
          </span>
        </>
      )}
      {!compact && (
        <>
          <span className="text-slate-300">·</span>
          <span>{memberSinceLabel(golfer.memberSince, t, locale)}</span>
        </>
      )}
    </div>
  );
}
