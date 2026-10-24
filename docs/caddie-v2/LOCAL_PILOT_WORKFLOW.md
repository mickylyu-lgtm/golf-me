# Caddie V2: local-only pilot workflow (proposal)

Status: **2026-10-21. Local pose, labeling, and measurement tools built and tested on synthetic data; not yet run on a real clip.** Micky approved the MediaPipe install and model download, chose Google Meet for the remote coach, turned pilot pass 2 on (rating the local prototype), and (2026-10-21) approved a local pilot with **3 to 5 consenting golfers** (face-on and down-the-line), `K00` as his annotator ID, and keeping all MediaPipe telemetry blocked. This is the safest end-to-end workflow for that pilot that I can propose: **no clip, frame, or derived data leaves Micky's laptop**, except the live picture in a reviewed Google Meet screen-share for the remote coach. Roboflow and Gemini are not used (`VENDOR_APPROVAL_CRITERIA.md` §6). What was built, measured, and what it can't do yet: `MEDIAPIPE_POC.md`.

Related: `PILOT_CHECKLIST.md` (the day itself), `VIDEO_IMPORT_AND_CONSENT.md` (rules), `COACH_REVIEW_PROCEDURE.md` (coach sessions), `TESTING_PROTOCOL.md` (what's filmed and labeled), `EVAL_REPORT_TEMPLATE.md` (the report).

## 1. The workflow in one table

| # | Step | Where | Tool / doc | Status |
|---|---|---|---|---|
| 1 | **Consent** signed on paper or PDF before filming; recorded pseudonymously | Paper/identity key; data folder | Form v1.2; `consent-add` | Ready |
| 2 | **Filming** on Micky's phone, cloud photo backup off | Phone | `PILOT_CHECKLIST.md` §2 to 3 | Ready |
| 3 | **Transfer** by USB cable or AirDrop to a temp folder outside the repo and any synced folder | Laptop | `PILOT_CHECKLIST.md` §5 | Ready |
| 4 | **Consent check + import**: refuses without active affirmative consent; strips audio and metadata; pseudonymous clip IDs; sha256 | Data folder | `import --require-strip`, `verify` | Ready (needs ffmpeg in WSL) |
| 5 | **Cleanup**: delete temp folder, phone copies, phone "Recently Deleted" | Phone, laptop | `PILOT_CHECKLIST.md` §7 | Ready |
| 6 | **Local pose extraction**: every frame of each stored clip through MediaPipe Pose Landmarker, offline inside an empty network namespace, written as raw landmarks + `PoseSequence` + run file (timing, CPU, memory, network log, OS isolation) in `derived/<clip ID>/` | Laptop, offline | `pose-local.mjs` (§4), `MEDIAPIPE_TELEMETRY_AUDIT.md` | **Built**; tested on a synthetic clip only |
| 7 | **V2 checks** on the local pose: quality gate, camera-angle heuristic, **key-frame detector** (address, top, impact, finish) with its phase-order check | Laptop | `run-v2-checks.mjs` over `qualityGate.ts`, `cameraAngle.ts`, `keyFrames.ts`, `phaseOrder.ts`; key frames also in `derived/<clip>/keyframes-mediapipe-<v>.json` | **Built; run on 10 real clips 2026-10-24** (thresholds still placeholders; no key-frame accuracy known until K00 labels exist) |
| 7a | **Pose overlay** for coach pass 2 | Laptop | `render-overlay.mjs` | **Built** |
| 8 | **Coach labeling**, pass 1 (blind): K01 in person, K02 by Google Meet screen-share. Then **pass 2** on the local prototype (overlay + gate/angle summary; only landmark reliability is rateable) | Laptop; live call | `coach-session-check`, `COACH_REVIEW_PROCEDURE.md` §5.1 | **Blocked: coaches, agreements, Meet settings review** |
| 9 | **K00 key-frame labels** (PROTOTYPE, not ground truth): 13 points on address, top, impact, finish, at least one face-on and one down-the-line clip per golfer, by Micky; versioned, corrections append-only | Laptop, loopback-only page | `keyframes.mjs export` / `label`, `KEYFRAME_ANNOTATION_GUIDE.md` | **Built**; tested on synthetic data only |
| 10 | **Measurement**: offline check, detection rate and confidence per keypoint and view, pose accuracy vs K00, key-frame identification (detector built; error in frames and ms vs K00 once labeled), time / CPU / memory per swing, face-on vs down-the-line. Still to build: gate vs coach `analyzable`, angle vs coach `camera_angle`, coach agreement, jitter, pass-2 tallies | Laptop | `pilot-report.mjs`, `pose-accuracy.mjs` (**built**) | Needs steps 6 to 9 |
| 11 | **Report**: clip IDs and numbers only, no video, frames, or names. `pilot-report.mjs` writes into the data folder; Micky reviews before anything is copied to the repo | Data folder, then repo (`eval-reports/`) | `EVAL_REPORT_TEMPLATE.md` §0, §4a, §5, §5a, §8a, §8b | Built |
| 12 | **Retention**: weekly `retention`; withdrawal within 7 days | Data folder | `retention --apply`, `withdraw --confirm` | Ready |

What the pilot **can't** measure: V1 (today's Caddie) on these clips, since that means Roboflow and Gemini; coach pass 2 on V1 feedback; and any measurement, fault, explanation, or drill output, because the prototype doesn't produce them yet. Key frames are produced (since 2026-10-24) but their accuracy needs K00 labels first. The pilot measures the local pose source (accuracy against keypoint labels, coach-rated landmark reliability, speed, resources), the V2 checks, the process, and coach agreement. That is enough to decide go/no-go for the full set.

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

Backend ID: `"mediapipe_pose_landmarker"` was added to `PoseBackend` (`src/lib/caddie/v2/types.ts`); the variant and model hash go in `backendVersion`, and each variant writes its own files, so Full and Heavy results are never mixed.

Checks before trusting the mapping: MediaPipe's and Vision's "left" should be the person's anatomical left (from memory); confirm on one clip of Micky's own. Apple Vision's normalized coordinates have their origin at the bottom-left (from memory), so y must be flipped into `PoseSequence`'s top-left space.

## 4. Local extractor (built 2026-10-20)

Option 1 from the proposal was built: browser runtime, offline, in the existing headless Chromium. Details, versions, hashes, measurements, and limitations: `MEDIAPIPE_POC.md`. Commands (from the `caddie-v2` checkout, with `GOLFME_EVAL_DATA_DIR` set):

```
node tools/caddie-eval/fetch-models.mjs --check              # model files present, sha256 OK
node tools/caddie-eval/pose-local.mjs --clip C001-0001       # Full; add --variant heavy to compare
node tools/caddie-eval/run-v2-checks.mjs --clip C001-0001    # or --all
node tools/caddie-eval/render-overlay.mjs --clip C001-0001   # overlay for coach pass 2
node tools/caddie-eval/keyframes.mjs export --clip C001-0001 # frames for K00 labeling
node tools/caddie-eval/keyframes.mjs label --clip C001-0001  # loopback-only labeling page
node tools/caddie-eval/pose-accuracy.mjs --all               # once key-frame labels exist
node tools/caddie-eval/pilot-report.mjs                      # the measurement tables
```

- Every tool first calls `assertLocalProcessingAllowed()`: manifest entry, active consent, stripped, sha256 intact. No vendor gate, because nothing leaves the machine.
- The browser can't reach the network: every request is served from a local allowlist or aborted and logged, and on Linux/WSL the whole run sits in an empty network namespace (no interface to send on). MediaPipe's own usage logger (`odml.pa.googleapis.com`) is blocked and shows up in each run file; what it is and what it would send: `MEDIAPIPE_TELEMETRY_AUDIT.md`.
- Frames are decoded by ffmpeg into memory, never written to disk. Output only under `derived/<clip ID>/`, deleted by `withdraw` and `retention`.
- Tests: synthetic only (adapter in Vitest; gate, runner, overlay, scorer, extractor plumbing in `node --test`); an opt-in smoke run (`CADDIE_EVAL_SMOKE=1`) drives the real browser and model on an ffmpeg test pattern.

Option 2 (Python `mediapipe`) wasn't needed.

## 5. Remaining blockers and who unblocks each

| # | Blocker | Blocks | Owner |
|---|---|---|---|
| B1 | Two coaches recruited against `TESTING_PROTOCOL.md` §8 | Steps 8, 10 | **Micky** |
| B2 | Each coach signs agreement v1.0; Micky countersigns and runs `coach-add` | Step 8 | **Micky + coach** |
| B3 | Platform **chosen: Google Meet** (2026-10-20). Still open: Micky does the Meet settings review (`COACH_REVIEW_PROCEDURE.md` §4.1) on his account and sets `SCREEN_SHARE_PLATFORM_REVIEW` in its own commit | Remote coach (K02) | **Micky** |
| B4 | ~~Approval to install the local pose runtime and download the model files~~ **Done 2026-10-20** (`@mediapipe/tasks-vision` 1.1.0; Full and Heavy, pinned by sha256) | — | Done |
| B5 | **Done:** extractor, V2-checks runner, overlay, pose-accuracy scorer, key-frame export and labeling page, pilot measurement report, OS network isolation. **Next:** gate vs `analyzable`, angle vs `camera_angle`, kappa, jitter, pass-2 tallies (need coach labels) | Step 10 (coach parts) | **Assistant** |
| B5a | First real run of the extractor on a pilot clip, including the left/right check (`PILOT_CHECKLIST.md` §7a) | Steps 6 onwards | **Micky** (clips) |
| B6 | `ffmpeg` available in WSL (system package) or the manual strip planned | Step 4 | **Micky** |
| B7 | 3 to 5 consenting golfers lined up, at least one left-handed if available | Steps 1, 2 | **Micky** |
| B8 | Laptop full-disk encryption confirmed on | Step 4 onwards | **Micky** |
| B9 | Optional lawyer review of the consent form and coach agreement (recommended if anyone lives in another country, or a coach is paid) | Step 1 (Micky's call) | **Micky** |
| B10 | ~~Pass 2 in the pilot?~~ **Decided 2026-10-20: on**, rating the local prototype after a blind pass 1; unimplemented items "not implemented, not rated" | — | Done |
| B11 | ~~Who labels key-frame keypoints~~ **Decided 2026-10-21:** Micky as `K00`, recorded with its own `annotator-add` record (not `coach-add`: no coach agreement, never in a coach session or coach agreement stats); labels are PROTOTYPE labels | — | Done |
| — | Roboflow written no-training answer (`VENDOR_VERIFICATION.md` §5.1) | **Not the pilot.** Only a later V1 baseline | **Micky** sends; Roboflow answers |
| — | Gemini checklist (`VENDOR_VERIFICATION.md` §4) | **Not the pilot.** Only a later V1 baseline or coach pass 2 on V1 | **Micky** |

Nothing in this workflow needs spend approval, a production change, a migration, or a deploy.
