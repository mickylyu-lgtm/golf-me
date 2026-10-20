# tools/caddie-eval

Local-only, consent-gated import of Caddie V2 evaluation clips. The full process, storage, and retention rules are in `docs/caddie-v2/VIDEO_IMPORT_AND_CONSENT.md`; the consent form is `docs/caddie-v2/consent/CONSENT_FORM_v1.html` (form version 1.1). Read those first.

- `import-clip.mjs`: `init`, `consent-add`, `import`, `status`, `verify`, `coach-check`, `third-party-check`, `coach-add`, `coach-revoke`, `coach-session-check`, `withdraw`, `retention`. Usage is in the file header.
- Data lives in `GOLFME_EVAL_DATA_DIR` (default `~/golfme-eval-data`), never in this repo. The tool refuses a folder inside any git checkout or a cloud-sync folder.
- Consent records must be affirmative (signed form, adult, current form version) and keep clips at most **90 days**.
- **Third-party gate:** any future Roboflow/Gemini baseline runner must call `assertThirdPartyAllowed(dataDir, clipId, processor)` for every clip before sending it. It refuses unless the vendor is marked approved in `VENDOR_TERMS_VERIFIED` (both `null` today), including the date of a **written no-training commitment** (`noTrainingConfirmedOn`; see `docs/caddie-v2/VENDOR_APPROVAL_CRITERIA.md`), **and** the contributor ticked that processor's opt-in. Spend approval is a separate requirement.
- **Coach gate:** run `coach-session-check --coach K01 [--remote]` on the day of every coach session. It refuses unless the coach has a recorded, signed confidentiality agreement (`coach-add`, current version `1.0`, pseudonymous record only), the coach is cleared for that session type, at least one clip is eligible, and, for remote, the screen-share platform is reviewed and under 30 days old (`SCREEN_SHARE_PLATFORM_REVIEW`, `null` today; see `docs/caddie-v2/COACH_REVIEW_PROCEDURE.md`). `verify` also checks label files: `labels/<clip ID>-<coach ID>.json`, protocol fields only, known coach.
- No network calls. No dependencies beyond Node. Optional `ffmpeg`/`ffprobe` on PATH (or `GOLFME_EVAL_FFMPEG` / `GOLFME_EVAL_FFPROBE`) strip and check audio and metadata.
- Tests: `node --test tools/caddie-eval/test/*.test.mjs` (temp folders and fake bytes only).
