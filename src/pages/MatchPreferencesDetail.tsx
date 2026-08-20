import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { LocationPicker } from "../components/location/LocationPicker";
import { MatchPreferencesPanel } from "../components/golfer/MatchPreferencesPanel";
import { AVAILABILITY_SLOTS } from "../types";
import type { AvailabilitySlot } from "../types";
import type { PlayingArea } from "../lib/geo";
import { matchPreferencesFromGolfer } from "../lib/matchPreferences";
import type { MatchPreferencesValue } from "../lib/matchPreferences";

// Everything on this page is a local draft until "Save Changes" is tapped —
// no per-field auto-save. Rebuilt this way after live per-field saving
// turned out to have two real problems: rapid saves could race each other
// client-side (see DataContext.updateCurrentUserProfile's now-serialized
// queue, added first but not sufficient on its own), and there was no
// single, obvious moment where the user could tell "yes, that's saved now."
// A bottom Save button, disabled until something actually changed, fixes
// both by construction. Mirrors the draft-then-commit pattern
// FindRoundModal.tsx already uses for its own per-search preference
// override, just persisted instead of temporary.
export function MatchPreferencesDetail() {
  const { currentUser, updateCurrentUserProfile } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [draftPrefs, setDraftPrefs] = useState<MatchPreferencesValue>(() => matchPreferencesFromGolfer(currentUser));
  const [draftAvailability, setDraftAvailability] = useState<AvailabilitySlot[]>(currentUser.availability);
  const [draftArea, setDraftArea] = useState<PlayingArea>({ label: currentUser.areaLabel, coords: currentUser.playingAreaCoords });

  const availabilityChanged =
    draftAvailability.length !== currentUser.availability.length || draftAvailability.some((s) => !currentUser.availability.includes(s));
  const areaChanged = draftArea.label !== currentUser.areaLabel;
  const prefsChanged = JSON.stringify(draftPrefs) !== JSON.stringify(matchPreferencesFromGolfer(currentUser));
  const isDirty = availabilityChanged || areaChanged || prefsChanged;

  function toggleAvailability(slot: AvailabilitySlot) {
    setDraftAvailability((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]));
  }

  function setAvailableThisWeekend() {
    const weekendSlots: AvailabilitySlot[] = ["Weekend Mornings", "Weekend Afternoons", "Weekend Evenings"];
    setDraftAvailability((prev) => Array.from(new Set([...prev, ...weekendSlots])));
  }

  async function handleSave() {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      // Navigating only after this resolves matters for more than just
      // correctness: updateCurrentUserProfile's real-account path awaits a
      // full UPDATE + re-SELECT round trip before currentUser reflects the
      // change (see DataContext.tsx). Leaving before that finished was the
      // likely cause of Home's "complete your profile" reminder looking
      // like it hadn't registered the save — the reminder was reading
      // currentUser before it had actually updated.
      await updateCurrentUserProfile({
        ...draftPrefs,
        availability: draftAvailability,
        areaLabel: draftArea.label,
        playingAreaCoords: draftArea.coords,
      });
      showToast(t("preferences.savedToast"), "success");
      navigate("/");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("preferences.saveError"), "warning");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("preferences.title")}</h1>
        <p className="text-sm text-slate-500">{t("preferences.subtitle")}</p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <MapPin size={16} className="shrink-0 text-fairway-600" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("host.playingArea")}</p>
            <p className="text-sm font-semibold text-slate-800">{draftArea.label}</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setLocationPickerOpen(true)}>
          {t("common.change")}
        </Button>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("preferences.whenCanYouPlay")}</p>
          <button
            onClick={setAvailableThisWeekend}
            className="text-xs font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800 hover:underline"
          >
            {t("preferences.availableThisWeekend")}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABILITY_SLOTS.map((slot) => (
            <Pill key={slot} active={draftAvailability.includes(slot)} onClick={() => toggleAvailability(slot)}>
              {slot}
            </Pill>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <MatchPreferencesPanel
          value={draftPrefs}
          onChange={(patch) => setDraftPrefs((d) => ({ ...d, ...patch }))}
          nearLocation={{ label: draftArea.label, coords: draftArea.coords }}
        />
      </div>

      {locationPickerOpen && (
        <LocationPicker
          title={t("preferences.changePlayingArea")}
          onSelect={(area) => {
            setDraftArea(area);
            setLocationPickerOpen(false);
          }}
          onClose={() => setLocationPickerOpen(false)}
        />
      )}

      {/* A normal, non-fixed/non-sticky block at the end of the page —
          deliberately only reachable by scrolling to it (not always
          visible), the single, explicit "yes, this is saved now" moment
          the live-save version didn't have. Previously `fixed` to the
          screen bottom, which stayed visible over the content the whole
          time instead of just sitting where the form ends. */}
      <div className="mt-4">
        <Button size="lg" fullWidth disabled={!isDirty || saving} onClick={handleSave}>
          {saving ? t("preferences.saving") : t("common.saveChanges")}
        </Button>
      </div>
    </div>
  );
}
