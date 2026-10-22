// Shared interaction treatment for clickable cards (golfer cards, Golf Call
// cards, roster rows, My Rounds list items) — hover lift + shadow, a
// pressed state that settles back down, and a clear keyboard focus ring.
// The press reset is hover:active (only on devices that really hover): on a
// phone the hover lift never applies, so a bare active:translate only toggled
// a translate on every touch, which turns the card into a new stacking
// context and fixed-position containing block mid-scroll.
export const CLICKABLE_CARD_CLASS =
  "rounded-2xl border border-slate-100 bg-white shadow-sm shadow-slate-900/[0.03] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md hover:active:translate-y-0 active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0";
