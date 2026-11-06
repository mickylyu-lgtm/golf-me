# After TestFlight

Feature ideas raised during the iOS/TestFlight transition phase that are deliberately deferred per the feature freeze, so they aren't lost. Not started. Do not build any of these until the first TestFlight build is working and Micky says go.

## Android app on Google Play (long-term)

Micky, 2026-11-06: expand to Google Play for Android users. Timing agreed: after the iPhone App Store launch plus a couple of weeks of stability fixes, not before (it doubles device testing for every change). Until then Android users use golfme.app in the browser / add to home screen.

Scope to plan first (golfme-architect, plan before build):
- Capacitor Android shell loading the same live web app (like iOS's server.url).
- Push via Firebase Cloud Messaging (today send-push is APNs only): device tokens per platform, send-push and notify-fanout routing.
- Native Google sign-in on Android; Apple sign-in through the web flow.
- Android versions of the app-local plugins: GolfMeMediaPicker (Android photo picker, one tap, multi-select, video) and GolfMeAppearance (system bars light/dark).
- Keyboard behaviour (adjustResize vs the iOS Body resize) tested separately; the frozen chat keyboard code is iOS-tuned.
- Google Play developer account ($25 once), store listing, Data safety form, content rating, internal testing track.
- Rough estimate: 1–2 weeks build and test, then a few days of Play review.

## Founder welcome bot / new-user tutorial

Automated bot account that DMs new users on signup, introducing Micky as GolfMe's founder and giving a brief tutorial of the key features (Play, Chat, Caddie, Community).

Needs scoping before building: one-time DM vs. revisitable/re-triggerable, exact copy/tone, whether it's a real bot "user" row in the DB (shows up in Chat like a normal conversation) or a separate system-message UI, and whether it's triggered by profile creation or by first onboarding completion.
