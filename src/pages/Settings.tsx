import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, ChevronRight, CircleHelp, Globe, Info, LogOut, MapPin, RotateCcw, ShieldCheck, ShieldOff, Sparkles, User, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useLocale, LOCALES } from "../i18n/LocaleContext";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Toggle } from "../components/ui/Toggle";
import { ProfileSwitcher } from "../components/layout/ProfileSwitcher";

export function Settings() {
  const { currentUser, golfers, blockedIds, getGolfer, unblockUser, logOut, resetDemoData } = useData();
  const { showToast } = useToast();
  const { locale, t } = useLocale();
  const navigate = useNavigate();

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [profileDiscoverable, setProfileDiscoverable] = useState(true);

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
      </section>

      <Button variant="outline" icon={<LogOut size={15} />} onClick={() => setLogoutConfirmOpen(true)}>
        {t("settings.logOut")}
      </Button>

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
        </div>
      </div>

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

      {logoutConfirmOpen && (
        <ConfirmDialog
          title="Log out?"
          message="You'll need to log back in to keep using GolfMe. Your profile and data stay saved."
          confirmLabel="Log out"
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
