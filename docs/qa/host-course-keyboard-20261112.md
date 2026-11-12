# Host Round course search above the keyboard

## Observed report and root cause
User's iPhone screenshot shows lower course choices covered by the software keyboard. Code reserved about 132px under the input while the results panel could be 256px tall, with no actual keyboard-height maximum. Browser/Safari had no equivalent reveal. No production account or provider call was used to reproduce; the browser fixture executes the actual component with synthetic course results and keyboard/visualViewport signals.

## Change
CourseAutocomplete inline mode intersects native resize:body keyboard bounds and visualViewport bounds without double subtraction. It minimally reveals the input plus results, constrains the internally scrollable list to the remaining visible band, and recomputes sizing during page/viewport scrolling without re-revealing on deliberate scrolling. Quick-pick/input resizing can reveal only while focus is live. Dismissal, blur and unmount cancel reveal. Web scroll room survives blur until viewport recovery. Desktop Enter retains input focus. Active keyboard options scroll inside the results only; query/IME and known-course selection callbacks remain unchanged. Narrow course labels wrap.

Modal consumers, frozen chat keyboard code, native plugins, backend, search requests, quotas, database, moderation and credentials are untouched.

## Checks
- npm run check passes TypeScript, lint (28 baseline warnings/zero errors), all 1,511 tests, build/prerender. Chromium and WebKit each pass 99 assertions.
- tests/courseSearchViewport.test.ts: native bounds, Safari panning, no double subtraction, bounded panel and header gap.
- scripts/check-course-search-ui.mjs: actual component in StrictMode, synthetic data only; Chromium and WebKit; native body and Safari viewport modes at 320x667,390x844,844x390,1440x900. Field/list bounds, six results, scrolling and selecting the last row, keyboard navigation/Enter, desktop focus, no query/status jumps, delayed keyboard recovery after blur, Escape after deliberate page scroll, keyboard dismissal and unmount while revealing. External browser requests are blocked.
- Independent review caught desktop blur and delayed Safari spacer removal; both corrected before release.
- Screenshots under artifacts.local/course-search are local synthetic previews, not physical device screenshots.

## Limits
No physical iPhone/Capacitor plugin, real-account/course provider, VoiceOver or on-device momentum verification. Extremely cramped landscape/enlarged text must prioritize the input; dismissing the keyboard remains available to regain the full results area. Browser keyboard/viewport inputs are synthetic, though layout, React effects and scroll behavior are real engines.

Parent confirmed user authorization to push safe GolfMe fixes. Final review is clear. Publish and verify exact-commit CI and production before reporting live.
