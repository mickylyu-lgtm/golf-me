import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, LocateFixed, MapPin } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { AvatarUpload } from "../components/profile/AvatarUpload";
import { LocationPicker } from "../components/location/LocationPicker";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { initialsFromName, avatarColorForName } from "../lib/avatar";
import type { GeoPoint } from "../lib/geo";
import { track } from "../lib/analytics";
import { clearOnboardingDraft, loadOnboardingDraft, saveOnboardingDraft } from "../lib/onboardingDraft";
import type { OnboardingDraft } from "../lib/onboardingDraft";

function draftDefaults(): OnboardingDraft {
  return {
    name: "",
    is18Plus: false,
    areaLabel: "",
    playingAreaCoords: undefined,
    hasHandicap: true,
    handicap: 15,
  };
}

// Fields that used to be asked during onboarding (gender, favorite course,
// round length, vibes, walk/cart, budget, travel radius) still get written
// at signup so every downstream consumer sees the exact same shape it
// always has — just with fixed, honest "not yet set" values instead of a
// user-driven pick, since the UI for picking them moved to Profile / Match
// Preferences (all remain fully editable there). None of these are
// fabricated data about the golfer — they're the same neutral defaults the
// old wizard's own pre-seeded state already shipped with before a user
// touched anything (Casual & Social vibe, Either walk/cart, $60 typical
// budget => $45-$75, 25mi radius, No Preference round length).
const DEFAULT_VIBES = ["Casual & Social"] as const;
const DEFAULT_WALK_OR_CART = "Either" as const;
const DEFAULT_BUDGET_MIN = 45;
const DEFAULT_BUDGET_MAX = 75;
const DEFAULT_TRAVEL_RADIUS_MILES = 25;
const DEFAULT_ROUND_LENGTH_PREFERENCE = "No Preference" as const;
const DEFAULT_GENDER = "Prefer not to say";

export function ProfileSetup() {
  const navigate = useNavigate();
  const { signUpNewGolfer } = useData();
  const { isDemo, profileRow, saveProfile, signOut } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const [submitting, setSubmitting] = useState(false);

  const initial = loadOnboardingDraft() ?? draftDefaults();

  const [name, setName] = useState(initial.name);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [is18Plus, setIs18Plus] = useState(initial.is18Plus);

  const [areaLabel, setAreaLabel] = useState(initial.areaLabel);
  const [playingAreaCoords, setPlayingAreaCoords] = useState<GeoPoint | undefined>(initial.playingAreaCoords);
  const [locationPickerMode, setLocationPickerMode] = useState<"none" | "auto" | "manual">("none");

  const [hasHandicap, setHasHandicap] = useState(initial.hasHandicap);
  const [handicap, setHandicap] = useState<number | "">(initial.handicap);

  // Persist a resumable draft on every change (not photoUrl — a data-URL
  // image would bloat localStorage for a draft that might never be
  // finished; a golfer who abandons and returns just re-picks a photo).
  useEffect(() => {
    saveOnboardingDraft({ name, is18Plus, areaLabel, playingAreaCoords, hasHandicap, handicap });
  }, [name, is18Plus, areaLabel, playingAreaCoords, hasHandicap, handicap]);

  const formValid = Boolean(name.trim()) && is18Plus && Boolean(areaLabel.trim());

  async function submit() {
    if (!formValid || submitting) return;
    const finalHandicap = handicap === "" ? 15 : handicap;

    if (isDemo) {
      signUpNewGolfer({
        name: name.trim(),
        photoUrl,
        gender: DEFAULT_GENDER,
        areaLabel: areaLabel.trim(),
        playingAreaCoords,
        handicap: hasHandicap ? finalHandicap : null,
        vibes: [...DEFAULT_VIBES],
        walkOrCart: DEFAULT_WALK_OR_CART,
        budgetMin: DEFAULT_BUDGET_MIN,
        budgetMax: DEFAULT_BUDGET_MAX,
        favoriteCourses: [],
        preferredCourses: [],
        travelRadiusMiles: DEFAULT_TRAVEL_RADIUS_MILES,
        roundLengthPreference: DEFAULT_ROUND_LENGTH_PREFERENCE,
      });
    } else {
      // Real account: the auth identity already exists (Google/email sign-in
      // happened before this screen could even be reached — see App.tsx's
      // route guards), so this writes into that existing profiles row
      // instead of minting a new mock golfer. Avatar upload isn't wired to
      // Supabase Storage yet (that's a later phase) — photoUrl stays local-
      // only for real accounts for now, never written as a data-URL.
      // age_range is deliberately omitted — it isn't asked here, and
      // leaving the column NULL (never a fabricated band) is exactly what
      // every consumer (autoMatch, GolferCard, Profile) already handles.
      //
      // Preference defaults are only written into columns that are still
      // unset on the existing row (the handle_new_user() stub leaves them
      // null/empty/0). If this screen is ever reached by a golfer who
      // already has preferences saved, finishing it must not reset them.
      const row = profileRow;
      const preferenceDefaults: Record<string, unknown> = {};
      if (!row?.gender) preferenceDefaults.gender = DEFAULT_GENDER;
      if (!row || row.vibes.length === 0) preferenceDefaults.vibes = [...DEFAULT_VIBES];
      if (!row?.walk_or_cart) preferenceDefaults.walk_or_cart = DEFAULT_WALK_OR_CART;
      if (!row || (row.budget_min === 0 && row.budget_max === 0 && !row.no_budget_preference)) {
        preferenceDefaults.budget_min = DEFAULT_BUDGET_MIN;
        preferenceDefaults.budget_max = DEFAULT_BUDGET_MAX;
      }
      if (!row) {
        // Column defaults already equal these on a stub row, so they only
        // need writing when there's no row snapshot to compare against.
        preferenceDefaults.skill_level = null;
        preferenceDefaults.favorite_courses = [];
        preferenceDefaults.travel_radius_miles = DEFAULT_TRAVEL_RADIUS_MILES;
        preferenceDefaults.round_length_preference = DEFAULT_ROUND_LENGTH_PREFERENCE;
      }
      setSubmitting(true);
      try {
        await saveProfile({
          name: name.trim(),
          avatar_color: avatarColorForName(name),
          avatar_initials: initialsFromName(name),
          area_label: areaLabel.trim(),
          playing_area_lat: playingAreaCoords?.lat ?? null,
          playing_area_lng: playingAreaCoords?.lng ?? null,
          handicap: hasHandicap ? finalHandicap : null,
          ...preferenceDefaults,
          has_onboarded: true,
        });
      } catch (err) {
        setSubmitting(false);
        showToast(err instanceof Error ? err.message : t("auth.authError"), "warning");
        return;
      }
    }

    clearOnboardingDraft();
    track("profile_basic_completed");
    // Deferred one tick, verified against real behavior (not a hypothetical
    // guard): the session flips to onboarded synchronously above, but
    // react-router-dom's own internal location state doesn't update in the
    // same commit as a navigate() call made from the same handler. GuestOnly
    // (still wrapping this /profile-setup route in that stale render) sees
    // the new state against its OLD location and fires its own `replace`
    // redirect to "/" — which, calling history.replaceState AFTER this
    // navigate's pushState, wins and strands the user on Home instead of
    // /ready. Pushing this navigate to a macrotask lets that stale render
    // (and GuestOnly's redirect) fully settle first, so this call is
    // guaranteed to be the last history write.
    setTimeout(() => navigate("/ready"), 0);
  }

  function handleLocationSelected(area: { label: string; coords?: GeoPoint }) {
    setAreaLabel(area.label);
    setPlayingAreaCoords(area.coords);
    setLocationPickerMode("none");
    track("location_selected", { hasCoords: Boolean(area.coords) });
  }

  return (
    // Fixed to the real visible viewport (dvh, not vh/min-h-screen -- mobile
    // Safari's 100vh includes space the collapsible address bar is actually
    // covering). Content scrolls independently in the middle; the button
    // stays a non-shrinking footer, always reachable without hunting for
    // it, however long the content gets on a small screen.
    <div className="flex h-[100dvh] flex-col bg-[#faf9f6]">
      <div className="flex items-center px-6" style={{ paddingTop: "max(2rem, env(safe-area-inset-top))" }}>
        {/* Deliberately signs out first, then navigates -- plain
            navigate(-1)/"/login" alone did nothing, because every
            guest-only route (Welcome/Login/Signup) redirects an
            authenticated-but-not-onboarded session straight back to
            /profile-setup (see GuestOnly in App.tsx). Ending the session is
            what actually makes /login a valid destination to land on, for
            someone who wants to abandon this signup and use a different
            account/method instead. */}
        <button
          onClick={async () => {
            await signOut();
            navigate("/login");
          }}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> {t("common.back")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        <div className="flex flex-col gap-5 py-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{t("profileSetup.quickProfileTitle")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("profileSetup.quickProfileSubtitle")}</p>
          </div>

          <div className="flex flex-col gap-4">
            <AvatarUpload
              golfer={{
                photoUrl,
                avatarColor: name.trim() ? avatarColorForName(name) : "from-slate-300 to-slate-400",
                avatarInitials: name.trim() ? initialsFromName(name) : "?",
                verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: false },
              }}
              onChange={setPhotoUrl}
            />
            <div>
              <label className={labelClass}>{t("profileSetup.name")}</label>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("profileSetup.namePlaceholder")} />
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3.5 py-3">
              <input type="checkbox" checked={is18Plus} onChange={() => setIs18Plus((v) => !v)} className="mt-0.5 h-4 w-4 accent-fairway-600" />
              <span className="text-sm text-slate-700">{t("profileSetup.confirm18")}</span>
            </label>
          </div>

          <div className="flex flex-col gap-4">
            {!areaLabel ? (
              <>
                <p className="text-sm font-bold text-slate-800">{t("profileSetup.locationTitle")}</p>
                <p className="-mt-2 text-sm text-slate-500">{t("profileSetup.locationBody")}</p>
                <Button variant="secondary" fullWidth icon={<LocateFixed size={16} />} onClick={() => setLocationPickerMode("auto")}>
                  {t("profileSetup.useMyLocation")}
                </Button>
                <Button variant="outline" fullWidth onClick={() => setLocationPickerMode("manual")}>
                  {t("profileSetup.chooseManually")}
                </Button>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4">
                <div className="flex items-center gap-2.5">
                  <MapPin size={16} className="shrink-0 text-fairway-600" />
                  <p className="text-sm font-semibold text-slate-800">{areaLabel}</p>
                </div>
                <button onClick={() => setLocationPickerMode("manual")} className="shrink-0 text-xs font-semibold text-fairway-700 hover:underline">
                  {t("common.change")}
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <button
                onClick={() => setHasHandicap(true)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  hasHandicap ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600"
                }`}
              >
                {t("profileSetup.iHaveHandicap")}
              </button>
              <button
                onClick={() => setHasHandicap(false)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  !hasHandicap ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600"
                }`}
              >
                {t("profileSetup.noHandicap")}
              </button>
            </div>
            {hasHandicap && (
              <div>
                <label className={labelClass}>{t("profile.handicap")}</label>
                <input
                  type="number"
                  className={inputClass}
                  value={handicap}
                  onChange={(e) => setHandicap(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-6 pb-8 pt-3">
        <Button size="lg" fullWidth disabled={!formValid || submitting} onClick={submit}>
          {t("common.continue")}
        </Button>
      </div>

      {locationPickerMode !== "none" && (
        <LocationPicker
          title={t("profileSetup.locationTitle")}
          autoRequestLocation={locationPickerMode === "auto"}
          onSelect={handleLocationSelected}
          onClose={() => setLocationPickerMode("none")}
        />
      )}
    </div>
  );
}
