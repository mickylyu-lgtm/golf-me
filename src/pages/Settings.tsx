import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Laptop, LogOut, MapPin, RotateCcw, Smartphone, ShieldCheck, ShieldOff, Sparkles, User, Users, XCircle } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { usePresentation } from "../context/PresentationContext";
import type { FrameMode } from "../context/PresentationContext";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Toggle } from "../components/ui/Toggle";
import { ProfileSwitcher } from "../components/layout/ProfileSwitcher";

const FRAME_OPTIONS: { value: FrameMode; label: string; icon: typeof Laptop }[] = [
  { value: "desktop", label: "Desktop Frame", icon: Laptop },
  { value: "mobile", label: "Mobile Frame", icon: Smartphone },
  { value: "none", label: "No Frame", icon: XCircle },
];

export function Settings() {
  const { currentUser, golfers, blockedIds, getGolfer, unblockUser, logOut, resetDemoData } = useData();
  const { showToast } = useToast();
  const { frameMode, setFrameMode } = usePresentation();
  const navigate = useNavigate();

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [profileDiscoverable, setProfileDiscoverable] = useState(true);

  const blockedGolfers = blockedIds.map((id) => getGolfer(id)).filter((g): g is NonNullable<typeof g> => Boolean(g));

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Manage your account, privacy, and notifications.</p>
      </div>

      <button
        onClick={() => navigate("/profile")}
        className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
      >
        <Avatar golfer={currentUser} size="md" />
        <div className="flex-1">
          <p className="font-semibold text-slate-800">{currentUser.name}</p>
          <p className="text-xs text-slate-500">Edit profile</p>
        </div>
        <User size={16} className="text-slate-400" />
      </button>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Notifications</p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Bell size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">Push notifications</p>
              <p className="text-xs text-slate-500">New matches, join requests, and messages.</p>
            </div>
            <Toggle checked={pushEnabled} onChange={setPushEnabled} label="Push notifications" />
          </div>
          <div className="flex items-center gap-3">
            <Bell size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">Email updates</p>
              <p className="text-xs text-slate-500">Weekly digest of rounds near you.</p>
            </div>
            <Toggle checked={emailEnabled} onChange={setEmailEnabled} label="Email updates" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Privacy</p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <MapPin size={16} className="text-slate-400" />
            <p className="flex-1 text-xs text-slate-600">
              Your exact location is never shown. Other golfers only see an approximate distance and general area.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Users size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">Discoverable to nearby golfers</p>
              <p className="text-xs text-slate-500">Turn off to hide your profile from Discover and matches.</p>
            </div>
            <Toggle checked={profileDiscoverable} onChange={setProfileDiscoverable} label="Discoverable to nearby golfers" />
          </div>
        </div>
      </div>

      {blockedGolfers.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <ShieldOff size={12} /> Blocked golfers
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
                  Unblock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button variant="outline" icon={<ShieldCheck size={15} />} onClick={() => navigate("/community/guidelines")}>
        Community Guidelines
      </Button>

      <Button variant="outline" icon={<LogOut size={15} />} onClick={() => setLogoutConfirmOpen(true)}>
        Log out
      </Button>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Laptop size={12} /> Presentation Mode
        </p>
        <p className="mb-3 text-xs text-slate-500">Show GolfMe inside a laptop or phone frame for demos and screenshots.</p>
        <div className="flex flex-wrap gap-2">
          {FRAME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              size="sm"
              variant={frameMode === value ? "primary" : "outline"}
              icon={<Icon size={14} />}
              onClick={() => setFrameMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

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
