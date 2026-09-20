import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import {
  ChevronRight,
  ClipboardList,
  Clock,
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
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { AvatarUpload } from "../components/profile/AvatarUpload";
import { ReputationBadge } from "../components/golfer/ReputationBadge";
import { Pill } from "../components/ui/Pill";
import { AGE_RANGES, GENDER_OPTIONS } from "../types";
import type { AgeRange } from "../types";
import { memberSinceLabel } from "../lib/format";
import { useCredibilityStats } from "../lib/useCredibility";
import { tierDisplayName } from "../lib/reputationTiers";
import { useReputationState } from "../lib/useReputationState";
import { formatHandicapNumber, handicapColorClass } from "../lib/handicapColor";
import { useRoles } from "../lib/useRoles";

function ProfileRow({ icon, label, value, onClick }: { icon: ReactNode; label: string; value?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {value && <span className="block truncate text-xs text-slate-500">{value}</span>}
      </span>
      <ChevronRight size={16} className="shrink-0 text-slate-300" />
    </button>
  );
}

function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">{title}</h2>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

export function Profile() {
  const { currentUser, updateCurrentUserProfile, circleGolfers, followingGolfers, posts } = useData();
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
      gender: g.gender,
      customGender: !(GENDER_OPTIONS as readonly string[]).includes(g.gender),
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
      gender: form.gender,
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
  const { state: reputationState } = useReputationState(currentUser);

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
          {/* Was plain gray text -- reads as a stray line, not really part
              of the identity block. A badge (same pattern as the
              reputation tag below it) makes it read as one deliberate
              piece of profile metadata, not leftover text. Plain text, not
              HighlightGolfMe -- this metadata is intentionally one neutral
              color throughout; the logo elsewhere already carries brand
              emphasis, this line shouldn't compete with the name/rounds/
              reputation above and beside it. */}
          <Badge tone="slate" icon={<Clock size={11} />} className="mt-1">
            {memberSinceLabel(currentUser.memberSince, t)}
          </Badge>
        </div>
        <Button size="sm" variant="outline" onClick={startEditing}>
          {t("common.edit")}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <p className="text-sm text-slate-600">
          {/* Only the handicap NUMBER is colored (golf-ability signal,
              deliberately separate from the GolfMe Reputation badge right
              next to it) -- "Handicap"/round-count text stays neutral. */}
          {enrichedUser.reputation.completedRounds === 1
            ? t("profile.roundCountSingularPrefix")
            : t("profile.roundCountPrefix", { count: enrichedUser.reputation.completedRounds })}
          <span className={handicapColorClass(currentUser.handicap)}>{formatHandicapNumber(currentUser.handicap)}</span>
        </p>
        <ReputationBadge tier={reputationState?.tierKey ?? null} size="sm" onClick={() => navigate("/profile/reputation")} />
        {isCoachReviewer && (
          <Badge tone="fairway" icon={<ShieldCheck size={12} />}>
            Coach Reviewer
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <ProfileSection title={t("profile.sectionGolf")}>
          <ProfileRow icon={<ClipboardList size={16} />} label={t("profile.myGolf")} onClick={() => navigate("/my-rounds")} />
          <ProfileRow icon={<SlidersHorizontal size={16} />} label={t("profile.matchPreferences")} onClick={() => navigate("/profile/preferences")} />
        </ProfileSection>

        <ProfileSection title={t("profile.sectionSocial")}>
          <ProfileRow
            icon={<Users size={16} />}
            label={t("profile.reputation")}
            value={reputationState ? tierDisplayName(reputationState.tierKey, t) : undefined}
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
        </ProfileSection>

        <ProfileSection title={t("profile.sectionAccount")}>
          <ProfileRow icon={<SettingsIcon size={16} />} label={t("profile.settings")} onClick={() => navigate("/settings")} />
        </ProfileSection>

        {(isCoachReviewer || isAdmin) && (
          <ProfileSection title={t("profile.sectionAdmin")}>
            {isCoachReviewer && <ProfileRow icon={<ShieldCheck size={16} />} label="Coach Review Queue" onClick={() => navigate("/coach-reviews")} />}
            {isAdmin && (
              <>
                <ProfileRow icon={<ShieldCheck size={16} />} label="Coach Reviewers" onClick={() => navigate("/admin/coach-reviewers")} />
                <ProfileRow icon={<LayoutDashboard size={16} />} label="Platform Dashboard" onClick={() => navigate("/admin/dashboard")} />
              </>
            )}
          </ProfileSection>
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
            <div>
              <label className={labelClass}>{t("profileSetup.genderOptional")}</label>
              <div className="flex flex-wrap gap-1.5">
                {GENDER_OPTIONS.map((g) => (
                  <Pill
                    key={g}
                    active={!form.customGender && form.gender === g}
                    onClick={() => setForm((f) => ({ ...f, gender: g, customGender: false }))}
                  >
                    {g}
                  </Pill>
                ))}
                <Pill active={form.customGender} onClick={() => setForm((f) => ({ ...f, customGender: true }))}>
                  {t("host.custom")}
                </Pill>
              </div>
              {form.customGender && (
                <input
                  className={`${inputClass} mt-2`}
                  value={form.gender}
                  onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                  placeholder={t("profileSetup.genderCustomPlaceholder")}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{t("profile.ageRange")}</label>
                <select
                  className={inputClass}
                  value={form.ageRange ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, ageRange: e.target.value ? (e.target.value as AgeRange) : undefined }))}
                >
                  <option value="">{t("profile.ageRangeNotSet")}</option>
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
