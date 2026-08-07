import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Car,
  Check,
  Footprints,
  Mail,
  Phone,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { VerifyStepModal } from "../components/profile/VerifyStepModal";
import { ReputationRow } from "../components/golfer/ReputationRow";
import { AGE_RANGES, AVAILABILITY_SLOTS, GOLF_VIBES } from "../types";
import type { AgeRange, AvailabilitySlot, GolfVibe, WalkOrCart } from "../types";
import { VIBE_TONE } from "../lib/theme";
import { memberSinceLabel } from "../lib/format";

const WALK_OPTIONS: WalkOrCart[] = ["Either", "Walking", "Cart"];

export function Profile() {
  const {
    currentUser,
    golfers,
    blockedIds,
    getGolfer,
    unblockUser,
    updateCurrentUserProfile,
    setPhoneVerified,
    setEmailVerified,
    requestVerifiedGolfer,
    resetDemoData,
    circleGolfers,
  } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [verifyChannel, setVerifyChannel] = useState<"phone" | "email" | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const [form, setForm] = useState(() => ({
    ageRange: currentUser.ageRange,
    areaLabel: currentUser.areaLabel,
    handicap: currentUser.handicap,
    favoriteCourses: currentUser.favoriteCourses.join(", "),
    budgetMin: currentUser.budgetMin,
    budgetMax: currentUser.budgetMax,
    availability: currentUser.availability,
    walkOrCart: currentUser.walkOrCart,
    vibes: currentUser.vibes,
    bio: currentUser.bio,
  }));

  function startEditing() {
    setForm({
      ageRange: currentUser.ageRange,
      areaLabel: currentUser.areaLabel,
      handicap: currentUser.handicap,
      favoriteCourses: currentUser.favoriteCourses.join(", "),
      budgetMin: currentUser.budgetMin,
      budgetMax: currentUser.budgetMax,
      availability: currentUser.availability,
      walkOrCart: currentUser.walkOrCart,
      vibes: currentUser.vibes,
      bio: currentUser.bio,
    });
    setEditing(true);
  }

  function toggleAvailability(slot: AvailabilitySlot) {
    setForm((prev) => ({
      ...prev,
      availability: prev.availability.includes(slot) ? prev.availability.filter((s) => s !== slot) : [...prev.availability, slot],
    }));
  }

  function toggleVibe(v: GolfVibe) {
    setForm((prev) => {
      if (prev.vibes.includes(v)) return { ...prev, vibes: prev.vibes.filter((x) => x !== v) };
      if (prev.vibes.length >= 2) return prev;
      return { ...prev, vibes: [...prev.vibes, v] };
    });
  }

  function save() {
    updateCurrentUserProfile({
      ageRange: form.ageRange,
      areaLabel: form.areaLabel.trim() || currentUser.areaLabel,
      handicap: form.handicap,
      favoriteCourses: form.favoriteCourses
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      budgetMin: form.budgetMin,
      budgetMax: Math.max(form.budgetMax, form.budgetMin),
      availability: form.availability,
      walkOrCart: form.walkOrCart,
      vibes: form.vibes.length > 0 ? form.vibes : currentUser.vibes,
      bio: form.bio,
    });
    setEditing(false);
    showToast("Profile updated.", "success");
  }

  const blockedGolfers = blockedIds.map((id) => getGolfer(id)).filter((g): g is NonNullable<typeof g> => Boolean(g));
  const canApplyVerifiedGolfer = currentUser.verification.phoneVerified && currentUser.verification.emailVerified && !currentUser.verification.verifiedGolfer;

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar golfer={currentUser} size="xl" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">{currentUser.name}</h1>
            <p className="text-sm text-slate-500">{memberSinceLabel(currentUser.memberSince)}</p>
          </div>
        </div>
        {!editing && (
          <Button size="sm" variant="outline" onClick={startEditing}>
            Edit
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Golf Reputation</p>
        <ReputationRow golfer={currentUser} />
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Users size={12} /> Your Golf Circle · {circleGolfers.length} golfer{circleGolfers.length === 1 ? "" : "s"}
        </p>
        {circleGolfers.length === 0 ? (
          <p className="text-sm text-slate-500">
            Play a round and review your group to start building your Circle — golfers you've actually played with and would play with again.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {circleGolfers.map((g) => (
              <button
                key={g.id}
                onClick={() => navigate(`/golfer/${g.id}`)}
                className="flex items-center gap-3 rounded-xl px-1 py-1 text-left transition hover:bg-slate-50"
              >
                <Avatar golfer={g} size="sm" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                  <p className="text-xs text-slate-500">{g.handicap !== null ? `${g.handicap} handicap` : "No handicap yet"}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Trust &amp; verification</p>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-3">
            <Phone size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">Phone number</p>
              <p className="text-xs text-slate-500">Never shown to other golfers.</p>
            </div>
            {currentUser.verification.phoneVerified ? (
              <Badge tone="fairway" icon={<Check size={11} />}>
                Verified
              </Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setVerifyChannel("phone")}>
                Verify
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-3">
            <Mail size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">Email address</p>
              <p className="text-xs text-slate-500">Never shown to other golfers.</p>
            </div>
            {currentUser.verification.emailVerified ? (
              <Badge tone="fairway" icon={<Check size={11} />}>
                Verified
              </Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setVerifyChannel("email")}>
                Verify
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-3">
            <ShieldCheck size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">Verified Golfer badge</p>
              <p className="text-xs text-slate-500">
                {currentUser.verification.verifiedGolfer
                  ? "Shown on your profile and Golf Calls."
                  : "Requires phone + email verification."}
              </p>
            </div>
            {currentUser.verification.verifiedGolfer ? (
              <Badge tone="fairway" icon={<ShieldCheck size={11} />}>
                Active
              </Badge>
            ) : (
              <Button size="sm" variant="outline" disabled={!canApplyVerifiedGolfer} onClick={() => { requestVerifiedGolfer(); showToast("You're now a Verified Golfer!", "success"); }}>
                Apply
              </Button>
            )}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Age range</label>
              <select className={inputClass} value={form.ageRange} onChange={(e) => setForm((f) => ({ ...f, ageRange: e.target.value as AgeRange }))}>
                {AGE_RANGES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Handicap</label>
              <input
                type="number"
                className={inputClass}
                value={form.handicap ?? ""}
                placeholder="No handicap yet"
                onChange={(e) => setForm((f) => ({ ...f, handicap: e.target.value === "" ? null : Number(e.target.value) }))}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>General area</label>
            <input className={inputClass} value={form.areaLabel} onChange={(e) => setForm((f) => ({ ...f, areaLabel: e.target.value }))} />
          </div>
          <div>
            <label className={labelClass}>Favorite courses</label>
            <input
              className={inputClass}
              value={form.favoriteCourses}
              onChange={(e) => setForm((f) => ({ ...f, favoriteCourses: e.target.value }))}
              placeholder="Comma-separated"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Budget min</label>
              <input
                type="number"
                className={inputClass}
                value={form.budgetMin}
                onChange={(e) => setForm((f) => ({ ...f, budgetMin: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className={labelClass}>Budget max</label>
              <input
                type="number"
                className={inputClass}
                value={form.budgetMax}
                onChange={(e) => setForm((f) => ({ ...f, budgetMax: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Walking or cart</label>
            <div className="flex gap-2">
              {WALK_OPTIONS.map((w) => (
                <button
                  key={w}
                  onClick={() => setForm((f) => ({ ...f, walkOrCart: w }))}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    form.walkOrCart === w ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelClass}>Golf vibe (up to 2)</label>
            <div className="flex flex-wrap gap-1.5">
              {GOLF_VIBES.map((v) => (
                <button
                  key={v}
                  onClick={() => toggleVibe(v)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    form.vibes.includes(v) ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 text-slate-600"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelClass}>Availability</label>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABILITY_SLOTS.map((slot) => (
                <button
                  key={slot}
                  onClick={() => toggleAvailability(slot)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    form.availability.includes(slot) ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 text-slate-600"
                  }`}
                >
                  {slot}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelClass}>Bio</label>
            <textarea className={inputClass} rows={3} value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" fullWidth onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button fullWidth onClick={save}>
              Save changes
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="text-sm leading-relaxed text-slate-600">{currentUser.bio}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Handicap</p>
              <p className="mt-1 font-bold text-slate-800">{currentUser.handicap ?? "No handicap yet"}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Wallet size={12} /> Budget
              </p>
              <p className="mt-1 font-bold text-slate-800">
                ${currentUser.budgetMin}–${currentUser.budgetMax}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {currentUser.walkOrCart === "Walking" ? <Footprints size={12} /> : <Car size={12} />} Preference
              </p>
              <p className="mt-1 font-bold text-slate-800">{currentUser.walkOrCart}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Area</p>
              <p className="mt-1 font-bold text-slate-800">{currentUser.areaLabel}</p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Golf vibe</p>
            <div className="flex flex-wrap gap-1.5">
              {currentUser.vibes.map((v) => (
                <Badge key={v} tone={VIBE_TONE[v]}>
                  {v}
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Availability</p>
            <div className="flex flex-wrap gap-1.5">
              {currentUser.availability.map((a) => (
                <Badge key={a} tone="outline">
                  {a}
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Favorite courses</p>
            <div className="flex flex-wrap gap-1.5">
              {currentUser.favoriteCourses.map((c) => (
                <Badge key={c} tone="outline">
                  {c}
                </Badge>
              ))}
            </div>
          </div>
        </>
      )}

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
                <button onClick={() => { unblockUser(g.id); showToast(`Unblocked ${g.name}.`, "info"); }} className="text-xs font-semibold text-fairway-700 hover:underline">
                  Unblock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Sparkles size={12} /> Prototype tools
        </p>
        <p className="mb-3 text-xs text-slate-500">
          Currently previewing as <strong>{currentUser.name}</strong> ({golfers.length} demo profiles available via the switcher in the top bar).
        </p>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setResetConfirmOpen(true)}>
          Reset demo data
        </Button>
      </div>

      {verifyChannel && (
        <VerifyStepModal
          channel={verifyChannel}
          target={verifyChannel === "phone" ? "(•••) •••-0142" : "you@example.com"}
          onClose={() => setVerifyChannel(null)}
          onVerified={() => {
            if (verifyChannel === "phone") setPhoneVerified(true);
            else setEmailVerified(true);
            showToast(`${verifyChannel === "phone" ? "Phone" : "Email"} verified.`, "success");
            setVerifyChannel(null);
          }}
        />
      )}

      {resetConfirmOpen && (
        <ConfirmDialog
          title="Reset demo data?"
          message="This restores all golfers, Golf Calls, messages, and reviews to their original state. Any changes you've made will be lost."
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
    </div>
  );
}
