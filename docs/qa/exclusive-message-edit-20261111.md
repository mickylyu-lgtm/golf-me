# Exclusive inline message editing

## Scope

Local branch `fix/exclusive-message-edit`, based on `07cefa0e25d7520bf2b7d89d52f813f8f9942379`. No push or deployment.

The user's live-app correction was that inline editing must leave only one usable textbox, like iMessage. The send composer remains visible at 25% opacity, inert and hidden from assistive technology while editing. Its state and dimensions are retained. A transparent pointer shield prevents tapping the dimmed bar from blurring the active editor. The textarea and Send are disabled, both parent send handlers exit early, and an open desktop emoji popup closes.

No keyboard sizing/docking hooks, native-shell code, RPCs, ownership rules or five-minute server limit changed. In-flight voice work is not silently cancelled; new voice gestures are blocked while editing.

## Automated verification

- `npm run check`: TypeScript, lint, 1,266 tests, production build and prerender passed. Lint reports 26 existing warnings outside the changed files; no errors.
- Four new gate tests execute the actual composer/parent send handlers and render the pause wrapper: blocked sends do not acquire the duplicate-send lock, disabled clicks cannot refocus the composer, both thread handlers return before draft/media/network work, and mounted children become inert/hidden then restore.
- `scripts/check-message-edit-ui.mjs`: passed local synthetic Chromium checks with all non-local requests blocked and a dummy backend.
  - DM and round chat, both fullscreen and embedded card: exactly one accessible textbox during editing, disabled normal composer, inert controls, no Tab/programmatic focus into the paused composer.
  - Repeated clicks on the dimmed bar retain editor focus. No composer height jump.
  - Save, Cancel and Escape preserve the unsent draft. A blocked send followed by Cancel and normal Send produces exactly one new message.
  - A reply target, picked synthetic photo and voice-input mode survive editing. The emoji popup closes before edit focus is established.
  - Error, conflict, expired and unsent states keep the normal composer paused until editing closes; pending save does not permit sending another message.
  - Existing compact/growing sizes, 320/1440px layouts, IME confirmation, duplicate Save and late-response protections still pass. A resize check waits for the composer's existing ResizeObserver mirror measurement to settle.
  - No uncaught browser errors. All test data is synthetic; no real-account writes.

Run the browser checks with `CHROMIUM_EXECUTABLE` set to your installed Chromium and optional `CHROMIUM_LIB_DIR` for private browser libraries, then `node scripts/check-message-edit-ui.mjs`.

MGPC browser: `/home/shmick/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`.
MGPC library directory: `/home/shmick/.cache/golfme-chromium-libs/root/usr/lib/x86_64-linux-gnu`.

Screenshots (generated in ignored `artifacts.local`):
- `dm-inline-edit.png`: compact inline editor, dimmed unsent composer.
- `dm-inline-edit-expanded.png`: multiline editor growth.
- `round-inline-edit.png`: the same exclusive editor in round chat.

These are mobile-sized browser screenshots, not physical-iPhone/native-keyboard evidence.

## Device review still needed

1. On an iPhone, start with the composer focused, then long-press an own recent message and choose Edit. Repeat from a closed keyboard.
2. Confirm only the inline editor receives typing. Tap the dimmed composer, photo/voice controls and Send repeatedly: no focus transfer, keyboard dismissal, picker, recording or new message.
3. Save, Cancel and Escape with a text draft, reply and attachment waiting. Ensure all return and the draft sends once afterward.
4. Repeat in fullscreen round chat and the embedded round-detail card, including the card's existing docking/undocking.
5. Exercise an expired/failed save and VoiceOver: errors stay accessible, only the edit field is announced as usable, and the composer restores after closing.

Review on a preview before separately approving any production release.
