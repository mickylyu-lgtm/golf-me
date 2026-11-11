# User-flow bug fixes: 2026-11-11

Base: main `f5d3329`. Isolated branch `fix/scan-user-flows-20261111`.

## Scope

1. Comments and replies retain visible submitted text until success. Delayed failure does not overwrite edits. Success clears only the unchanged submitted revision. Per-key draft tokens and the sign-out generation protect post/account changes; a late success cleans up only the unchanged original persisted draft, including after unmount. Remounted composers observe that cleanup. Rapid duplicate sends are guarded synchronously.
2. Edit Tee Time cannot save without finite course/town coordinates. Typing a different course clears stale coordinates and offers the same translated course-town picker as hosting. Name-only locations cannot pass the guard. Existing coordinates survive a time-only edit.
3. Creating a round from an owned post links it in real and demo modes. The real update is scoped to the author and an unlinked post and verifies a returned row. Linking is bounded to eight seconds and does not wait for a full feed refresh. Uncertain/failed links open the already-created round and display accurate copy in all six languages; they never retry hosting. The action is not offered on someone else's post.

No database migration, Edge Function change, production data mutation, native build, or credential change.

## Validation

- Existing 1,300-test baseline passed before editing.
- New regression tests cover pending success/failure, newer edits, same-text retyping, duplicate sends, post/account changes, unmount/remount, blocked/full storage, external-tab edits, coordinate boundaries, the exact real/demo host handlers, failed/uncertain post linking and the link deadline.
- Final aggregate `npm run check` passed: TypeScript, lint (26 existing warnings, zero errors), all 1,336 tests (zero failures/skips), production build and landing prerender with a dummy backend. Existing large-chunk build warnings remain.
- Final browser run passed at all three widths. `scripts/check-scan-user-flows-ui.mjs` exercises the actual comment hook, Edit Tee Time modal, course autocomplete and nested LocationPicker at 320/390/1440 px. Providers use synthetic data. Every nonlocal browser request is blocked. Covers late responses, account/post switching, unmount success, missing coordinates, name-only rejection, nested Escape, town selection and saved coordinates. Screenshots stay in ignored `artifacts.local/`.
- Independent review identified and prompted additional fixes for stale-success draft cleanup and unbounded post-link waits. Final review and final check totals are recorded in the release handoff.

Run UI checks with the installed `CHROMIUM_EXECUTABLE`, optional `CHROMIUM_LIB_DIR`, then `node scripts/check-scan-user-flows-ui.mjs`.

## Limits

Synthetic Chromium does not verify physical iPhone keyboard behavior, native lifecycle, or real Supabase writes. No production accounts were changed for testing. Backend RLS remains authoritative; the client adds author scoping and honest partial-failure handling. A timed-out link write can still complete later, so the warning says its outcome could not be confirmed.


## Final integration preflight

- Integrated the then-current main/admin release `ea54fac` without source conflicts; the documentation conflict preserves both handoffs.
- Independent review additionally reproduced full-storage and external-tab races. Draft tokens now invalidate before persistence attempts, notifications happen only after successful same-page writes, and successful cleanup also compares the persisted text. Cross-tab events do not replace the current in-memory editor. Exact regressions cover both active and unmounted requests.
- Integrated aggregate check passed 1,336 tests, zero failures/skips, 26 baseline lint warnings, TypeScript/build/prerender. Synthetic browser checks passed all three widths again. Final independent sign-off and exact-commit remote CI/deployment verification are still required before claiming live.
