import { Pill } from "../ui/Pill";
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
}

// Sectioned per Part T: ROUND / PLAYING PARTNERS / STYLE / COST & LOCATION —
// stacks vertically, no horizontal scrolling, reused as-is from both Profile
// (permanent save) and Find Me a Round (temporary per-search override).
export function MatchPreferencesPanel({ value, onChange }: MatchPreferencesPanelProps) {
  function toggleVibe(v: (typeof GOLF_VIBES)[number]) {
    const has = value.vibes.includes(v);
    if (has) onChange({ vibes: value.vibes.filter((x) => x !== v) });
    else if (value.vibes.length < 2) onChange({ vibes: [...value.vibes, v] });
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Round">
        <div>
          <label className={labelClass}>Round length</label>
          <div className="flex flex-wrap gap-1.5">
            {ROUND_LENGTH_OPTIONS.map((r) => (
              <Pill key={r} active={value.roundLengthPreference === r} onClick={() => onChange({ roundLengthPreference: r })}>
                {r}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Game format</label>
          <div className="flex flex-wrap gap-1.5">
            {GAME_FORMAT_OPTIONS.map((g) => (
              <Pill key={g} active={value.gameFormatPreference === g} onClick={() => onChange({ gameFormatPreference: g })}>
                {g}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Walking or cart</label>
          <div className="flex gap-2">
            {WALK_OPTIONS.map((w) => (
              <Pill key={w} active={value.walkOrCart === w} onClick={() => onChange({ walkOrCart: w })} className="flex-1 py-2 text-center">
                {w}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Preferred courses</label>
          <CoursePicker selected={value.preferredCourses} onChange={(preferredCourses) => onChange({ preferredCourses })} />
        </div>
      </Section>

      <Section title="Playing Partners">
        <div>
          <label className={labelClass}>Gender preference</label>
          <div className="flex flex-wrap gap-1.5">
            {GENDER_OPTIONS_MATCH.map((g) => (
              <Pill key={g} active={value.genderPreference === g} onClick={() => onChange({ genderPreference: g })}>
                {g === "Prefer mixed group" ? "Mixed Group" : g}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Group type</label>
          <div className="flex flex-wrap gap-1.5">
            {GROUP_TYPE_OPTIONS.map((g) => (
              <Pill key={g} active={value.groupTypePreference === g} onClick={() => onChange({ groupTypePreference: g })}>
                {g}
              </Pill>
            ))}
          </div>
        </div>
        <RangeSlider
          label="Preferred Handicap Range"
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
            <label className={labelClass + " mb-0"}>Age preference</label>
            <Pill active={value.noAgePreference} onClick={() => onChange({ noAgePreference: !value.noAgePreference })}>
              No Age Preference
            </Pill>
          </div>
          <RangeSlider
            label="Age Range"
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

      <Section title="Style">
        <div>
          <label className={labelClass}>Golf vibe (up to 2)</label>
          <div className="flex flex-wrap gap-1.5">
            {GOLF_VIBES.map((v) => (
              <Pill key={v} active={value.vibes.includes(v)} onClick={() => toggleVibe(v)}>
                {v}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Networking</label>
          <p className="mb-1.5 text-xs text-slate-400">Secondary to golf — matched against rounds tagged with a Networking vibe.</p>
          <div className="flex flex-wrap gap-1.5">
            {NETWORKING_OPTIONS.map((n) => (
              <Pill key={n} active={value.networkingPreference === n} onClick={() => onChange({ networkingPreference: n })}>
                {n}
              </Pill>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Cost & Location">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className={labelClass + " mb-0"}>Budget per round</label>
            <Pill active={value.noBudgetPreference} onClick={() => onChange({ noBudgetPreference: !value.noBudgetPreference })}>
              No Budget Preference
            </Pill>
          </div>
          <RangeSlider
            label="Budget"
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
          label="How far?"
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
