import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, LockKeyhole, Search, Users } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useLocale } from "../../i18n/LocaleContext";
import { useSocialRead } from "../../lib/useSocialRead";
import type { ConnectionKind } from "../../lib/socialPrivacy";
import type { GolferProfile } from "../../types";
import { Avatar } from "../ui/Avatar";
import { Modal } from "../ui/Modal";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { inputClass } from "../ui/FormControls";

export function ProfileFollowers({ profileId, layout = "inline" }: { profileId: string; layout?: "inline" | "stat" }) {
  const { currentUser, getConnectionSummary, isFollowing, isBlockedEitherWay } = useData();
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const blocked = isBlockedEitherWay(profileId);
  const permitted = !blocked && (currentUser.id === profileId || isFollowing(profileId));
  const read = useCallback(() => getConnectionSummary(profileId, "followers"), [getConnectionSummary, profileId]);
  const { value, retry } = useSocialRead(read, permitted);
  if (blocked) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
      className={layout === "stat"
        ? "flex min-h-20 w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-center transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
        : "-my-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-1 text-sm text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"}>
      {permitted ? <strong className={layout === "stat" ? "text-xl font-bold leading-tight tabular-nums text-slate-900" : "font-semibold text-slate-800"}>{value === undefined ? "–" : value.total.toLocaleString(locale)}</strong>
        : layout === "stat" ? <LockKeyhole size={20} aria-hidden="true" className="text-slate-400" /> : null}
      <span className={layout === "stat" ? "max-w-full break-words text-xs leading-snug text-slate-500" : undefined}>{t(value?.total === 1 ? "followers.singular" : "followers.label")}</span>
    </button>
    {open && <FollowersSheet key={currentUser.id + ":" + profileId} profileId={profileId} onClose={() => { setOpen(false); retry(); }} />}
  </>;
}

export function ProfileMutualSummary({ profileId, name }: { profileId: string; name: string }) {
  const { currentUser, getConnectionSummary, isFollowing, isBlockedEitherWay } = useData();
  const { t, locale } = useLocale();
  const permitted = currentUser.id !== profileId && isFollowing(profileId) && !isBlockedEitherWay(profileId);
  const read = useCallback(() => getConnectionSummary(profileId, "followers"), [getConnectionSummary, profileId]);
  const { value } = useSocialRead(read, permitted);
  if (!permitted || value === undefined) return null;
  return <div className="my-1 max-w-sm rounded-xl bg-fairway-50/70 px-3 py-2 text-center" data-testid="mutual-summary">
    <p className="text-sm font-medium text-fairway-800">{t(value.mutualTotal === 1 ? "followers.mutualSummaryOne" : "followers.mutualSummary", { count: value.mutualTotal.toLocaleString(locale), name })}</p>
    <p className="mt-1 text-[11px] leading-snug text-slate-500">{t("followers.mutualSummaryHelp")}</p>
  </div>;
}

function FollowersSheet({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const { currentUser, getProfileConnections, getConnectionSummary, isFollowing, isBlockedEitherWay, removeFollower } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [kind, setKind] = useState<ConnectionKind>("followers");
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<GolferProfile | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  const writeRef = useRef(false);
  const own = currentUser.id === profileId;
  const permitted = !isBlockedEitherWay(profileId) && (own || isFollowing(profileId));
  const read = useCallback(() => getProfileConnections(profileId, kind), [getProfileConnections, profileId, kind]);
  const readTotals = useCallback(() => Promise.all([getConnectionSummary(profileId, "followers"), getConnectionSummary(profileId, "following")]), [getConnectionSummary, profileId]);
  const { value: result, failed, retry } = useSocialRead(read, permitted);
  const { value: totals, retry: retryTotals } = useSocialRead(readTotals, permitted);
  const search = query.trim().replace(/^@/, "").toLocaleLowerCase();
  const rows = (result?.golfers ?? []).filter((g) => !isBlockedEitherWay(g.id) && (!search || (g.name + " " + (g.username ?? "")).toLocaleLowerCase().includes(search)));
  return <Modal title={t("followers.connectionsTitle")} onClose={onClose}>
    <div className="flex flex-col gap-4">
      <div className="flex rounded-xl bg-slate-100 p-1" aria-label={t("followers.connectionsTitle")}>
        {(["followers", "following"] as const).map((tab, i) => <button key={tab} type="button" aria-pressed={kind === tab}
          onClick={() => { setKind(tab); setQuery(""); setRemoveFailed(false); }}
          className={"min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition " + (kind === tab ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
          {t(tab === "followers" ? "followers.title" : "followers.following")} {totals && <span className="ml-1.5 text-xs text-slate-400">{totals[i].total}</span>}
        </button>)}
      </div>
      {!permitted ? <p role="status" className="py-6 text-center text-sm text-slate-500">{t(isBlockedEitherWay(profileId) ? "followers.loadError" : "followers.private")}</p> : <>
        <label className="relative block">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" autoComplete="off"
            aria-label={t("followers.searchConnections")} placeholder={t("followers.searchConnections")} className={inputClass + " pl-9"} />
        </label>
        {removeFailed && <p role="alert" className="text-sm text-rose-600">{t("followers.removeFailed")}</p>}
        {failed ? <div role="alert" className="py-6 text-center text-sm text-slate-500">
          <p>{t("followers.loadError")}</p>
          <button type="button" onClick={() => { retry(); retryTotals(); }} className="mt-3 min-h-11 rounded-lg px-4 font-semibold text-fairway-700">{t("followers.retry")}</button>
        </div> : !result ? <p role="status" className="py-8 text-center text-sm text-slate-500">{t("followers.loading")}</p>
          : rows.length === 0 ? <div role="status" className="flex flex-col items-center gap-2 py-8 text-center text-sm text-slate-500">
            <Users size={24} className="text-slate-300" />
            <p>{t(search ? "followers.noConnectionsMatch" : kind === "following" ? "followers.noFollowing" : "followers.empty")}</p>
          </div> : <ul className="flex flex-col gap-1">
            {rows.map((golfer) => <li key={golfer.id} className="flex items-center gap-2">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-2 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
                onClick={() => { onClose(); navigate(golfer.id === currentUser.id ? "/profile" : "/golfer/" + golfer.id); }}>
                <Avatar golfer={golfer} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">{golfer.name}</span>
                  {golfer.username && <span className="block truncate text-xs text-slate-500">@{golfer.username}</span>}
                </span>
                <ChevronRight size={16} className="shrink-0 text-slate-300" />
              </button>
              {own && kind === "followers" && <button type="button" aria-label={t("followers.removeLabel", { name: golfer.name })}
                onClick={() => { setRemoving(golfer); setRemoveFailed(false); }}
                className="min-h-11 shrink-0 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600">{t("followers.remove")}</button>}
            </li>)}
          </ul>}
        {result && <p className="text-xs text-slate-400">{t("followers.visibleOnly")}</p>}
      </>}
    </div>
    {removing && permitted && <ConfirmDialog title={t("followers.removeConfirm", { name: removing.name })} message={t("followers.removeExplanation")}
      confirmLabel={t("followers.remove")} onCancel={() => setRemoving(null)} onConfirm={async () => {
        if (writeRef.current) return;
        writeRef.current = true;
        try { await removeFollower(removing.id); setRemoving(null); retry(); retryTotals(); }
        catch { setRemoving(null); setRemoveFailed(true); retry(); retryTotals(); }
        finally { writeRef.current = false; }
      }} />}
  </Modal>;
}
