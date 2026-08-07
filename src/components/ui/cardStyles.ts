// Shared interaction treatment for clickable cards (golfer cards, Golf Call
// cards, roster rows, My Rounds list items) — hover lift + shadow, a
// pressed state that settles back down, and a clear keyboard focus ring.
export const CLICKABLE_CARD_CLASS =
  "rounded-2xl border border-slate-100 bg-white shadow-sm shadow-slate-900/[0.03] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0";
