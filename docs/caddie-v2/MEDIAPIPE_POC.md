# Caddie V2: local MediaPipe pose prototype (B5 part 1)

Status: **built and tested on synthetic data, 2026-10-20. Not run on any real swing yet.** No real clip existed on this machine, so every number below comes from a synthetic ffmpeg test pattern that contains **no person**. The first real run happens on Micky's pilot clips. Branch `caddie-v2` only: nothing in `src/` imports this, nothing is deployed, no production or Supabase change.

Related: `LOCAL_PILOT_WORKFLOW.md` (where this fits), `TESTING_PROTOCOL.md` §8 (pass 2 in the pilot), `EVAL_REPORT_TEMPLATE.md` §5, §7a, §8 (where the numbers go), `tools/caddie-eval/README.md` (commands).

## 1. What exists

| Piece | File | Does |
|---|---|---|
| Runtime | `@mediapipe/tasks-vision` **1.1.0**, devDependency, exact pin | Newest release at least 14 days old on 2026-10-20 (published 2026-10-06; 1.1.1 is from 2026-10-14). Apache-2.0, no dependencies, no install scripts |
| Models | `tools/caddie-eval/models/models.json` (committed); binaries in `~/.cache/golfme-caddie-eval/models` (never committed) | Pose Landmarker Full and Heavy, float16 v1, from Google's model bucket, pinned by sha256 (table in §2) |
| Gate | `assertLocalProcessingAllowed()` in `import-clip.mjs` | Clip in the manifest, active affirmative consent, stripped, sha256 intact. Every tool below calls it |
| Extractor | `tools/caddie-eval/pose-local.mjs` + `pose-page/index.html` | ffmpeg decodes the clip into memory; MediaPipe runs in headless Chromium (playwright-core); writes raw landmarks, a `PoseSequence` v1, and a run file with timing, CPU, memory, network log |
| Adapter | `src/lib/caddie/v2/mediapipeAdapter.ts` (Vitest) | 33 BlazePose landmarks to our 13, in source pixels; off-frame points dropped; largest pose kept; no-pose frames kept empty |
| V2 checks | `tools/caddie-eval/run-v2-checks.mjs` | Existing quality gate and camera-angle heuristic, unchanged, on the derived pose. Results file lists provisional thresholds and what isn't implemented |
| Overlay | `tools/caddie-eval/render-overlay.mjs` | Draws confident keypoints on the clip (local MP4 in `derived/`) so coaches can judge landmark reliability in pass 2 |
| Pose accuracy | `tools/caddie-eval/pose-accuracy.mjs` | PCK@0.1/0.2 of torso length, honest abstention, confident-wrong, against key-frame keypoint labels (template §5) |

All output goes to `<data folder>/derived/<clip ID>/`, so `withdraw` and `retention` delete it with the clip.

## 2. Model files

| Variant | File | Bytes | sha256 | Source |
|---|---|---|---|---|
| Full | `pose_landmarker_full.task` | 9,398,198 | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task` |
| Heavy | `pose_landmarker_heavy.task` | 30,664,242 | `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b` | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task` |

Downloaded 2026-10-20. The server's MD5 header matched both files. Server last-modified 2023-04-28.

**Licence: Apache License 2.0**, as stated under "Licensed under" on page 2 of the *MediaPipe BlazePose GHUM 3D* model card (card dated 2021-04-16, read 2026-10-20, sha256 recorded in `models.json`). The card covers the Lite, Full and Heavy landmark models. The `.task` bundle also contains the person detector, which the card doesn't name separately; I found no other licence for it. The card lists these as **out of scope**: more than one person, people further than about 4 m from the camera, head not visible, metric depth, surveillance or identity recognition.

## 3. Offline by construction, and one finding

The page is served from a fake origin (`http://caddie-eval.invalid`). Playwright answers every request from a fixed allowlist (page, MediaPipe bundle, WASM, model, current frame). Anything else is aborted and counted, WebSockets are closed, service workers blocked, and Chromium's DNS is mapped to nothing as a second layer. Since 2026-10-21, on Linux/WSL the whole run also sits in an **empty network namespace** (`unshare --user --map-root-user --net`), and the run file records `osIsolation` and `externalRequestsAllowed: 0`. The extractor writes no frame to disk (the separate key-frame export for labeling does, into `derived/`).

**Finding: MediaPipe Tasks 1.x sends usage logs to Google by default.** The bundle contains a logger that POSTs to `https://odml.pa.googleapis.com/v1/log` with an API key taken from the WASM, every 60 s and when the task closes. **Audited 2026-10-21** (`MEDIAPIPE_TELEMETRY_AUDIT.md`): it is the only Google endpoint, it's created unconditionally for every task, inference doesn't need it, and no supported option turns it off in 1.1.0. An intercepted (never sent) body held counters, timings, task type, running mode, OS family, and SDK version; no pixels or landmarks. Micky's decision: keep it blocked. In every run it was blocked: each run file shows `"blocked": {"odml.pa.googleapis.com": 1}` and nothing else. **For any future in-app use this matters** (§6): it's a third-party call the privacy policy doesn't mention today.

## 4. Measured performance (synthetic test pattern only)

Input: 3 s, 1080x1920 portrait H.264, 30 fps, ffmpeg `testsrc2` (no person), downscaled to 720x1280. Machine: Intel Core Ultra 9 275HX, 24 logical cores, 16 GB, WSL2, Node 24.22, headless Chromium 151, CPU delegate (XNNPACK WASM).

| Run | Model load | Inference ms/frame (median / p95) | Round trip ms/frame (median) | Wall for the clip | CPU seconds (all processes) | Peak RSS, sum of processes |
|---|---|---|---|---|---|---|
| Full, CPU | 565 ms | 13.9 / 15.1 | 61 | 7.6 s (2.5x clip length) | 9.1 | 1.82 GB |
| Heavy, CPU | 789 ms | 14.0 / 16.1 | 61 | 7.9 s (2.6x) | 9.2 | 2.03 GB |
| Full, GPU delegate | — | 136.6 / 145.6 | — | 19.9 s | — | — |

**What these numbers do not tell you:**

- **The landmark model never ran.** With no person in the frame, MediaPipe runs only the person detector each frame. That's why Full and Heavy take the same time. The cost per frame **with a golfer** is not measured. For scale only, the model card quotes Full at about 18 FPS and Heavy at about 4 FPS on a Pixel 3 CPU; that is the vendor's figure on a phone, not ours.
- **Round trip** (about 60 ms/frame) is mostly copying a 3.7 MB RGBA frame into the page over Playwright's protocol. It's a cost of this harness, not of MediaPipe.
- **Peak RSS** adds up every process's resident memory, so shared pages count more than once. Read it as an upper bound.
- **GPU** here is Chromium's software WebGL (no GPU in WSL), so it's 10x slower. CPU is the default for that reason. On a real GPU it could be faster.

The run file (`pose-mediapipe-<variant>.run.json`) records all of this for every real clip, so the pilot report gets real numbers per clip (`EVAL_REPORT_TEMPLATE.md` §8).

## 5. Known limitations

### Camera angle

- The heuristic (`cameraAngle.ts`) only looks at **address** frames and only knows `face_on`, `down_the_line`, `unknown`. Behind, steep, and 45-degree views should land in `unknown`; that's the abstention the report measures, not a feature.
- It uses the **earliest usable frames** as address. A clip that starts mid-backswing (`short_clip`) breaks that assumption.
- Its thresholds are **placeholders** from rough geometry, never fitted to MediaPipe output. MediaPipe's shoulder and hip spans may differ from the synthetic figures; the first pilot clips will show where real values fall (`medianShoulderRatio`, `medianHipRatio` in the results file).
- Down-the-line is where MediaPipe is most likely to struggle: the far shoulder and hip are hidden behind the body, so their visibility drops and the gate may reject frames, giving `unknown` rather than a wrong answer.
- The camera-angle math needs x and y on the same scale. The adapter therefore emits source pixels. A sequence in `normalized` space on a portrait frame would distort the ratios; this is noted in `types.ts`.

### Pose accuracy

- **No accuracy is known for golf.** The card's PDJ (91.8 Full, 94.2 Heavy) is on Google's own fitness and AR photos and uses torso diameter, not our torso length. Our numbers come only from Micky's or a coach's key-frame labels (`pose-accuracy.mjs`).
- Expected failure points: **wrists and elbows in the downswing** (motion blur at 30 fps, crossed hands at impact), the far side of the body in down-the-line, baggy clothing, and backlight. The model has no club or ball points.
- **Left/right:** MediaPipe's left should be the golfer's anatomical left for unmirrored video (from MediaPipe docs, unverified on our clips). Check on one of Micky's clips before trusting side-specific results.
- **Several people:** the adapter keeps the largest pose and counts the frame. The card calls multi-person out of scope; the `second_person` clips test that.
- **Tracking:** VIDEO mode tracks between frames, so one bad frame can carry into the next few. Jitter at address is measured in the report (§5).
- **Decoding:** frames come from ffmpeg (auto-rotated, downscaled to 1280 px on the long side, at most 60 fps by default). iPhone HDR (10-bit HLG) is converted to 8-bit RGB without tone mapping, so colours may look washed out; effect on pose unknown. Slow-motion clips are analyzed at most 60 fps unless `--fps` is given.
- **Timing:** frame times start at 0 at the first decoded frame. A coach's player time for the same frame can differ slightly; the scorer matches within half a frame.
- `personConfidence` is always `null` (the Tasks API doesn't expose a person score), so the gate's person-score check never applies to MediaPipe.

### Not implemented

Swing phases, measurements, faults, coaching explanations, and drills. Every results file says so, and the pass-2 rating fields refuse a rating for any of them (`PROTOTYPE_CAPABILITIES` in `import-clip.mjs`).

## 6. Fit with the GolfMe web app and future iOS

**Web (Vite + React PWA, and the Capacitor iOS shell, which loads the same live web app in WKWebView):**

- The same runtime and model run in a browser. Sizes: bundle 156 KB (45 KB gzip), SIMD WASM 13.0 MB (3.8 MB gzip), model 9.4 MB (Full) or 30.7 MB (Heavy). That's too heavy for the main bundle: it would have to be a **lazy-loaded Caddie-only chunk**, with the WASM and model served from GolfMe's own origin (not a CDN) and cached.
- **Telemetry (§3):** in the app, the `odml.pa.googleapis.com` call would reach Google. Either block it with a CSP `connect-src` (MediaPipe then stops logging after the first failure) or disclose it. Needs a decision before any in-app use.
- **Decoding is the unproven part.** The extractor sidesteps browser video decoding by using ffmpeg. In the app, frames would come from a `<video>` element (`requestVideoFrameCallback`) or WebCodecs. Safari and WKWebView play iPhone HEVC; desktop Chrome's HEVC support depends on hardware. Not tested here.
- **Speed and memory on phones are unknown.** The laptop numbers above don't transfer. Desktop-class CPU WASM at about 14 ms/frame (detector only) says nothing about an iPhone in WKWebView, which also has tighter memory limits.
- **Background and resume:** JavaScript is suspended when the iOS app goes to the background. An in-browser pose pass can't keep running there. Caddie's durable job state lives server-side today (`caddie_analyses`), and it must stay that way: a client pose pass would be a step that finishes, or restarts cleanly, **before** upload, then sends only the `PoseSequence` to the server job. It must never become in-memory component state that the job depends on.
- **Privacy upside:** only keypoints would leave the device, not the video. That supports the V2 data-minimisation plan (`CADDIE_V2_AUDIT.md` §7.3).

**iOS native:** Apple Vision 2D (`VNDetectHumanBodyPoseRequest`) stays the iOS candidate (`LOCAL_PILOT_WORKFLOW.md` §3). It needs a Capacitor plugin and a Mac or iPhone to benchmark. MediaPipe also ships a native iOS Tasks SDK (from memory, not checked), which would give the same model on both paths but also needs a plugin. Either way the output is the same `PoseSequence`, so the V2 modules and these eval tools don't change.

## 7. Readiness for coach evaluation

| Item | State |
|---|---|
| Pose extraction, V2 checks, overlay, pose-accuracy scoring | Built; tests on synthetic data pass; one synthetic end-to-end run each for Full and Heavy |
| First real run | **Not done.** Needs Micky's pilot clips (consented, imported, stripped) |
| Coach pass 1 (blind) | Unchanged; blocked on coach recruitment and agreements |
| Coach pass 2 on the prototype | Possible for **body landmarks only** (overlay). Phases, measurements, faults, explanations, drills: "not implemented, not rated" |
| Remote pass 2 | Google Meet screen-share, after Micky's Meet settings review (`SCREEN_SHARE_PLATFORM_REVIEW` is still `null`, so remote sessions are refused) |
| Key-frame labels and measurement | **Built 2026-10-21:** K00 frame export and labeling page (`keyframes.mjs`), pilot measurement report (`pilot-report.mjs`). Key-frame identification: not implemented (no detector) |
| Still to build (next) | The coach-label parts of the harness: quality gate vs coach `analyzable`, camera angle vs coach `camera_angle`, inter-rater kappa, address jitter, pass-2 tallies |
