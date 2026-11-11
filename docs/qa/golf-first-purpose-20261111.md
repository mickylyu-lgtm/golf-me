# Golf-first purpose and community expectations

## Scope
- Signup/login and the first intro screen lead with finding golfers and playing rounds, and explicitly identify GolfMe as a golf community, not a dating app.
- Public golfer profiles make Invite to a round the first primary action, keep Message secondary, and put playing style and availability before the free-form bio/gallery. The small identity avatar remains; this is not a full profile redesign.
- Community has a direct Community Guidelines entry. All guidelines are now localized in the six supported languages, including unwanted romantic/sexual messages, advances and pressure, respecting refusal and requests to stop.
- Report/block instructions describe the existing menus. Removed the unsupported promise that every report is reviewed. This change does not introduce automated enforcement, a new report category or a response-time commitment.

## Preserved behavior
The existing invitation hook opens an editable, unsent DM draft, preserves any existing draft, and sends nothing automatically. Existing messaging permissions and both block directions are unchanged. No backend, migration, native-shell, authorization, matchmaking, profile-data, media or account-setup changes.

## Verification
- Full npm run check: TypeScript, lint, all 1,445 tests (none skipped), build and prerender passed. Lint retains the 28 warnings present on baseline main 72e3d3c and adds none.
- Four focused regressions: localization and purpose, semantic guidelines/discovery, profile action order/gates/golf facts, invitation draft preservation.
- Built-app Chromium: 648 assertions, all six locales at 320/360/390/1440 px. Covered intro next/skip and signup, guidelines entry/back/list structure, 150% and 200% guideline text, keyboard activation, primary/secondary action styles/order/44px targets, no horizontal overflow, Message without a seeded draft, invitation without sending, repeated invitation, existing-draft preservation, both block directions, and no runtime exceptions.
- Screenshot inspection: English/Spanish profiles, English/Japanese signup and Chinese guidelines. Existing installed Chromium, local preview on port 5203, dummy Supabase endpoint and all external browser requests blocked. No real-account or production data used.
- Independent source review: no actionable findings, including language meaning, original draft/gates and report-menu accuracy.
- React quality review: only render/copy changes; no new effects, subscriptions, network work or shared state. Native buttons, visible focus rings and semantic list items retained/added.

## Reproduction
npm run check

LD_LIBRARY_PATH=/home/shmick/.cache/golfme-chromium-libs/root/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=/tmp/caddie-qa-fonts.conf node scripts/check-golf-first-purpose-ui.mjs

The font configuration uses installed Windows fonts through WSL. Browser screenshots are local only under /tmp/golfme-purpose-qa-20261111. Machine-readable assertions are in golf-first-purpose-ui-results.json.

## Limits and next step
Physical iPhone/WebKit/VoiceOver and real-account Auth/PostgREST behavior were not tested. No claim of automated content moderation or guaranteed report response. Rebased onto tutorial main b63a843. Only DEVELOPMENT_STATUS.md conflicted; both milestones are retained. The application/test diff is byte-identical to the independently reviewed patch (SHA-256 09c896604366612beb4766a2309008fcfeda5d6e36e7164b7cd5ade5cf999711). Integrated aggregate checks and all 648 browser assertions passed again. Tutorial CI/production verification cleared the release slot. Use the user's explicit push approval for a normal fast-forward. Verify exact-commit CI and the production alias before calling it live.
