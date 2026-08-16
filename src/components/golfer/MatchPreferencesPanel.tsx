import { Pill } from "../ui/Pill";
import { useLocale } from "../../i18n/LocaleContext";
import { CoursePicker } from "../profile/CoursePicker";
import { labelClass } from "../ui/FormControls";
import { Slider } from "../ui/Slider";
import { RangeSlider } from "../ui/RangeSlider";
import {
  AGE_PREF_MAX,
  AGE_PREF_MIN,
  BUDGET_PREF_MAX,
  BUDGET_PREF_MIN,
  GOLF_VIBES,
  HANDICAP_PREF_MAX,
  HANDICAP_PREF_MIN,
  TRAVEL_RADIUS_MAX,
  TRAVEL_RADIUS_MIN,
} from "../../types";
import type { WalkOrCart } from "../../types";
import { vibeLabel, walkOrCartLabel } from "../../lib/enumLabels";
import type { PlayingArea } from "../../lib/geo";
import {
  GAME_FORMAT_OPTIONS,
  GENDER_OPTIONS_MATCH,
  GROUP_TYPE_OPTIONS,
  NETWORKING_OPTIONS,
  ROUND_LENGTH_OPTIONS,
  TRAVEL_RADIUS_PRESETS,
  formatAgeValue,
  formatBudgetValue,
  formatDistanceValue,
  formatHandicapValue,
} from "../../lib/matchPreferences";
import type { MatchPreferencesValue } from "../../lib/matchPreferences";

const WALK_OPTIONS: WalkOrCart[] = ["Either", "Walking", "Cart"];

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-bold uppercase tracking-wide text-fairway-700">{title}</p>
      {children}
    </div>
  );
}

interface MatchPreferencesPanelProps {
  value: MatchPreferencesValue;
  onChange: (patch: Partial<MatchPreferencesValue>) => void;
  /** The golfer's playing area, for CoursePicker's "Near Your Area" chips. */
  nearLocation?: PlayingArea;
}

// Sectioned per Part T: ROUND / PLAYING PARTNERS / STYLE / COST & LOCATION —
// stacks vertically, no horizontal scrolling, reused as-is from both Profile
// (permanent save) and Find Me a Round (temporary per-search override).
export function MatchPreferencesPanel({ value, onChange, nearLocation }: MatchPreferencesPanelProps) {
  const { t } = useLocale();

  function toggleVibe(v: (typeof GOLF_VIBES)[number]) {
    const has = value.vibes.includes(v);
    if (has) onChange({ vibes: value.vibes.filter((x) => x !== v) });
    else if (value.vibes.length < 2) onChange({ vibes: [...value.vibes, v] });
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title={t("matchPrefs.sectionRound")}>
        <div>
          <label className={labelClass}>{t("matchPrefs.roundLength")}</label>
          <div className="flex flex-wrap gap-1.5">
            {ROUND_LENGTH_OPTIONS.map((r) => (
              <Pill key={r} active={value.roundLengthPreference === r} onClick={() => onChange({ roundLengthPreference: r })}>
                {r}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>{t("host.gameFormat")}</label>
          <div className="flex flex-wrap gap-1.5">
            {GAME_FORMAT_OPTIONS.map((g) => (
              <Pill key={g} active={value.gameFormatPreference === g} onClick={() => onChange({ gameFormatPreference: g })}>
                {g}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>{t("filters.walkingOrCart")}</label>
          <div className="flex gap-2">
            {WALK_OPTIONS.map((w) => (
              <Pill key={w} active={value.walkOrCart === w} onClick={() => onChange({ walkOrCart: w })} className="flex-1 py-2 text-center">
                {walkOrCartLabel(w, t)}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>{t("matchPrefs.preferredCourses")}</label>
          <CoursePicker selected={value.preferredCourses} onChange={(preferredCourses) => onChange({ preferredCourses })} location={nearLocation} />
        </div>
      </Section>

      <Section title={t("matchPrefs.sectionPlayingPartners")}>
        <div>
          <label className={labelClass}>{t("matchPrefs.genderPreference")}</label>
          <div className="flex flex-wrap gap-1.5">
            {GENDER_OPTIONS_MATCH.map((g) => (
              <Pill key={g} active={value.genderPreference === g} onClick={() => onChange({ genderPreference: g })}>
                {g === "Prefer mixed group" ? t("matchPrefs.mixedGroup") : g}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>{t("matchPrefs.groupType")}</label>
          <div className="flex flex-wrap gap-1.5">
            {GROUP_TYPE_OPTIONS.map((g) => (
              <Pill key={g} active={value.groupTypePreference === g} onClick={() => onChange({ groupTypePreference: g })}>
                {g}
              </Pill>
            ))}
          </div>
        </div>
        <RangeSlider
          label={t("matchPrefs.preferredHandicapRange")}
          min={HANDICAP_PREF_MIN}
          max={HANDICAP_PREF_MAX}
          step={1}
          valueMin={value.handicapPreferenceMin}
          valueMax={value.handicapPreferenceMax}
          onChangeMin={(handicapPreferenceMin) => onChange({ handicapPreferenceMin })}
          onChangeMax={(handicapPreferenceMax) => onChange({ handicapPreferenceMax })}
          formatValue={formatHandicapValue}
        />
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className={labelClass + " mb-0"}>{t("matchPrefs.agePreference")}</label>
            <Pill active={value.noAgePreference} onClick={() => onChange({ noAgePreference: !value.noAgePreference })}>
              {t("matchPrefs.noAgePreference")}
            </Pill>
          </div>
          <RangeSlider
            label={t("matchPrefs.ageRange")}
            min={AGE_PREF_MIN}
            max={AGE_PREF_MAX}
            step={1}
            valueMin={value.agePreferenceMin}
            valueMax={value.agePreferenceMax}
            onChangeMin={(agePreferenceMin) => onChange({ agePreferenceMin })}
            onChangeMax={(agePreferenceMax) => onChange({ agePreferenceMax })}
            formatValue={formatAgeValue}
            disabled={value.noAgePreference}
          />
        </div>
      </Section>

      <Section title={t("matchPrefs.sectionStyle")}>
        <div>
          <label className={labelClass}>{t("matchPrefs.golfVibeUpTo2")}</label>
          <div className="flex flex-wrap gap-1.5">
            {GOLF_VIBES.map((v) => (
              <Pill key={v} active={value.vibes.includes(v)} onClick={() => toggleVibe(v)}>
                {vibeLabel(v, t)}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>{t("matchPrefs.networking")}</label>
          <p className="mb-1.5 text-xs text-slate-400">{t("matchPrefs.networkingHelp")}</p>
          <div className="flex flex-wrap gap-1.5">
            {NETWORKING_OPTIONS.map((n) => (
              <Pill key={n} active={value.networkingPreference === n} onClick={() => onChange({ networkingPreference: n })}>
                {n}
              </Pill>
            ))}
          </div>
        </div>
      </Section>

      <Section title={t("matchPrefs.sectionCostLocation")}>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className={labelClass + " mb-0"}>{t("matchPrefs.budgetPerRound")}</label>
            <Pill active={value.noBudgetPreference} onClick={() => onChange({ noBudgetPreference: !value.noBudgetPreference })}>
              {t("matchPrefs.noBudgetPreference")}
            </Pill>
          </div>
          <RangeSlider
            label={t("filters.budgetMax")}
            min={BUDGET_PREF_MIN}
            max={BUDGET_PREF_MAX}
            step={10}
            valueMin={value.budgetMin}
            valueMax={value.budgetMax}
            onChangeMin={(budgetMin) => onChange({ budgetMin })}
            onChangeMax={(budgetMax) => onChange({ budgetMax })}
            formatValue={formatBudgetValue}
            disabled={value.noBudgetPreference}
          />
        </div>
        <Slider
          label={t("matchPrefs.howFar")}
          min={TRAVEL_RADIUS_MIN}
          max={TRAVEL_RADIUS_MAX}
          step={5}
          value={value.travelRadiusMiles}
          onChange={(travelRadiusMiles) => onChange({ travelRadiusMiles })}
          formatValue={formatDistanceValue}
          presets={TRAVEL_RADIUS_PRESETS}
        />
      </Section>
    </div>
  );
}
