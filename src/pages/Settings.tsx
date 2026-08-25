import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Bell, ChevronRight, CircleHelp, Compass, Globe, Info, Lock, LogOut, MapPin, RotateCcw, ShieldCheck, ShieldOff, Sparkles, User, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useTutorial } from "../context/TutorialContext";
import { useToast } from "../context/ToastContext";
import { useLocale, LOCALES } from "../i18n/LocaleContext";
import { supabase } from "../lib/supabase";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Toggle } from "../components/ui/Toggle";
import { ProfileSwitcher } from "../components/layout/ProfileSwitcher";
import { AddToHomeScreenPrompt } from "../components/layout/AddToHomeScreenPrompt";
import { clearOnboardingDraft } from "../lib/onboardingDraft";

export function Settings() {
  const { currentUser, golfers, blockedIds, getGolfer, unblockUser, logOut, resetDemoData } = useData();
  const { isDemo } = useAuth();
  const { showToast } = useToast();
  const { locale, t } = useLocale();
  const navigate = useNavigate();
  const { start: startTutorial } = useTutorial();

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [profileDiscoverable, setProfileDiscoverable] = useState(true);

  async function handleDeleteAccount() {
    setDeletingAccount(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", { method: "POST" });
      if (error || (data as { error?: string } | null)?.error) {
        throw new Error((data as { error?: string } | null)?.error ?? error?.message ?? "Account deletion failed.");
      }
      // The account (and its session) no longer exists server-side — clear
      // local state and land back on Welcome, same destination as a normal
      // logout, not a special "your account is gone" screen.
      await supabase.auth.signOut();
      setDeleteConfirmOpen(false);
      navigate("/welcome");
      showToast(t("settings.accountDeletedToast"), "info");
    } catch (err) {
      setDeletingAccount(false);
      showToast(err instanceof Error ? err.message : t("settings.accountDeleteFailedToast"), "warning");
    }
  }

  const blockedGolfers = blockedIds.map((id) => getGolfer(id)).filter((g): g is NonNullable<typeof g> => Boolean(g));
  const currentLanguageName = LOCALES.find((l) => l.value === locale)?.nativeName ?? "English";

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("settings.title")}</h1>
        <p className="text-sm text-slate-500">{t("settings.subtitle")}</p>
      </div>

      <section className="flex flex-col gap-3">
        <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">{t("settings.account")}</p>
        <button
          onClick={() => navigate("/profile")}
          className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <Avatar golfer={currentUser} size="md" />
          <div className="flex-1">
            <p className="font-semibold text-slate-800">{currentUser.name}</p>
            <p className="text-xs text-slate-500">{t("settings.editProfile")}</p>
          </div>
          <User size={16} className="text-slate-400" />
        </button>

        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("settings.notifications")}</p>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Bell size={16} className="text-slate-400" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">{t("settings.pushNotifications")}</p>
                <p className="text-xs text-slate-500">{t("settings.pushNotificationsDesc")}</p>
              </div>
              <Toggle checked={pushEnabled} onChange={setPushEnabled} label={t("settings.pushNotifications")} />
            </div>
            <div className="flex items-center gap-3">
              <Bell size={16} className="text-slate-400" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">{t("settings.emailUpdates")}</p>
                <p className="text-xs text-slate-500">{t("settings.emailUpdatesDesc")}</p>
              </div>
              <Toggle checked={emailEnabled} onChange={setEmailEnabled} label={t("settings.emailUpdates")} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("settings.privacy")}</p>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
              <MapPin size={16} className="text-slate-400" />
              <p className="flex-1 text-xs text-slate-600">{t("settings.locationNote")}</p>
            </div>
            <div className="flex items-center gap-3">
              <Users size={16} className="text-slate-400" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">{t("settings.discoverable")}</p>
                <p className="text-xs text-slate-500">{t("settings.discoverableDesc")}</p>
              </div>
              <Toggle checked={profileDiscoverable} onChange={setProfileDiscoverable} label={t("settings.discoverable")} />
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">{t("settings.app")}</p>
        <button
          onClick={() => navigate("/settings/language")}
          className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <Globe size={16} className="shrink-0 text-slate-400" />
          <span className="flex-1 text-sm font-semibold text-slate-800">{t("settings.language")}</span>
          <span className="text-xs text-slate-500">{currentLanguageName}</span>
          <ChevronRight size={16} className="shrink-0 text-slate-300" />
        </button>
        <button
          onClick={() => navigate("/privacy")}
          className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <Lock size={16} className="shrink-0 text-slate-400" />
          <span className="flex-1 text-sm font-semibold text-slate-800">Privacy Policy</span>
          <ChevronRight size={16} className="shrink-0 text-slate-300" />
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">{t("settings.safety")}</p>
        {blockedGolfers.length > 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <ShieldOff size={12} /> {t("settings.blockedGolfers")}
            </p>
            <div className="flex flex-col gap-2">
              {blockedGolfers.map((g) => (
                <div key={g.id} className="flex items-center gap-3">
                  <Avatar golfer={g} size="xs" showVerified={false} />
                  <p className="flex-1 text-sm text-slate-700">{g.name}</p>
                  <button
                    onClick={() => {
                      unblockUser(g.id);
                      showToast(`Unblocked ${g.name}.`, "info");
                    }}
                    className="text-xs font-semibold text-fairway-700 hover:underline"
                  >
                    {t("settings.unblock")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={() => navigate("/community/guidelines")}
          className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <ShieldCheck size={16} className="shrink-0 text-slate-400" />
          <span className="flex-1 text-sm font-semibold text-slate-800">{t("settings.communityGuidelines")}</span>
          <ChevronRight size={16} className="shrink-0 text-slate-300" />
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">{t("settings.support")}</p>
        {/* forceShow: this is a deliberate, user-initiated view of the same
            install instructions Home shows once and lets you dismiss for
            good — dismissing it there shouldn't mean losing the ability to
            ever find it again. */}
        <AddToHomeScreenPrompt forceShow />
        <button
          onClick={() => navigate("/help")}
          className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <CircleHelp size={16} className="shrink-0 text-slate-400" />
          <span className="flex-1 text-sm font-semibold text-slate-800">{t("settings.help")}</span>
          <ChevronRight size={16} className="shrink-0 text-slate-300" />
        </button>
        <button
          onClick={() => navigate("/about")}
          className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <Info size={16} className="shrink-0 text-slate-400" />
          <span className="flex-1 text-sm font-semibold text-slate-800">{t("settings.about")}</span>
          <ChevronRight size={16} className="shrink-0 text-slate-300" />
        </button>
        <button
          onClick={startTutorial}
          className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <Compass size={16} className="shrink-0 text-slate-400" />
          <span className="flex-1 text-sm font-semibold text-slate-800">{t("settings.replayTutorial")}</span>
          <ChevronRight size={16} className="shrink-0 text-slate-300" />
        </button>
      </section>

      <Button variant="outline" icon={<LogOut size={15} />} onClick={() => setLogoutConfirmOpen(true)}>
        {t("settings.logOut")}
      </Button>

      {!isDemo && (
        <div className="rounded-2xl border border-red-100 bg-red-50/40 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-400">
            <AlertTriangle size={12} /> {t("settings.dangerZone")}
          </p>
          <p className="mb-3 text-xs text-slate-500">{t("settings.deleteAccountWarning")}</p>
          <Button variant="danger" size="sm" onClick={() => setDeleteConfirmOpen(true)}>
            {t("settings.deleteAccount")}
          </Button>
        </div>
      )}

      {isDemo && (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Sparkles size={12} /> Prototype tools
        </p>
        <p className="mb-3 text-xs text-slate-500">
          Currently previewing as <strong>{currentUser.name}</strong> ({golfers.length} demo profiles available).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setSwitcherOpen(true)}>
            Preview as a demo golfer
          </Button>
          <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setResetConfirmOpen(true)}>
            Reset demo data
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={14} />}
            onClick={() => {
              clearOnboardingDraft();
              window.localStorage.removeItem("golfme:notifPermissionShown");
              logOut();
              showToast("Onboarding reset — back to Welcome.", "info");
              navigate("/welcome");
            }}
          >
            Reset Onboarding
          </Button>
        </div>
      </div>
      )}

      {switcherOpen && <ProfileSwitcher onClose={() => setSwitcherOpen(false)} />}

      {resetConfirmOpen && (
        <ConfirmDialog
          title="Reset demo data?"
          message="This restores all golfers, Golf Calls, messages, and reviews to their original state — including your session. Any changes you've made will be lost."
          confirmLabel="Reset"
          danger
          onConfirm={() => {
            resetDemoData();
            setResetConfirmOpen(false);
            showToast("Demo data reset.", "info");
          }}
          onCancel={() => setResetConfirmOpen(false)}
        />
      )}

      {deleteConfirmOpen && (
        <ConfirmDialog
          title={t("settings.deleteAccountConfirmTitle")}
          message={t("settings.deleteAccountConfirmMessage")}
          confirmLabel={deletingAccount ? t("settings.deletingAccount") : t("settings.deleteAccount")}
          danger
          onConfirm={handleDeleteAccount}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}

      {logoutConfirmOpen && (
        <ConfirmDialog
          title={t("settings.logOutConfirmTitle")}
          message={t("settings.logOutConfirmMessage")}
          confirmLabel={t("settings.logOut")}
          danger
          onConfirm={() => {
            logOut();
            setLogoutConfirmOpen(false);
            navigate("/login");
          }}
          onCancel={() => setLogoutConfirmOpen(false)}
        />
      )}
    </div>
  );
}
