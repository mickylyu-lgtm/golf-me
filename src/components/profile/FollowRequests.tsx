import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserRoundPlus, ChevronRight } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useLocale } from "../../i18n/LocaleContext";
import { useSocialRead } from "../../lib/useSocialRead";
import { Modal } from "../ui/Modal";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";

export function FollowRequests() {
  const { currentUser } = useData();
  return <ViewerFollowRequests key={currentUser.id} />;
}
function ViewerFollowRequests() {
  const { getFollowRequests, respondToFollowRequest } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const lock = useRef(false);
  const read = useCallback(() => getFollowRequests(), [getFollowRequests]);
  const { value: requests, failed, retry } = useSocialRead(read);
  const respond = async (id: string, accept: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(id); setActionFailed(false);
    try { await respondToFollowRequest(id, accept); retry(); }
    catch { setActionFailed(true); retry(); }
    finally { lock.current = false; setBusy(null); }
  };
  return <>
    <button type="button" onClick={() => { setOpen(true); retry(); }} aria-haspopup="dialog" aria-expanded={open}
      className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700">
      <UserRoundPlus size={17} className="text-fairway-600" /><span className="flex-1">{t("socialPrivacy.requests")}</span>
      {requests && <span className="rounded-full bg-fairway-50 px-2 py-0.5 text-fairway-700">{requests.length}</span>}<ChevronRight size={16} />
    </button>
    {open && <Modal title={t("socialPrivacy.requests")} onClose={() => setOpen(false)}>
      {actionFailed && <p role="alert" className="mb-3 text-sm text-rose-600">{t("socialPrivacy.actionError")}</p>}
      {failed ? <div role="alert" className="text-sm text-slate-600"><p>{t("socialPrivacy.requestsError")}</p><Button onClick={retry} variant="outline" className="mt-3">{t("followers.retry")}</Button></div>
        : !requests ? <p role="status" className="py-6 text-sm text-slate-500">{t("socialPrivacy.requestsLoading")}</p>
        : requests.length === 0 ? <p role="status" className="py-6 text-sm text-slate-500">{t("socialPrivacy.noRequests")}</p>
        : <ul className="space-y-4">{requests.map((request) => <li key={request.id} className="rounded-xl border border-slate-100 p-3">
          <button type="button" onClick={() => { setOpen(false); navigate("/golfer/" + request.golfer.id); }} className="flex w-full min-w-0 items-center gap-3 text-left">
            <Avatar golfer={request.golfer} size="sm" /><span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{request.golfer.name}</span><ChevronRight size={15} />
          </button>
          <div className="mt-3 flex gap-2">
            <Button fullWidth size="sm" disabled={busy !== null} onClick={() => respond(request.id, true)}>{t("socialPrivacy.accept")}</Button>
            <Button fullWidth size="sm" variant="outline" disabled={busy !== null} onClick={() => respond(request.id, false)}>{t("socialPrivacy.reject")}</Button>
          </div>
        </li>)}</ul>}
    </Modal>}
  </>;
}
