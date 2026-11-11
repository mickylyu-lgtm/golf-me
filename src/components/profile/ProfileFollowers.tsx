import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Search, Users } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useLocale } from "../../i18n/LocaleContext";
import { filterProfileFollowers } from "../../lib/profileFollowers";
import type { ProfileFollowers as FollowersResult } from "../../lib/profileFollowers";
import { Avatar } from "../ui/Avatar";
import { Modal } from "../ui/Modal";
import { inputClass } from "../ui/FormControls";

export function ProfileFollowers({ profileId }: { profileId: string }) {
  const { getFollowerCount, followingGolfers, isBlockedEitherWay } = useData();
  const { t, locale } = useLocale();
  const [count, setCount] = useState<{ id: string; value: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const unavailable = isBlockedEitherWay(profileId);
  useEffect(() => {
    let cancelled = false;
    setCount(null);
    if (unavailable) return;
    getFollowerCount(profileId).then((value) => {
      if (!cancelled) setCount({ id: profileId, value });
    }).catch(() => { /* Unknown is an em dash, never a fabricated zero. Opening the sheet offers retry. */ });
    return () => { cancelled = true; };
  }, [profileId, getFollowerCount, followingGolfers, revision, unavailable]);
  if (unavailable) return null;
  const value = count?.id === profileId ? count.value : null;
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
      className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-1 text-sm text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400">
      <strong className="font-semibold text-slate-800">{value === null ? "–" : value.toLocaleString(locale)}</strong>
      {t(value === 1 ? "followers.singular" : "followers.label")}
    </button>
    {open && <FollowersSheet key={profileId} profileId={profileId} onClose={() => { setOpen(false); setRevision((n) => n + 1); }} />}
  </>;
}

function FollowersSheet({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const { currentUser, getProfileFollowers, isBlockedEitherWay } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [result, setResult] = useState<FollowersResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mutualsOnly, setMutualsOnly] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);
    getProfileFollowers(profileId).then((data) => { if (!cancelled) setResult(data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [profileId, getProfileFollowers, attempt]);
  const mutualIds = new Set(result?.mutualIds ?? []);
  const isFollowing = (id: string) => mutualIds.has(id);
  const visible = filterProfileFollowers(result?.golfers ?? [], "", false, isFollowing, isBlockedEitherWay);
  const mutuals = visible.filter((g) => isFollowing(g.id));
  const rows = filterProfileFollowers(visible, query, mutualsOnly, isFollowing, isBlockedEitherWay);
  return <Modal title={t("followers.title")} onClose={onClose}>
    <div className="flex flex-col gap-4">
      <div className="flex rounded-xl bg-slate-100 p-1" aria-label={t("followers.title")}>
        {[false, true].map((mutual) => <button key={String(mutual)} type="button" aria-pressed={mutualsOnly === mutual}
          onClick={() => setMutualsOnly(mutual)}
          className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition ${mutualsOnly === mutual ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
          {t(mutual ? "followers.mutuals" : "followers.title")} {result && <span className="ml-1.5 text-xs text-slate-400">{mutual ? mutuals.length : result.total}</span>}
        </button>)}
      </div>
      <p className="text-xs leading-relaxed text-slate-500">{t(profileId === currentUser.id ? "followers.ownMutualsDescription" : "followers.mutualsDescription")}</p>
      <label className="relative block">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" autoComplete="off"
          aria-label={t("followers.search")} placeholder={t("followers.search")} className={`${inputClass} pl-9`} />
      </label>
      {failed ? <div role="alert" className="py-6 text-center text-sm text-slate-500">
        <p>{t("followers.loadError")}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-3 min-h-11 rounded-lg px-4 font-semibold text-fairway-700">{t("followers.retry")}</button>
      </div> : !result ? <p role="status" className="py-8 text-center text-sm text-slate-500">{t("followers.loading")}</p>
        : rows.length === 0 ? <div role="status" className="flex flex-col items-center gap-2 py-8 text-center text-sm text-slate-500">
          <Users size={24} className="text-slate-300" />
          <p>{t(query.trim() ? "followers.noResults" : mutualsOnly ? "followers.noMutuals" : "followers.empty")}</p>
        </div> : <ul className="flex flex-col gap-1">
          {rows.map((golfer) => <li key={golfer.id}>
            <button type="button" className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
              onClick={() => { onClose(); navigate(golfer.id === currentUser.id ? "/profile" : `/golfer/${golfer.id}`); }}>
              <Avatar golfer={golfer} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">{golfer.name}</span>
                {golfer.username && <span className="block truncate text-xs text-slate-500">@{golfer.username}</span>}
              </span>
              {isFollowing(golfer.id) && <span className="rounded-full bg-fairway-50 px-2 py-1 text-xs font-semibold text-fairway-700">{t("followers.mutual")}</span>}
              <ChevronRight size={16} className="shrink-0 text-slate-300" />
            </button>
          </li>)}
        </ul>}
      {result && result.total > visible.length && <p className="text-xs text-slate-400">{t("followers.visibleOnly")}</p>}
    </div>
  </Modal>;
}
