# Caddie feedback text cleanup — 2026-11-11

## Finding and scope

The reported finish explanation includes "Constraints遵守。 Analysis completed successfully." That phrase is not an app translation literal. The finish card renders analysis_json.score.finish.reason from saved model prose. Generation previously accepted any nonempty summary with a few structural fields and saved the score reasons without content cleanup. Translation sent the original prose with an instruction to preserve every claim. The requested locale was recorded as the result's language; same-locale rows skip further translation. Missing translated score reasons also fell back to the source language.

This establishes the persistence/translation/display failure path, not which of the two model calls originally introduced the exact phrase. No production record, model response, customer media, or logs containing customer prose were read to attribute the original emission.

## Fix

- A shared pure helper removes only whole known completion/compliance sentences in English, mixed English/Chinese, simplified/traditional Chinese, Spanish, Japanese and Korean. It does not remove English words generally, physical-constraint coaching, camera limitations, numbers, or golf vocabulary.
- The real saved-row mapper cleans every known prose field and legacy flat fields on read. Existing same-locale rows and older rows without language metadata are covered immediately after frontend release, with no data rewrite.
- Generation adds a concise content rule, cleans output, and validates required prose inside the existing bounded provider-retry path before the JSON and mirrored columns are saved.
- Translation cleans source and response. Invalid source is rejected before budget/provider work. Missing required reasons or dropped array items fail before writes instead of falling back to an old-language reason. Original points, phases, confidence, enums and extension metadata remain unchanged.
- Known boilerplate-only optional list entries are dropped, while originally empty/malformed entries remain invalid. A drill must retain at least one real step. A wholly missing required explanation is never fabricated.
- No database migration, RLS/auth change, new dependency, native-shell change, altered analysis allowance, or new background retry.

## Verification

- tests/caddieFeedbackText.test.ts: 12 synthetic tests, including the exact reported phrase, all six locale choices, negative/false-positive cases, every prose field, immutability, production row mapper, actual translation handler with isolated service doubles, partial translations, same-locale no-op, invalid-source quota behavior and metadata preservation.
- tests/requestBudget.test.ts: existing translation rate-limit assertions unchanged; its incomplete synthetic source row now contains the required prose so it reaches the budget guard.
- Full npm run check: final result recorded in the development status section. TypeScript, lint, every test, build and prerender use a dummy backend. Baseline lint warnings and bundle-size warning are not introduced by this fix.
- Deno 2.9.8: both changed Edge Functions typecheck with --no-lock --node-modules-dir=none and a local-only declaration for the existing Supabase EdgeRuntime.waitUntil host global. Stock functions-js declarations omit that global; this declaration is not shipped. This is type checking, not deployed-bundle validation.
- scripts/check-caddie-feedback-ui.mjs: 213 focused Chromium assertions at 320/390/1440 px. It extracts the real mapper and score JSX, supplies synthetic old records, switches all six languages, tests missing/recorded language and repeated close/reopen, and verifies all five explanations, unchanged points, no horizontal overflow or runtime errors. This is not authenticated full-page testing. External browser requests are blocked.
- Screenshot at 390 px inspected: actual score labels and explanations render in Chinese without status text. Local test font may be supplied through QA_CJK_FONT when the WSL host lacks CJK fonts; it only goes into ignored artifacts, not production assets.

Run focused rendering on MGPC:
QA_CJK_FONT=/mnt/c/Windows/Fonts/msyh.ttc LD_LIBRARY_PATH=/home/shmick/.cache/golfme-chromium-libs/root/usr/lib/x86_64-linux-gnu node scripts/check-caddie-feedback-ui.mjs

## Review and release

Independent review caught and corrected the optional-list validation issue, quota ordering and opaque-score metadata preservation. Reviewer independently checked the supplied sanitizer logic and reviewed the endpoint harness.

Release frontend code through the coordinated main/Vercel path. Future-output prevention additionally requires deployment of only analyze-swing and translate-caddie-analysis, including their new shared import. No schema or data cleanup step is needed. Verify published commit, CI, production alias, exact deployed function bundles and unauthenticated rejection before declaring the complete fix live.

## Limits

No paid Gemini/Roboflow request, production translation/save, customer-record rewrite, physical iPhone/WebKit test or exact screenshot-record inspection. Arbitrary model phrasing cannot be exhaustively recognized by a narrow lexical filter. The fix deliberately retains unknown prose rather than risking deletion of genuine coaching, and does not claim to detect every wrong-language sentence. Metadata-only required fields on historical records fail translation safely rather than inventing advice.
