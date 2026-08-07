import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Car, Check, Footprints, Mail, Phone, Settings as SettingsIcon, ShieldCheck, Users, Wallet } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { VerifyStepModal } from "../components/profile/VerifyStepModal";
import { ReputationRow } from "../components/golfer/ReputationRow";
import { CredibilityBadge } from "../components/golfer/CredibilityBadge";
import { AGE_RANGES, AVAILABILITY_SLOTS, GOLF_VIBES } from "../types";
import type { AgeRange, AvailabilitySlot, GolfVibe, WalkOrCart } from "../types";
import { VIBE_TONE } from "../lib/theme";
import { memberSinceLabel } from "../lib/format";
import { computeCredibility, computeHandicapConfidence } from "../lib/credibility";

const WALK_OPTIONS: WalkOrCart[] = ["Either", "Walking", "Cart"];

export function Profile() {
  const { currentUser, updateCurrentUserProfile, setPhoneVerified, setEmailVerified, requestVerifiedGolfer, circleGolfers, reviewsAbout } =
    useData();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [verifyChannel, setVerifyChannel] = useState<"phone" | "email" | null>(null);

  const [form, setForm] = useState(() => ({
    ageRange: currentUser.ageRange,
    areaLabel: currentUser.areaLabel,
    handicap: currentUser.handicap,
    favoriteCourses: currentUser.favoriteCourses.join(", "),
    budgetMin: currentUser.budgetMin,
    budgetMax: currentUser.budgetMax,
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
      walkOrCart: currentUser.walkOrCart,
      vibes: currentUser.vibes,
      bio: currentUser.bio,
    });
    setEditing(true);
  }

  function toggleAvailability(slot: AvailabilitySlot) {
    const next = currentUser.availability.includes(slot)
      ? currentUser.availability.filter((s) => s !== slot)
      : [...currentUser.availability, slot];
    updateCurrentUserProfile({ availability: next });
  }

  function setAvailableThisWeekend() {
    const weekendSlots: AvailabilitySlot[] = ["Weekend Mornings", "Weekend Afternoons", "Weekend Evenings"];
    const next = Array.from(new Set([...currentUser.availability, ...weekendSlots]));
    updateCurrentUserProfile({ availability: next });
    showToast("Marked available this weekend.", "success");
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
      walkOrCart: form.walkOrCart,
      vibes: form.vibes.length > 0 ? form.vibes : currentUser.vibes,
      bio: form.bio,
    });
    setEditing(false);
    showToast("Profile updated.", "success");
  }

  const canApplyVerifiedGolfer = currentUser.verification.phoneVerified && currentUser.verification.emailVerified && !currentUser.verification.verifiedGolfer;
  const myReviews = reviewsAbout(currentUser.id);
  const credibility = computeCredibility(currentUser, myReviews);
  const handicapConfidence = computeHandicapConfidence(myReviews);

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar golfer={currentUser} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-slate-900">{currentUser.name}</h1>
            <p className="text-sm text-slate-500">{memberSinceLabel(currentUser.memberSince)}</p>
            <div className="mt-1">
              <CredibilityBadge tier={credibility.tier} label={credibility.label} size="sm" />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {!editing && (
            <Button size="sm" variant="outline" onClick={startEditing}>
              Edit
            </Button>
          )}
          <button
            onClick={() => navigate("/settings")}
            aria-label="Settings"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-all duration-200 ease-out hover:border-slate-300 hover:text-slate-800 active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </div>

      {handicapConfidence.level === "needs_review" && (
        <div className="rounded-2xl border border-sun-200 bg-sun-50 p-4">
          <p className="text-sm font-semibold text-sun-800">
            We've received repeated feedback that your listed handicap may not reflect your current playing level.
          </p>
          <p className="mt-1 text-xs text-sun-700">Please review your handicap information — only you can see this note.</p>
          <Button size="sm" variant="outline" className="mt-2.5" onClick={startEditing}>
            Update handicap
          </Button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">GolfMe Reputation</p>
        <ReputationRow golfer={currentUser} />
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
          {handicapConfidence.level === "high" && <ShieldCheck size={12} className="text-fairway-600" />}
          {handicapConfidence.level === "high"
            ? "Handicap usually confirmed by playing partners"
            : handicapConfidence.level === "needs_review"
              ? "Handicap accuracy has been questioned by multiple playing partners"
              : null}
        </p>
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
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">When can you play?</p>
          <button
            onClick={setAvailableThisWeekend}
            className="text-xs font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800 hover:underline"
          >
            I'm available this weekend
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABILITY_SLOTS.map((slot) => (
            <Pill key={slot} active={currentUser.availability.includes(slot)} onClick={() => toggleAvailability(slot)}>
              {slot}
            </Pill>
          ))}
        </div>
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
    </div>
  );
}
