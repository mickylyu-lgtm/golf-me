import { useState } from "react";
import type { KeyboardEvent } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { labelClass } from "../ui/FormControls";
import { CLUB_CATEGORIES, CLUBS_BY_CATEGORY, clubAfterCardTap, clubCategoryOf, isCatalogClub } from "../../lib/clubCatalog";
import type { ClubCategory } from "../../lib/clubCatalog";
import { clubLabel } from "../../lib/clubLabel";
import { CLUB_ART, ClubArtDefs } from "./clubSketches";

// Caddie's "I'm hitting..." club choice (replaced a <select>, 2026-11-06):
// a scrollable row of category cards, each with an illustration of that
// club head (clubSketches.tsx), then chips for the exact club. Required:
// Ask Caddie stays disabled until a club is picked (no "Not sure", Micky
// 2026-11-06: the club can't be detected reliably yet). The label says
// "(required)", and an opened category with no chip picked says "Pick your
// exact club" in text (never colour alone). A card picks a club by itself
// only when its category has exactly one (onlyClubIn); none does today.
// Both rows are radiogroups of role="radio" buttons, which also gives each
// pick the app's light selection haptic (lib/tapFeedback). Every radio is
// a Tab stop; the arrow keys, Home and End also move focus within a row
// (focus only: Space/Enter picks, so arrowing past cards never clears a club).
// Motion: a card lifts slightly on hover/press; picking one tilts and
// settles its head and sweeps one shine across it (index.css
// club-settle / club-shine; transform and opacity only, collapsed under
// reduced motion). Nothing animates for the card restored from a draft.

const CATEGORY_KEYS: Record<ClubCategory, TranslationKey> = {
  driver: "club.category.driver",
  wood: "club.category.wood",
  hybrid: "club.category.hybrid",
  iron: "club.category.iron",
  wedge: "club.category.wedge",
};

const PICK_HINT_ID = "caddie-club-pick-hint";

// Inset ring: the card row scrolls (overflow-x), which would clip an outer outline.
const cardClass = (on: boolean) =>
  `flex h-[88px] w-[84px] shrink-0 snap-start flex-col items-center justify-end gap-1 rounded-2xl border pb-2 text-[11px] font-semibold transition-[transform,border-color,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fairway-500 disabled:opacity-40 disabled:hover:translate-y-0 ${
    on
      ? "border-fairway-500 bg-fairway-50 text-fairway-700 shadow-[0_4px_14px_-6px_rgba(21,128,61,0.45)]"
      : "border-slate-200 bg-white text-slate-500 hover:border-fairway-300"
  }`;

/** Arrow keys / Home / End move focus between the radios of one group. */
function moveFocusInGroup(event: KeyboardEvent<HTMLDivElement>) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (step === undefined && event.key !== "Home" && event.key !== "End") return;
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  if (radios.length === 0) return;
  const current = radios.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1 : (current + (step ?? 0) + radios.length) % radios.length;
  event.preventDefault();
  radios[next].focus();
  radios[next].scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function ClubPicker({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useLocale();
  // Which category's chips are showing: the saved club's, else none.
  const [open, setOpen] = useState<ClubCategory | null>(() => clubCategoryOf(value));
  // Bumped on every card tap; keys the art so its settle + shine replay.
  const [picks, setPicks] = useState(0);
  // An opened category still waiting for its exact club.
  const needsChip = open !== null && !(isCatalogClub(value) && clubCategoryOf(value) === open);

  return (
    <div
      data-testid="caddie-club-picker"
      // Shadow and rim light per theme (adjusted, never inverted).
      className="[--club-rim:0.55] [--club-shadow:rgba(15,23,42,0.42)] dark:[--club-rim:0.9] dark:[--club-shadow:rgba(0,0,0,0.85)]"
    >
      <ClubArtDefs />
      <p className={labelClass}>{t("caddie.club.requiredLabel")}</p>
      <div
        role="radiogroup"
        aria-label={`${t("caddie.club.requiredLabel")}: ${t("caddie.club.typeLabel")}`}
        aria-required="true"
        onKeyDown={moveFocusInGroup}
        className="-mt-1 flex snap-x gap-2 overflow-x-auto pt-1 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {CLUB_CATEGORIES.map((category) => {
          const Art = CLUB_ART[category];
          const on = open === category;
          const animate = on && picks > 0;
          return (
            <button
              key={category}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              data-club-card={category}
              onClick={() => {
                setOpen(category);
                setPicks((n) => n + 1);
                // The card is the club only when its category has exactly one;
                // a club from another card is no longer what was picked.
                const next = clubAfterCardTap(category, value);
                if (next !== value) onChange(next);
              }}
              className={cardClass(on)}
            >
              <span key={animate ? `${category}-${picks}` : category} className={`block ${animate ? "animate-club-settle" : ""}`}>
                <Art width={76} shine={animate} />
              </span>
              <span>{t(CATEGORY_KEYS[category])}</span>
            </button>
          );
        })}
      </div>

      {open && (
        <>
          <div
            role="radiogroup"
            aria-label={t(CATEGORY_KEYS[open])}
            aria-required="true"
            aria-describedby={needsChip ? PICK_HINT_ID : undefined}
            onKeyDown={moveFocusInGroup}
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {CLUBS_BY_CATEGORY[open].map((club) => {
              const on = value === club;
              return (
                <button
                  key={club}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  data-club-chip={club}
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
          {needsChip && (
            <p id={PICK_HINT_ID} className="mt-1.5 text-xs text-slate-500">
              {t("caddie.club.pickExact")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
