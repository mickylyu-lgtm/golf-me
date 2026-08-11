import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Sparkles, SlidersHorizontal } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useLocale } from "../../i18n/LocaleContext";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { Badge } from "../ui/Badge";
import { Slider } from "../ui/Slider";
import { LocationPicker } from "../location/LocationPicker";
import { inputClass } from "../ui/FormControls";
import { BUDGET_PREF_MAX, BUDGET_PREF_MIN, GOLF_VIBES, TRAVEL_RADIUS_MAX, TRAVEL_RADIUS_MIN } from "../../types";
import type { GolfVibe, SkillFilter, WalkOrCart } from "../../types";
import {
  GAME_FORMAT_OPTIONS,
  GENDER_OPTIONS_MATCH,
  GROUP_TYPE_OPTIONS,
  NETWORKING_OPTIONS,
  ROUND_LENGTH_OPTIONS,
  TRAVEL_RADIUS_PRESETS,
  formatBudgetValue,
  formatDistanceValue,
  newPreferenceParams,
  selectedNewPreferenceLabels,
} from "../../lib/matchPreferences";
import type { NewPreferenceSelections } from "../../lib/preferenceMatch";
import { locationParams } from "../../lib/travelLocation";
import type { PlayingArea } from "../../lib/geo";

export type WhenChoice = "today" | "tomorrow" | "weekend" | "date";

const WHEN_OPTIONS: { value: WhenChoice; labelKey: "filters.today" | "filters.tomorrow" | "filters.thisWeekend" | "filters.chooseDate" }[] = [
  { value: "today", labelKey: "filters.today" },
  { value: "tomorrow", labelKey: "filters.tomorrow" },
  { value: "weekend", labelKey: "filters.thisWeekend" },
  { value: "date", labelKey: "filters.chooseDate" },
];

const SKILL_OPTIONS: SkillFilter[] = ["Any Skill Level", "Beginner", "Intermediate", "Advanced"];
const WALK_OPTIONS: WalkOrCart[] = ["Either", "Walking", "Cart"];

function newPreferencesFromUser(user: { roundLengthPreference: NewPreferenceSelections["roundLengthPreference"]; genderPreference: NewPreferenceSelections["genderPreference"]; groupTypePreference: NewPreferenceSelections["groupTypePreference"]; gameFormatPreference: NewPreferenceSelections["gameFormatPreference"]; networkingPreference: NewPreferenceSelections["networkingPreference"] }): NewPreferenceSelections {
  return {
    roundLengthPreference: user.roundLengthPreference,
    genderPreference: user.genderPreference,
    groupTypePreference: user.groupTypePreference,
    gameFormatPreference: user.gameFormatPreference,
    networkingPreference: user.networkingPreference,
  };
}

// Reached only from the homepage's "Find Me a Round" action, so intent is
// implied (join an existing group) — no separate question needed here.
export function FindRoundModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { currentUser, updateCurrentUserProfile } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();

  const [when, setWhen] = useState<WhenChoice>("today");
  const [customDate, setCustomDate] = useState("");
  const [radius, setRadius] = useState(25);
  const [showFilters, setShowFilters] = useState(false);
  const [budgetCapEnabled, setBudgetCapEnabled] = useState(false);
  const [budgetMax, setBudgetMax] = useState(100);
  const [skillLevel, setSkillLevel] = useState<SkillFilter | "">("");
  const [vibe, setVibe] = useState<GolfVibe | "">("");
  const [walkOrCart, setWalkOrCart] = useState<WalkOrCart | "">("");

  // null = use the golfer's saved playing area; set only when "Playing
  // Somewhere Else?" is used — never written back to the profile unless
  // "Set as My Default" is tapped explicitly.
  const [travelLocation, setTravelLocation] = useState<PlayingArea | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const effectiveAreaLabel = travelLocation?.label ?? currentUser.areaLabel;

  // A per-search draft of the 5 Match Preferences — starts from the golfer's
  // saved defaults, but never writes back to the profile unless "Save as my
  // new preference" is tapped explicitly.
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [draftPrefs, setDraftPrefs] = useState<NewPreferenceSelections>(() => newPreferencesFromUser(currentUser));

  const canSubmit = when !== "date" || Boolean(customDate);
  const preferenceLabels = selectedNewPreferenceLabels(draftPrefs);

  function buildParams() {
    const params = new URLSearchParams({ matched: "1", when, radius: String(radius), intent: "join", ...newPreferenceParams(draftPrefs) });
    if (when === "date" && customDate) params.set("date", customDate);
    if (budgetCapEnabled) params.set("budgetMax", String(budgetMax));
    if (skillLevel) params.set("skill", skillLevel);
    if (vibe) params.set("vibe", vibe);
    if (walkOrCart) params.set("walk", walkOrCart);
    if (travelLocation) for (const [k, v] of Object.entries(locationParams(travelLocation))) params.set(k, v);
    return params;
  }

  function setTravelLocationAsDefault() {
    if (!travelLocation) return;
    updateCurrentUserProfile({ areaLabel: travelLocation.label, playingAreaCoords: travelLocation.coords });
    showToast(`Default playing area set to ${travelLocation.label}.`, "success");
    setTravelLocation(null);
  }

  function handleBrowseRounds() {
    if (!canSubmit) return;
    navigate(`/golf-calls?${buildParams().toString()}`);
    onClose();
  }

  function handleAutoMatch() {
    if (!canSubmit) return;
    navigate(`/auto-match?${buildParams().toString()}`);
    onClose();
  }

  function saveAsNewPreference() {
    updateCurrentUserProfile(draftPrefs);
    showToast("Saved as your new Match Preferences.", "success");
  }

  if (editingPrefs) {
    return (
      <Modal
        title={t("profile.matchPreferences")}
        onClose={onClose}
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="outline" fullWidth onClick={saveAsNewPreference}>
              {t("filters.saveAsNewPreference")}
            </Button>
            <Button fullWidth onClick={() => setEditingPrefs(false)}>
              {t("filters.useForThisSearch")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setEditingPrefs(false)}
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
          >
            <ArrowLeft size={16} /> {t("common.back")}
          </button>
          <p className="text-xs text-slate-500">{t("filters.changesApplyOnce")}</p>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t("matchPrefs.roundLength")}</label>
            <div className="flex flex-wrap gap-1.5">
              {ROUND_LENGTH_OPTIONS.map((r) => (
                <Pill key={r} active={draftPrefs.roundLengthPreference === r} onClick={() => setDraftPrefs((p) => ({ ...p, roundLengthPreference: r }))}>
                  {r}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t("matchPrefs.genderPreference")}</label>
            <div className="flex flex-wrap gap-1.5">
              {GENDER_OPTIONS_MATCH.map((g) => (
                <Pill key={g} active={draftPrefs.genderPreference === g} onClick={() => setDraftPrefs((p) => ({ ...p, genderPreference: g }))}>
                  {g === "Prefer mixed group" ? t("matchPrefs.mixedGroup") : g}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t("matchPrefs.groupType")}</label>
            <div className="flex flex-wrap gap-1.5">
              {GROUP_TYPE_OPTIONS.map((g) => (
                <Pill key={g} active={draftPrefs.groupTypePreference === g} onClick={() => setDraftPrefs((p) => ({ ...p, groupTypePreference: g }))}>
                  {g}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t("host.gameFormat")}</label>
            <div className="flex flex-wrap gap-1.5">
              {GAME_FORMAT_OPTIONS.map((g) => (
                <Pill key={g} active={draftPrefs.gameFormatPreference === g} onClick={() => setDraftPrefs((p) => ({ ...p, gameFormatPreference: g }))}>
                  {g}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t("matchPrefs.networking")}</label>
            <div className="flex flex-wrap gap-1.5">
              {NETWORKING_OPTIONS.map((n) => (
                <Pill key={n} active={draftPrefs.networkingPreference === n} onClick={() => setDraftPrefs((p) => ({ ...p, networkingPreference: n }))}>
                  {n}
                </Pill>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={t("filters.title")}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          <Button size="lg" fullWidth disabled={!canSubmit} onClick={handleAutoMatch} icon={<Sparkles size={18} />}>
            {t("filters.autoMatchMe")}
          </Button>
          <Button
            size="lg"
            variant="outline"
            fullWidth
            disabled={!canSubmit}
            onClick={handleBrowseRounds}
            icon={<ArrowRight size={18} />}
            className="flex-row-reverse"
          >
            {t("filters.browseRounds")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-sm font-bold text-slate-800">{t("filters.when")}</p>
          <div className="flex flex-wrap gap-1.5">
            {WHEN_OPTIONS.map((opt) => (
              <Pill key={opt.value} active={when === opt.value} onClick={() => setWhen(opt.value)}>
                {t(opt.labelKey)}
              </Pill>
            ))}
          </div>
          {when === "date" && (
            <input type="date" className={`${inputClass} mt-2`} value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">{t("filters.playingArea")}</p>
            <button onClick={() => setLocationPickerOpen(true)} className="text-xs font-semibold text-fairway-700 hover:underline">
              {travelLocation ? t("common.change") : t("filters.playingSomewhereElse")}
            </button>
          </div>
          <p className="text-sm text-slate-600">{effectiveAreaLabel}</p>
          {travelLocation && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">{t("filters.temporarySearch")}</p>
              <button onClick={setTravelLocationAsDefault} className="shrink-0 text-xs font-semibold text-fairway-700 hover:underline">
                {t("filters.setAsDefault")}
              </button>
            </div>
          )}
        </div>

        <Slider
          label={t("filters.howFar")}
          min={TRAVEL_RADIUS_MIN}
          max={TRAVEL_RADIUS_MAX}
          step={5}
          value={radius}
          onChange={setRadius}
          formatValue={formatDistanceValue}
          presets={TRAVEL_RADIUS_PRESETS}
        />

        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">{t("filters.usingPreferences")}</p>
            <button onClick={() => setEditingPrefs(true)} className="text-xs font-semibold text-fairway-700 hover:underline">
              {t("filters.viewEditPreferences")}
            </button>
          </div>
          {preferenceLabels.length === 0 ? (
            <p className="text-xs text-slate-500">{t("filters.noPreferencesSelected")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {preferenceLabels.map((label) => (
                <Badge key={label} tone="fairway">
                  {label}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800"
          >
            <SlidersHorizontal size={14} />
            {showFilters ? t("filters.hideAdvancedFilters") : t("filters.advancedFilters")}
          </button>
          {showFilters && (
            <div className="mt-3 flex flex-col gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("filters.budgetMax")}</label>
                  <Pill active={!budgetCapEnabled} onClick={() => setBudgetCapEnabled((v) => !v)}>
                    {t("filters.noLimit")}
                  </Pill>
                </div>
                <Slider
                  label={t("filters.budgetMax")}
                  min={BUDGET_PREF_MIN}
                  max={BUDGET_PREF_MAX}
                  step={10}
                  value={budgetMax}
                  onChange={setBudgetMax}
                  formatValue={formatBudgetValue}
                  disabled={!budgetCapEnabled}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t("filters.skillHandicap")}</label>
                <div className="flex flex-wrap gap-1.5">
                  {SKILL_OPTIONS.map((s) => (
                    <Pill key={s} active={skillLevel === s} onClick={() => setSkillLevel(skillLevel === s ? "" : s)}>
                      {s}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t("find.golfVibe")}</label>
                <div className="flex flex-wrap gap-1.5">
                  {GOLF_VIBES.map((v) => (
                    <Pill key={v} active={vibe === v} onClick={() => setVibe(vibe === v ? "" : v)}>
                      {v}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t("filters.walkingOrCart")}</label>
                <div className="flex flex-wrap gap-1.5">
                  {WALK_OPTIONS.map((w) => (
                    <Pill key={w} active={walkOrCart === w} onClick={() => setWalkOrCart(walkOrCart === w ? "" : w)}>
                      {w}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {locationPickerOpen && (
        <LocationPicker
          title={t("filters.playingSomewhereElse")}
          onSelect={(area) => {
            setTravelLocation(area);
            setLocationPickerOpen(false);
          }}
          onClose={() => setLocationPickerOpen(false)}
        />
      )}
    </Modal>
  );
}
