// text-base (16px), not text-sm -- iOS auto-zooms the whole page when a
// focused input's font-size is under 16px, meant to make small text
// legible while typing. Real mobile Safari resets that zoom on blur; the
// native app's bare WKWebView doesn't do so reliably, so it got stuck
// zoomed in after focusing any input, on every screen, until the app was
// force-quit. 16px is below the trigger threshold everywhere, so it never
// fires in the first place. (Only the plain-website experience -- outside
// the native app -- was unaffected, since Safari's own reset masked it.)
export const inputClass =
  "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-base text-slate-800 outline-none transition focus:border-fairway-400 focus:ring-2 focus:ring-fairway-100";
export const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500";
