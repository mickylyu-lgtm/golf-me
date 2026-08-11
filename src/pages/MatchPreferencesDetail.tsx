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
import { matchPreferencesFromGolfer } from "../lib/matchPreferences";

export function MatchPreferencesDetail() {
  const { currentUser, updateCurrentUserProfile } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);

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
    showToast(t("preferences.markedAvailableToast"), "success");
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
            <p className="text-sm font-semibold text-slate-800">{currentUser.areaLabel}</p>
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
            <Pill key={slot} active={currentUser.availability.includes(slot)} onClick={() => toggleAvailability(slot)}>
              {slot}
            </Pill>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <MatchPreferencesPanel
          value={matchPreferencesFromGolfer(currentUser)}
          onChange={(patch) => updateCurrentUserProfile(patch)}
          nearLocation={{ label: currentUser.areaLabel, coords: currentUser.playingAreaCoords }}
        />
      </div>

      {locationPickerOpen && (
        <LocationPicker
          title={t("preferences.changePlayingArea")}
          onSelect={(area) => {
            updateCurrentUserProfile({ areaLabel: area.label, playingAreaCoords: area.coords });
            setLocationPickerOpen(false);
            showToast(t("preferences.areaSetToast", { area: area.label }), "success");
          }}
          onClose={() => setLocationPickerOpen(false)}
        />
      )}
    </div>
  );
}
