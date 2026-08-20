import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import {
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  MessageSquareText,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  UserRoundPlus,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { AvatarUpload } from "../components/profile/AvatarUpload";
import { HighlightGolfMe } from "../components/brand/HighlightGolfMe";
import { CredibilityBadge } from "../components/golfer/CredibilityBadge";
import { AGE_RANGES } from "../types";
import type { AgeRange } from "../types";
import { memberSinceLabel } from "../lib/format";
import { computeCredibility, credibilityLabel } from "../lib/credibility";
import { useCredibilityStats } from "../lib/useCredibility";
import { useRoles } from "../lib/useRoles";

function ProfileRow({ icon, label, value, onClick }: { icon: ReactNode; label: string; value?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {value && <span className="block truncate text-xs text-slate-500">{value}</span>}
      </span>
      <ChevronRight size={16} className="shrink-0 text-slate-300" />
    </button>
  );
}

export function Profile() {
  const { currentUser, updateCurrentUserProfile, circleGolfers, reviewsAbout, followingGolfers, posts } = useData();
  const { isDemo, saveProfile } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const { isCoachReviewer, isAdmin } = useRoles();
  const myPostCount = posts.filter((p) => p.authorId === currentUser.id).length;

  const [editing, setEditing] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);

  function buildForm(g: typeof currentUser) {
    return {
      ageRange: g.ageRange,
      handicap: g.handicap,
      favoriteCourses: g.favoriteCourses.join(", "),
      bio: g.bio,
      username: g.username ?? "",
    };
  }

  const [form, setForm] = useState(() => buildForm(currentUser));

  function startEditing() {
    setForm(buildForm(currentUser));
    setEditing(true);
  }

  const USERNAME_FORMAT = /^[a-zA-Z0-9_.]{3,30}$/;

  async function save() {
    // Username has its own real-backend uniqueness constraint (see
    // profiles_username_unique_idx) that the generic updateCurrentUserProfile
    // path can't surface an error for — it's fire-and-forget by design for
    // every other field. Saved separately here, through AuthContext's
    // saveProfile directly, which does propagate real Postgres errors.
    if (!isDemo) {
      const trimmed = form.username.trim();
      const currentUsername = currentUser.username ?? "";
      if (trimmed !== currentUsername) {
        if (trimmed && !USERNAME_FORMAT.test(trimmed)) {
          showToast(t("username.invalidError"), "warning");
          return;
        }
        setSavingUsername(true);
        try {
          await saveProfile({ username: trimmed || null });
        } catch (err) {
          setSavingUsername(false);
          const msg = err instanceof Error ? err.message : "";
          if (msg.includes("profiles_username_unique_idx")) showToast(t("username.takenError"), "warning");
          else if (msg.includes("profiles_username_format")) showToast(t("username.invalidError"), "warning");
          else showToast(t("username.saveFailedError"), "warning");
          return;
        }
        setSavingUsername(false);
      }
    }

    updateCurrentUserProfile({
      ageRange: form.ageRange,
      handicap: form.handicap,
      favoriteCourses: form.favoriteCourses
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      bio: form.bio,
    });
    setEditing(false);
    showToast(t("profile.profileUpdated"), "success");
  }

  // Real accounts: real, live, never-fabricated reputation from
  // get_credibility_stats() — a brand-new account naturally gets real zeros
  // here, which reads as "Building Credibility," not a special case.
  const { reputation: realReputation } = useCredibilityStats(currentUser.id, currentUser.reputation);
  const enrichedUser = { ...currentUser, reputation: realReputation };
  const myReviews = reviewsAbout(currentUser.id);
  const credibility = computeCredibility(enrichedUser, myReviews);

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setAvatarModalOpen(true)}
          aria-label={t("profile.changePhoto")}
          className="rounded-full transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <Avatar golfer={currentUser} size="lg" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-slate-900">{currentUser.name}</h1>
          <p className="text-sm text-slate-500">
            <HighlightGolfMe text={memberSinceLabel(currentUser.memberSince, t)} />
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={startEditing}>
          {t("common.edit")}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <p className="text-sm text-slate-600">
          {enrichedUser.reputation.completedRounds === 1
            ? t("profile.roundCountSingular", { handicap: currentUser.handicap ?? "--" })
            : t("profile.roundCount", { count: enrichedUser.reputation.completedRounds, handicap: currentUser.handicap ?? "--" })}
        </p>
        <CredibilityBadge tier={credibility.tier} size="sm" />
        {isCoachReviewer && (
          <Badge tone="fairway" icon={<ShieldCheck size={12} />}>
            Coach Reviewer
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <ProfileRow icon={<ClipboardList size={16} />} label={t("profile.myGolf")} onClick={() => navigate("/my-rounds")} />
        <ProfileRow
          icon={<Users size={16} />}
          label={t("profile.reputation")}
          value={credibilityLabel(credibility.tier, t)}
          onClick={() => navigate("/profile/reputation")}
        />
        <ProfileRow
          icon={<Users size={16} />}
          label={t("profile.golfCircle")}
          value={circleGolfers.length === 1 ? t("profile.golferCountSingular") : t("profile.golferCount", { count: circleGolfers.length })}
          onClick={() => navigate("/profile/circle")}
        />
        <ProfileRow
          icon={<UserRoundPlus size={16} />}
          label={t("profile.following")}
          value={`${followingGolfers.length}`}
          onClick={() => navigate("/profile/following")}
        />
        <ProfileRow
          icon={<MessageSquareText size={16} />}
          label={t("profile.myPosts")}
          value={myPostCount === 1 ? t("profile.postCountSingular") : t("profile.postCount", { count: myPostCount })}
          onClick={() => navigate("/profile/posts")}
        />
        <ProfileRow icon={<SlidersHorizontal size={16} />} label={t("profile.matchPreferences")} onClick={() => navigate("/profile/preferences")} />
        <ProfileRow icon={<SettingsIcon size={16} />} label={t("profile.settings")} onClick={() => navigate("/settings")} />
        {isCoachReviewer && <ProfileRow icon={<ShieldCheck size={16} />} label="Coach Review Queue" onClick={() => navigate("/coach-reviews")} />}
        {isAdmin && (
          <>
            <ProfileRow icon={<ShieldCheck size={16} />} label="Coach Reviewers" onClick={() => navigate("/admin/coach-reviewers")} />
            <ProfileRow icon={<LayoutDashboard size={16} />} label="Platform Dashboard" onClick={() => navigate("/admin/dashboard")} />
          </>
        )}
      </div>

      {avatarModalOpen && (
        <Modal title={t("profile.profilePhoto")} onClose={() => setAvatarModalOpen(false)}>
          <AvatarUpload golfer={currentUser} size="xl" onChange={(photoUrl) => updateCurrentUserProfile({ photoUrl })} />
          <Button className="mt-5" fullWidth onClick={() => setAvatarModalOpen(false)}>
            {t("common.done")}
          </Button>
        </Modal>
      )}

      {editing && (
        <Modal
          title={t("profile.editProfile")}
          onClose={() => setEditing(false)}
          footer={
            <div className="flex gap-3">
              <Button variant="outline" fullWidth onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
              <Button fullWidth onClick={save} disabled={savingUsername}>
                {t("common.save")}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            {!isDemo && (
              <div>
                <label className={labelClass}>{currentUser.username ? t("username.label") : t("username.chooseYours")}</label>
                <input
                  className={inputClass}
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.replace(/\s/g, "") }))}
                  placeholder={t("username.placeholder")}
                  maxLength={30}
                />
                <p className="mt-1 text-xs text-slate-400">{t("username.help")}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{t("profile.ageRange")}</label>
                <select className={inputClass} value={form.ageRange} onChange={(e) => setForm((f) => ({ ...f, ageRange: e.target.value as AgeRange }))}>
                  {AGE_RANGES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>{t("profile.handicap")}</label>
                <input
                  type="number"
                  className={inputClass}
                  value={form.handicap ?? ""}
                  placeholder={t("profile.noHandicapYet")}
                  onChange={(e) => setForm((f) => ({ ...f, handicap: e.target.value === "" ? null : Number(e.target.value) }))}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>{t("profile.favoriteCourses")}</label>
              <input
                className={inputClass}
                value={form.favoriteCourses}
                onChange={(e) => setForm((f) => ({ ...f, favoriteCourses: e.target.value }))}
                placeholder={t("profile.commaSeparated")}
              />
            </div>
            <div>
              <label className={labelClass}>{t("profile.bio")}</label>
              <textarea className={inputClass} rows={3} value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} />
            </div>
            <p className="-mt-1 text-xs text-slate-400">{t("profile.livesUnderMatchPreferences")}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
