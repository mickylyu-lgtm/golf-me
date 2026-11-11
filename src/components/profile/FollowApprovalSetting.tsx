import { useCallback, useRef, useState } from "react";
import { useData } from "../../context/DataContext";
import { useLocale } from "../../i18n/LocaleContext";
import { useSocialRead } from "../../lib/useSocialRead";
import { Toggle } from "../ui/Toggle";
import { Button } from "../ui/Button";

export function FollowApprovalSetting() {
  const { currentUser } = useData();
  return <ViewerFollowApprovalSetting key={currentUser.id} />;
}
function ViewerFollowApprovalSetting() {
  const { currentUser, getFollowState, setAccountPrivate } = useData();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const lock = useRef(false);
  const read = useCallback(() => getFollowState(currentUser.id), [getFollowState, currentUser.id]);
  const { value, failed, retry } = useSocialRead(read);
  return <div className="border-b border-slate-100 pb-4">
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{t("socialPrivacy.title")}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{t("socialPrivacy.description")}</p></div>
      {value && <Toggle checked={value.isPrivate} label={t("socialPrivacy.title")} disabled={busy} onChange={async (next) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setSaveFailed(false);
        try { await setAccountPrivate(next); retry(); }
        catch { setSaveFailed(true); retry(); }
        finally { lock.current = false; setBusy(false); }
      }} />}
    </div>
    <p className="mt-2 text-xs leading-relaxed text-slate-500">{t("socialPrivacy.existing")}</p>
    {busy ? <p role="status" className="mt-2 text-xs text-slate-500">{t("socialPrivacy.saving")}</p>
      : failed ? <div role="alert" className="mt-2 text-xs text-slate-600"><p>{t("socialPrivacy.loadError")}</p><Button variant="outline" size="sm" onClick={retry}>{t("followers.retry")}</Button></div>
      : !value ? <p role="status" className="mt-2 text-xs text-slate-500">{t("socialPrivacy.loading")}</p> : null}
    {saveFailed && <p role="alert" className="mt-2 text-xs text-rose-600">{t("socialPrivacy.saveError")}</p>}
  </div>;
}
