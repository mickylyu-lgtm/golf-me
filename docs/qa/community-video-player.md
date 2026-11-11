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

Independent review approved a3b6e6c; the final candidate includes origin/main b6161d9 with byte-identical player sources and fresh aggregate/UI passes. User reviewed screenshots and authorized publication. Do not claim pushed/live until remote and deployment are verified.
