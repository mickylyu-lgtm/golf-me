# Caddie V2: local-only pilot workflow (proposal)

Status: **proposal, 2026-10-20. Not run. Nothing here is installed.** This is the safest end-to-end workflow for the 10-clip pilot that I can propose: **no clip, frame, or derived data leaves Micky's laptop**, except the live picture in a reviewed screen-share for the remote coach. Roboflow and Gemini are not used (`VENDOR_APPROVAL_CRITERIA.md` §6). Every install or download below needs Micky's approval first.

Related: `PILOT_CHECKLIST.md` (the day itself), `VIDEO_IMPORT_AND_CONSENT.md` (rules), `COACH_REVIEW_PROCEDURE.md` (coach sessions), `TESTING_PROTOCOL.md` (what's filmed and labeled), `EVAL_REPORT_TEMPLATE.md` (the report).

## 1. The workflow in one table

| # | Step | Where | Tool / doc | Status |
|---|---|---|---|---|
| 1 | **Consent** signed on paper or PDF before filming; recorded pseudonymously | Paper/identity key; data folder | Form v1.1; `consent-add` | Ready |
| 2 | **Filming** on Micky's phone, cloud photo backup off | Phone | `PILOT_CHECKLIST.md` §2 to 3 | Ready |
| 3 | **Transfer** by USB cable or AirDrop to a temp folder outside the repo and any synced folder | Laptop | `PILOT_CHECKLIST.md` §5 | Ready |
| 4 | **Consent check + import**: refuses without active affirmative consent; strips audio and metadata; pseudonymous clip IDs; sha256 | Data folder | `import --require-strip`, `verify` | Ready (needs ffmpeg in WSL) |
| 5 | **Cleanup**: delete temp folder, phone copies, phone "Recently Deleted" | Phone, laptop | `PILOT_CHECKLIST.md` §7 | Ready |
| 6 | **Local pose extraction**: every frame of each stored clip through a local model, written as a `PoseSequence` JSON in `derived/<clip ID>/` | Laptop, offline | **Not built**; proposal in §3 to §4 | **Blocked: install approval** |
| 7 | **V2 checks** on the local pose: quality gate, camera-angle heuristic | Laptop | `src/lib/caddie/v2/qualityGate.ts`, `cameraAngle.ts` (exist, unit-tested on synthetic data) | Needs step 6 and a small runner |
| 8 | **Coach labeling**, pass 1 (blind): K01 in person, K02 by reviewed screen-share | Laptop; live call | `coach-session-check`, `COACH_REVIEW_PROCEDURE.md` | **Blocked: coaches, agreements, platform review** |
| 9 | **Keypoint labels** on the key frames of a subset (address, top, impact), by Micky (geometry, not coaching) | Laptop | `TESTING_PROTOCOL.md` §8 "Key-frame keypoints" | Needs a frame-export step inside `derived/` |
| 10 | **Scoring**: local pose vs keypoint labels; quality gate and angle vs coach `analyzable` and `camera_angle`; coach-vs-coach agreement | Laptop | Scoring harness: **not built** | Needs steps 6 to 9 |
| 11 | **Report**: clip IDs and numbers only, no video, frames, or names | Repo (`eval-reports/`) | `EVAL_REPORT_TEMPLATE.md` | Template ready |
| 12 | **Retention**: weekly `retention`; withdrawal within 7 days | Data folder | `retention --apply`, `withdraw --confirm` | Ready |

What the pilot **can't** measure: V1 (today's Caddie) on these clips, since that means Roboflow and Gemini; and coach pass 2 on V1 feedback. The pilot measures the local pose source, the V2 checks, the process, and coach agreement. That is enough to decide go/no-go for the other 66 clips.

## 2. Why local pose for the pilot

- Micky's decision: Roboflow gets no clips without a written no-training commitment for our configuration, and the consent form isn't weakened. Gemini is blocked until its checklist is done.
- A local model keeps the promise in form §4 ("not uploaded") without depending on any vendor's terms. Nothing to verify, nothing to delete elsewhere.
- The V2 plan already wants an on-device or in-browser pose source (`CADDIE_V2_AUDIT.md` §7.3). Measuring one now, on coach-labeled clips, is directly useful for V2, whereas a Roboflow baseline mainly measures V1.

## 3. Local pose sources compared

Facts from public pages read by the assistant on 2026-10-20 (**unverified**: confirm before relying on them). "From memory" marks anything not read on a page.

Our contract is `PoseSequence` with 13 keypoints (`src/lib/caddie/v2/types.ts`): nose, shoulders, elbows, wrists, hips, knees, ankles, golfer's anatomical left/right, missing = not observed.

| | **MediaPipe Pose Landmarker** (BlazePose GHUM) | **Apple Vision 2D** (`VNDetectHumanBodyPoseRequest`) | **Apple Vision 3D** (`VNDetectHumanBodyPose3DRequest`) | **MoveNet** (Lightning / Thunder) | **RTMPose** (MMPose) | Ultralytics YOLO-pose | OpenPose |
|---|---|---|---|---|---|---|---|
| Licence | Code samples Apache 2.0 per the guide; MediaPipe repo Apache 2.0 (from memory). Model card PDF not read: **check the model's own licence** | Apple platform API (no separate licence) | Apple platform API | Code samples Apache 2.0 per the TF Hub tutorial; model licence on the model page not read | MMPose repo LICENSE: **Apache 2.0** (read). Weights trained on COCO and other datasets: check dataset terms for commercial use | **AGPL-3.0** by default; commercial or networked use needs an Enterprise licence (read on ultralytics.com/license). **Excluded** | Non-commercial academic licence (from memory, not checked). **Excluded** |
| Runs locally, offline | Yes: "optimized for on-device" per the guide; Python, Web (WASM), Android, iOS | Yes, on-device (Apple frameworks run locally; from memory) | Yes, on-device | Yes: TFLite and TF.js | Yes: ONNX Runtime on CPU, ncnn on mobile, CoreML via MMDeploy (README) | Yes | Yes |
| Keypoints | 33 landmarks, superset of our 13 (nose 0, shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24, knees 25/26, ankles 27/28); also heels, feet, hands; world (metric) coordinates too | 19 joints (read on the JointName page): nose, eyes, ears, neck, shoulders, elbows, wrists, root, hips, knees, ankles. **Superset of our 13** | 17 joints including topHead and centerShoulder; **no nose** (from memory; the doc page listing wasn't readable) | 17 COCO keypoints, superset of our 13 | COCO 17, Halpe 26, or WholeBody 133 | COCO 17 | 18/25 body points |
| Accuracy evidence | The guide gives **no benchmark numbers**. Model card not read | Apple publishes no accuracy figures that I found | Same | The tutorial gives **no accuracy numbers** | COCO AP 72.2 / 75.8 / 76.5 for RTMPose-s / m / l at 256x192 (README). General COCO, **not golf** | n/a | n/a |
| Platform fit | **Web (in-browser) and iOS**, plus Python on the laptop. Matches the V2 web pose plan (`CADDIE_V2_AUDIT.md` §7.3) | iOS/macOS only; needs a Capacitor plugin and an App Store build for the app; can't run in WSL. For the pilot, only on a Mac | iOS 17+ / macOS 14+ (read); same constraints | Web (TF.js) and mobile | Laptop (Python/ONNX). Web and iOS deployment are possible but more work | — | — |
| Video mode | Has a video running mode with tracking between frames | Per image, or a sequence handler (from memory) | Per image | Per image (single person) | Per image, needs a person detector first | — | — |
| Cost | Free | Free | Free | Free | Free | — | — |

**Golf-specific evidence is thin.** I found no public 2D pose benchmark on golf swings for any of these. One peer-reviewed workshop paper (Ingwersen, Jensen, Hannemose, Dahl, *Evaluating current state of monocular 3D pose models for golf*, NLDL 2023, <https://orbit.dtu.dk/en/publications/evaluating-current-state-of-monocular-3d-pose-models-for-golf/>, abstract read 2026-10-20) compared state-of-the-art monocular **3D** models with marker-based motion capture on golf swings and found errors large enough that the predictions were unsuitable for kinematic analysis, even when they looked convincing on the image. That argues against relying on 3D output (Apple Vision 3D, MediaPipe world coordinates) for measurements before our own validation, and for measuring 2D accuracy ourselves on the coach/Micky keypoint labels (step 9). Fast downswing blur and crossed hands are the expected failure points (`CADDIE_V2_AUDIT.md` §10).

### Recommendation for the pilot

**MediaPipe Pose Landmarker (2D landmarks, Full model; Heavy as a comparison if time allows), run locally on the laptop.** Reasons:

1. **Private by construction**: runs fully offline once the model file is on disk; no account, key, or terms to verify.
2. **Licence is permissive** (Apache 2.0 code; the model's own licence still to check), unlike Ultralytics (AGPL) or OpenPose (non-commercial).
3. **Covers our 13 keypoints** with a direct mapping, plus a per-landmark visibility score for the "not observed" rule.
4. **It's the realistic V2 web path**: the same model runs in the browser (WASM) and on iOS, so pilot numbers carry over to production, unlike RTMPose (laptop-first) or Apple Vision (no web, no WSL).
5. Runs on the Windows/WSL laptop; Apple Vision would need a Mac for the pilot.

**Apple Vision 2D stays the iOS candidate** (Micky has accepted a native plugin, audit §7.3). Benchmark it on the same clips later on a Mac or iPhone, still local, as Milestone 3 prep. **RTMPose** is the optional accuracy cross-check if MediaPipe struggles on the downswing, since it reports the best general COCO numbers here.

Backend ID: `PoseBackend` today has `"browser_model"`, which fits. If more than one local model is compared, add a specific ID (e.g. `"mediapipe_pose_landmarker"`) to `src/lib/caddie/v2/types.ts` so results are never mixed; that's a small typed change, not done yet.

Checks before trusting the mapping: MediaPipe's and Vision's "left" should be the person's anatomical left (from memory); confirm on one clip of Micky's own. Apple Vision's normalized coordinates have their origin at the bottom-left (from memory), so y must be flipped into `PoseSequence`'s top-left space.

## 4. Proposed local extractor (not built; needs approval)

**Option 1 (proposed): browser runtime, offline, in the existing headless Chromium.**

- Install: `@mediapipe/tasks-vision` as a **devDependency** (exact version pinned), plus the `pose_landmarker_full.task` model file downloaded **once** into a folder outside the repo (or a gitignored cache). Both need Micky's approval; the download sends no clip data.
- Run: a `tools/caddie-eval/pose-local.mjs` script uses `playwright-core` (already a devDependency) to open a local page, loads the model from a `file://` path, plays the stored clip frame by frame, and writes `derived/<clip ID>/pose-mediapipe-full.json` (`PoseSequence`). All non-`file://` requests blocked, the same way `render-consent-pdf.mjs` does it.
- Before reading a clip it calls a new local-use check (consent active, clip stripped). No vendor gate is needed because nothing leaves the machine.
- No frames saved unless needed for keypoint labeling (step 9), and then only under `derived/<clip ID>/`, so withdrawal and retention delete them.
- Tests: synthetic, no real clips, no network.

**Option 2 (fallback): Python `mediapipe` in a virtual environment outside the repo.** Simpler video decoding, but adds a Python toolchain the repo doesn't use. Same model file, same output.

Either option is a dev-tool install on the `caddie-v2` branch only. No production, Supabase, or app change.

## 5. Remaining blockers and who unblocks each

| # | Blocker | Blocks | Owner |
|---|---|---|---|
| B1 | Two coaches recruited against `TESTING_PROTOCOL.md` §8 | Steps 8, 10 | **Micky** |
| B2 | Each coach signs agreement v1.0; Micky countersigns and runs `coach-add` | Step 8 | **Micky + coach** |
| B3 | Screen-share platform chosen and reviewed (`COACH_REVIEW_PROCEDURE.md` §4); `SCREEN_SHARE_PLATFORM_REVIEW` set in its own commit | Remote coach (K02) | **Micky** |
| B4 | Approval to install the local pose runtime and download the model file (§4) | Steps 6, 7, 10 | **Micky** (approve); then the assistant builds |
| B5 | Pose extractor, V2-checks runner, and scoring harness built and tested | Steps 6, 7, 10, 11 | **Assistant**, after B4 |
| B6 | `ffmpeg` available in WSL (system package) or the manual strip planned | Step 4 | **Micky** |
| B7 | Contributors lined up: C002 at least, ideally a left-handed golfer | Steps 1, 2 | **Micky** |
| B8 | Laptop full-disk encryption confirmed on | Step 4 onwards | **Micky** |
| B9 | Optional lawyer review of the consent form and coach agreement (recommended if anyone lives in another country, or a coach is paid) | Step 1 (Micky's call) | **Micky** |
| B10 | Decision: in the pilot, skip coach pass 2, or let coaches rate local-pose V2 output, clearly labeled | Step 8 scope | **Micky** |
| — | Roboflow written no-training answer (`VENDOR_VERIFICATION.md` §5.1) | **Not the pilot.** Only a later V1 baseline | **Micky** sends; Roboflow answers |
| — | Gemini checklist (`VENDOR_VERIFICATION.md` §4) | **Not the pilot.** Only a later V1 baseline or coach pass 2 on V1 | **Micky** |

Nothing in this workflow needs spend approval, a production change, a migration, or a deploy.
