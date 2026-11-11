# Community video-player QA

## Scope and cause

Community swing posts handed a muted, looping, control-less feed video to fullscreen, unlike Caddie's Original/upload video. A refused native request fell back to a tap/hold overlay with no timeline. Gallery-video taps had no reliable refused-fullscreen fallback.

This change uses the existing Chat native-session lifecycle through a shared module, enabling and restoring platform controls, sound and loop state. Community retains the feed position. Caddie's analysis replay and coaching controls are unchanged. No media URL, storage, database or native-shell change.

## Automated checks

- npm run check: TypeScript, lint with no errors, 1,409 passing tests, production build and prerender.
- tests/nativeVideoPlayer.test.ts: 15 tests covering native and standard fullscreen, controls/audio/loop restoration, missing metadata, synchronous and silent refusal, repeated taps, quick dismiss, quiet cancel, superseding session, PiP, rejected playback and late rejection after cancel. Chat's existing API remains an alias of the shared session.
- scripts/check-community-video-ui.mjs: actual PostCard, MediaCarousel and FullscreenMediaViewer, generated 6-second test-pattern clip, synthetic golfer and dummy backend. Every external request is blocked.
- Browser viewports: 320×844, 390×844, 1440×844, 844×390. Cases include native controls/sound/full-frame fit, feed restoration, rejected-fullscreen fallback, seeking, keyboard open/focus/return, inactive-slide focus isolation, mixed-gallery pause and close, nested fullscreen cancellation, safe timeline touch exclusion, body swipe dismissal, and nested Modal/photo-viewer Escape.
- Chromium's native controls swallow normal Escape key events. A native dialog shell receives the platform cancel event, so the viewer closes correctly without replacing native controls.

Run UI QA with the installed Chromium executable and its library directory:

    CHROMIUM_EXECUTABLE=/path/to/chrome-headless-shell CHROMIUM_LIB_DIR=/path/to/libs node scripts/check-community-video-ui.mjs

## Screenshots and limits

Screenshots in artifacts.local/community-video-{native,fallback}-{width}.png show real Chromium rendering with synthetic test-pattern media. They are not iPhone captures or proof of iOS native chrome. Requested 390px screenshots were provided separately for user review.

WebKit events, refusal and PiP are modeled in unit tests. Physical iPhone/TestFlight testing is still needed for actual OS player presentation, sound and close gestures, rotation/notch safe areas, background/resume, VoiceOver and PiP/AirPlay. No new native build is required by this web-only change.

## Release

Independent review approved a3b6e6c; the final candidate includes origin/main b6161d9 with byte-identical player sources and fresh aggregate/UI passes. User reviewed screenshots and authorized publication. Published main 3d946a83ee870c1fcd524f3ad45178f00f41e6d5; exact-commit CI 43049511106 passed, golfme.app deployment dpl_5YNcTXazGwLdbKdPwYeF7A5wn4sE was READY, and public /community plus matching player assets returned 200.

## Compact Close follow-up

User feedback requested a smaller top-left button. The visible background is now 32×32px with a 16px X, centered in the existing 44×44px button. The button has a white 2px focus-visible outline and dark focus fill. Existing positioning, safe-area offsets, modal stack, dismissal and touch gestures are unchanged.

Fresh full check passed all 1,409 tests, TypeScript, lint (26 baseline warnings/0 errors), build and prerender. Independent browser runs passed all four viewports listed above. Added checks measure visible and hit-target geometry on photo and video viewers, verify the keyboard outline, and click outside the 32px circle but inside the 44px button to close only the nested photo viewer. All original playback, gesture, Escape and focus tests still pass.

Screenshots artifacts.local/community-close-{photo,video}-{width}.png use actual Chromium rendering with synthetic media. They are not physical-device captures. This follow-up does not change native iOS player chrome or establish physical iPhone/VoiceOver validation.
