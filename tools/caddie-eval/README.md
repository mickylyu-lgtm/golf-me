# tools/caddie-eval

Local-only, consent-gated import of Caddie V2 evaluation clips, and the local (offline) pose prototype that processes them. The full process, storage, and retention rules are in `docs/caddie-v2/VIDEO_IMPORT_AND_CONSENT.md`; the consent form is `docs/caddie-v2/consent/CONSENT_FORM_v1.html` (form version 1.1). Read those first.

- `import-clip.mjs`: `init`, `consent-add`, `import`, `status`, `verify`, `coach-check`, `third-party-check`, `coach-add`, `coach-revoke`, `coach-session-check`, `withdraw`, `retention`. Usage is in the file header.
- Data lives in `GOLFME_EVAL_DATA_DIR` (default `~/golfme-eval-data`), never in this repo. The tool refuses a folder inside any git checkout or a cloud-sync folder.
- Consent records must be affirmative (signed form, adult, current form version) and keep clips at most **90 days**.
- **Third-party gate:** any future Roboflow/Gemini baseline runner must call `assertThirdPartyAllowed(dataDir, clipId, processor)` for every clip before sending it. It refuses unless the vendor is marked approved in `VENDOR_TERMS_VERIFIED` (both `null` today), including the date of a **written no-training commitment** (`noTrainingConfirmedOn`; see `docs/caddie-v2/VENDOR_APPROVAL_CRITERIA.md`), **and** the contributor ticked that processor's opt-in. Spend approval is a separate requirement.
- **Coach gate:** run `coach-session-check --coach K01 [--remote]` on the day of every coach session. It refuses unless the coach has a recorded, signed confidentiality agreement (`coach-add`, current version `1.0`, pseudonymous record only), the coach is cleared for that session type, at least one clip is eligible, and, for remote, the screen-share platform is reviewed and under 30 days old (`SCREEN_SHARE_PLATFORM_REVIEW`, `null` today; Google Meet is the only accepted platform; see `docs/caddie-v2/COACH_REVIEW_PROCEDURE.md`). `verify` also checks label files: `labels/<clip ID>-<coach ID>.json`, protocol fields only, known coach.
- `import-clip.mjs` makes no network calls and needs nothing beyond Node. Optional `ffmpeg`/`ffprobe` on PATH (or `GOLFME_EVAL_FFMPEG` / `GOLFME_EVAL_FFPROBE`) strip and check audio and metadata. Without a system ffmpeg, `GOLFME_EVAL_FFMPEG=$PWD/node_modules/ffmpeg-static/ffmpeg` works (no ffprobe, so `metadataVerified` stays `null`). Pass-2 rating fields (`p2_*`) are validated against `PROTOTYPE_CAPABILITIES`: an unimplemented item only accepts `not_implemented`.

## Local pose prototype

What it is, versions, hashes, measured numbers, and limitations: `docs/caddie-v2/MEDIAPIPE_POC.md`. Every command below first calls `assertLocalProcessingAllowed()` (active consent, stripped, sha256 intact) and writes only to `<data folder>/derived/<clip ID>/`.

| Command | Does |
|---|---|
| `node tools/caddie-eval/fetch-models.mjs [--check]` | Downloads (or only verifies) the Pose Landmarker Full and Heavy files into `GOLFME_EVAL_MODEL_DIR` (default `~/.cache/golfme-caddie-eval/models`, outside the repo). Refuses a sha256 that differs from `models/models.json`. The only network step; a public file, no clip data |
| `node tools/caddie-eval/pose-local.mjs --clip C001-0001 [--variant full\|heavy] [--fps N] [--max-side 1280] [--delegate CPU\|GPU]` | Runs MediaPipe in headless Chromium with all network blocked; writes `mediapipe-<v>.raw.json`, `pose-mediapipe-<v>.json` (PoseSequence v1), `pose-mediapipe-<v>.run.json` (provenance, timing, CPU/memory, network log) |
| `node tools/caddie-eval/run-v2-checks.mjs --clip C001-0001 \| --all [--variant ...]` | Quality gate + camera-angle heuristic on the derived pose; writes `v2-checks-mediapipe-<v>.json` |
| `node tools/caddie-eval/render-overlay.mjs --clip C001-0001 [--variant ...]` | Draws confident keypoints on the clip for coach pass 2; writes `overlay-mediapipe-<v>.mp4` (local only, never sent) |
| `node tools/caddie-eval/pose-accuracy.mjs --clip C001-0001 --labeler K01 \| --all` | PCK@0.1/0.2, abstention, confident-wrong against `keyframe_keypoints` labels |

Headless Chromium on WSL may fail with a missing `libnspr4.so` / `libnss3.so` / `libasound.so.2`. Either install them (`sudo apt install libnspr4 libnss3 libasound2t64`) or, without sudo, unpack the Ubuntu packages into a user folder (`apt-get download libnspr4 libnss3 libasound2t64` then `dpkg -x <deb> ~/.cache/golfme-chromium-libs/root` for each). The extractor uses `~/.cache/golfme-chromium-libs/root/usr/lib/x86_64-linux-gnu` automatically if it exists, or `GOLFME_EVAL_CHROMIUM_LIB_DIR`. `GOLFME_EVAL_CHROMIUM` points at a different browser binary.

## Tests

- `node --test tools/caddie-eval/test/*.test.mjs`: temp folders, fake bytes, and synthetic stick-figure poses only. No browser, no network.
- `CADDIE_EVAL_SMOKE=1 node --test --test-name-pattern=smoke tools/caddie-eval/test/pose-local.test.mjs`: opt-in end-to-end run of the real browser, model, and ffmpeg on a synthetic test pattern (no person). Needs the cached models and Chromium.
- The MediaPipe adapter's tests are in Vitest: `npx vitest run`.
