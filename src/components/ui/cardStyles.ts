// Shared interaction treatment for clickable cards (golfer cards, Golf Call
// cards, roster rows, My Rounds list items) — hover lift + shadow, a
// pressed state that settles back down, and a clear keyboard focus ring.
// The press reset is hover:active (only on devices that really hover): on a
// phone the hover lift never applies, so a bare active:translate only toggled
// a translate on every touch, which turns the card into a new stacking
// context and fixed-position containing block mid-scroll.
//
// No press scale here on purpose: :active also matches every ancestor of
// the pressed element, so a scale on this class would shrink a whole post
// or round card whenever a button inside it is pressed (and toggle a new
// stacking context on cards with playing video, see above). Cards that are
// one single tappable (the inbox rows) add CARD_PRESS_CLASS themselves.
export const CLICKABLE_CARD_CLASS =
  "rounded-2xl border border-slate-100 bg-white shadow-sm shadow-slate-900/[0.03] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md hover:active:translate-y-0 active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

// The press feel for buttons and single-tappable cards: a quick press-down
// scale (75 ms while held) that springs back on release with the element's
// own transition (200 ms ease-out on Button and the card class). `scale` is
// its own CSS property in Tailwind v4, so it composes with the hover lift
// (`translate`) instead of replacing it, and like any transform it never
// changes layout. Reduced motion drops the scale, the colour press stays.
export const PRESS_SCALE_CLASS = "active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100";
// Cards are large, so a smaller scale reads the same.
export const CARD_PRESS_CLASS = "active:scale-[0.985] active:duration-75 motion-reduce:active:scale-100";
// Small round icon buttons (the bell) need a bit more to be felt.
export const ICON_PRESS_CLASS = "active:scale-[0.92] active:duration-75 motion-reduce:active:scale-100";
