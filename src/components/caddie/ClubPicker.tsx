import { useState } from "react";
import type { ComponentType } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { labelClass } from "../ui/FormControls";
import { CLUB_CATEGORIES, CLUBS_BY_CATEGORY, clubCategoryOf } from "../../lib/clubCatalog";
import type { ClubCategory } from "../../lib/clubCatalog";
import { clubLabel } from "../../lib/clubLabel";
import { DriverSketch, HybridSketch, IronSketch, WedgeSketch, WoodSketch } from "./clubSketches";

// Caddie's "I'm hitting..." club choice (replaced a <select>, 2026-11-06):
// a scrollable row of category cards with a sketch of each club, then chips
// for the exact club. Optional, like before: "Not sure" (the default) sends
// no club. Both rows are radiogroups of role="radio" buttons, which also
// gives each pick the app's light selection haptic (lib/tapFeedback).

const SKETCHES: Record<ClubCategory, ComponentType<{ size?: number }>> = {
  driver: DriverSketch,
  wood: WoodSketch,
  hybrid: HybridSketch,
  iron: IronSketch,
  wedge: WedgeSketch,
};

const CATEGORY_KEYS: Record<ClubCategory, TranslationKey> = {
  driver: "club.category.driver",
  wood: "club.category.wood",
  hybrid: "club.category.hybrid",
  iron: "club.category.iron",
  wedge: "club.category.wedge",
};

const cardClass = (on: boolean) =>
  `flex h-[76px] w-16 shrink-0 snap-start flex-col items-center justify-center gap-0.5 rounded-xl border text-[11px] font-semibold transition-colors disabled:opacity-40 ${
    on ? "border-fairway-500 bg-fairway-50 text-fairway-700 shadow-sm" : "border-slate-200 bg-white text-slate-500 hover:border-fairway-300"
  }`;

export function ClubPicker({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useLocale();
  // Which category's chips are showing: the saved club's, else none.
  const [open, setOpen] = useState<ClubCategory | null>(() => clubCategoryOf(value));

  return (
    <div data-testid="caddie-club-picker">
      <p id="club-picker-label" className={labelClass}>
        {t("caddie.swingTypePlaceholder")}
      </p>
      <div
        role="radiogroup"
        aria-label={`${t("caddie.swingTypePlaceholder")}: ${t("caddie.club.typeLabel")}`}
        className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {CLUB_CATEGORIES.map((category) => {
          const Sketch = SKETCHES[category];
          const on = open === category;
          return (
            <button
              key={category}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => {
                setOpen(category);
                // A club from another card is no longer what was picked.
                if (value && clubCategoryOf(value) !== category) onChange("");
              }}
              className={cardClass(on)}
            >
              <Sketch size={40} />
              <span>{t(CATEGORY_KEYS[category])}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={open === null && value === ""}
          disabled={disabled}
          onClick={() => {
            setOpen(null);
            onChange("");
          }}
          className={`${cardClass(open === null && value === "")} border-dashed px-1 text-center leading-tight`}
        >
          {t("caddie.club.notSure")}
        </button>
      </div>

      {open && (
        <div role="radiogroup" aria-label={t(CATEGORY_KEYS[open])} className="mt-2 flex flex-wrap gap-1.5">
          {CLUBS_BY_CATEGORY[open].map((club) => {
            const on = value === club;
            return (
              <button
                key={club}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => onChange(club)}
                className={`min-h-8 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                  on ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300"
                }`}
              >
                {clubLabel(club, t)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
