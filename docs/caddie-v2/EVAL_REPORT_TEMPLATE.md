# Caddie V2 evaluation report: TEMPLATE

> Copy this file to `docs/caddie-v2/eval-reports/<YYYY-MM>-eval-<NN>.md` and fill it in. That path is what a threshold's evidence points to in `src/lib/caddie/v2/thresholds.ts`.
>
> **Rules for filling it in:**
> - Every number comes from a harness run you can re-run. Write `—` for anything not measured. **Never estimate a result.**
> - Give the sample size **n** next to every result, and a 95 % interval: Wilson interval for proportions, bootstrap (2,000 resamples, clip-level) for means and percentiles.
> - If n is under 20 for a cell, write the number but mark it **"too few to conclude"**. No threshold may be validated from such a cell.
> - Clips are referred to only by clip ID. No video, frames, screenshots, names, or emails in a report.
> - Results describe **this dataset only**. Don't word them as product accuracy claims.

---

## 0. Run details

| Field | Value |
|---|---|
| Report ID | |
| Date | |
| Author | |
| Branch and commit | |
| Dataset manifest revision | (from `manifest.json` `revision`) |
| Clips in this run / excluded | / (list exclusion reasons in §1) |
| Contributors | (count only) |
| Coaches (pseudonymous IDs) | |
| Pose source | (e.g. local MediaPipe Pose Landmarker Full / Heavy, cached V1 Roboflow output, Apple Vision prototype; for MediaPipe: `@mediapipe/tasks-vision` version, model file and sha256 from `tools/caddie-eval/models/models.json`, adapter version, decode settings: fps, long side) |
| Offline check (local runs) | (from each `pose-mediapipe-<variant>.run.json`: `network.blocked` hosts and counts; must show only expected blocks, e.g. MediaPipe's `odml.pa.googleapis.com` logger, and no request served from anywhere but the local allowlist) |
| V1 outputs used? | (yes/no; if yes, the date V1 was run, the spend approval reference, the `VENDOR_TERMS_VERIFIED` dates for Roboflow and Gemini, and confirmation every clip sent passed `assertThirdPartyAllowed`) |
| Consent form version(s) | (e.g. 1.1; every clip within its 90-day retention on the run date) |
| Module versions | `qualityGate` , `cameraAngle` , `phaseOrder` , `roboflowAdapter` , `mediapipeAdapter` , `pose-accuracy` |
| Threshold registry | (commit of `thresholds.ts`; count placeholder / coach_validated) |
| Provider spend for this run | (actual, from invoices or usage pages; `—` if none) |

## 1. Dataset composition

Counts of clips actually scored. Slot codes and condition tags come from the manifest.

| Group | Face-on | Down-the-line | Unsuitable | Total |
|---|---|---|---|---|
| A. Core (tripod, daylight) | | | | |
| B. Handheld | | | | |
| C. Light (backlit / overcast or dusk / indoor) | | | | |
| D. Slow motion (60 / 240 fps) | | | | |
| E. Trouble cases | | | | |
| **Total** (target 76) | | | | |

| Club | Driver | Hybrid (or wood) | Iron |
|---|---|---|---|
| Clips | | | |

| Handedness / skill | Right | Left (target 15 to 20 %) | Beginner | Mid | Advanced |
|---|---|---|---|---|---|
| Clips | | | | | |

If no left-handed contributor was available, write "left-handed: not measured" here and in §9.

Excluded clips and why (clip ID, reason):

| Clip | Reason |
|---|---|
| | |

## 2. Label quality (inter-rater agreement)

Computed on double-labeled clips only. Definitions in `TESTING_PROTOCOL.md` §9.

| Field | Clips double-labeled (n) | Agreement statistic | Value | 95 % CI | `cant_tell` rate | Reliable enough? (vs the pre-agreed cut-off) |
|---|---|---|---|---|---|---|
| Camera angle | | Cohen's / Fleiss' kappa | | | | |
| Handedness | | kappa | | | | |
| Analyzable | | kappa | | | | |
| Address time | | mean abs. diff (ms) / % within ±67 ms | | | | |
| Top time | | same | | | | |
| Impact time | | same | | | | |
| Finish time | | same | | | | |
| Each fault (one row per fault) | | kappa | | | | |
| Main improvement | | % exact agreement | | | | |

Self-consistency (same coach, re-label after a week or more):

| Coach | Clips re-labeled | Angle kappa | Phase mean abs. diff (ms) | Fault kappa (mean over faults) |
|---|---|---|---|---|
| | | | | |

Disagreements (tracked, never settled): one row per clip and field where the coaches differ, with each coach's answer. No tie-break or discussion is used to resolve them (`TESTING_PROTOCOL.md` §9).

| Clip ID | Field | K01 | K02 |
|---|---|---|---|
| | | | |

**Truth used below** = the **agreed** label (both coaches gave the same answer; for phase times, both within ±67 ms, truth = their mean). Ambiguous fields are scored in a separate row, never mixed in. Where a section shows a headline metric, also give it **against each coach separately** (K01 truth, K02 truth). If only one coach labeled, say so at the top of the report; no threshold may be validated from single-coach labels.

---

## 3. Camera-angle accuracy

**What it measures:** whether `classifyCameraAngle` names the angle correctly, and whether it says `unknown` instead of guessing when it should.

**Truth:** coach `camera_angle` (`face_on` / `down_the_line` / `unsuitable`).
**Prediction:** module output `face_on` / `down_the_line` / `unknown`.
**Unit:** one clip.

**How computed:**

- **Coverage** = suitable clips (truth face-on or DTL) predicted as an angle (not `unknown`) ÷ all suitable clips.
- **Selective accuracy** = correct among suitable clips that got an angle ÷ suitable clips that got an angle.
- **Confident-wrong rate** = clips predicted as an angle that's wrong (including any unsuitable clip given an angle) ÷ all clips given an angle. This is the one that hurts users.
- **Unsuitable abstention** = unsuitable clips predicted `unknown` ÷ all unsuitable clips.

Confusion matrix (counts):

| Truth \ Predicted | face_on | down_the_line | unknown | Total |
|---|---|---|---|---|
| face_on | | | | |
| down_the_line | | | | |
| unsuitable | | | | |

| Metric | n | Value | 95 % CI | Audit target (proposal, not a result) |
|---|---|---|---|---|
| Coverage | | | | — |
| Selective accuracy | | | | 95 % or more |
| Confident-wrong rate | | | | 5 % or less |
| Unsuitable abstention | | | | 90 % or more |

Also report the distributions of `medianShoulderRatio` and `medianHipRatio` per true angle (min, p10, median, p90, max). They are the evidence for moving the `CA_*` thresholds.

## 4. Swing-phase accuracy

**What it measures:** how close predicted phase times are to coach times, and whether the order check catches bad phases.

**Prediction source:** V1 Gemini phases via `parseV1GeminiPhases` (needs a V1 run, so spend approval), and later the V2 segmenter. Report each source separately.
**Truth:** coach `t_address`, `t_top`, `t_impact`, `t_finish`. `cant_tell` excluded and counted.
**Unit:** one phase on one clip.

**How computed:**

- **Absolute error (ms)** = |predicted − truth| per phase. Report median and p90. For impact, the predicted time is the window midpoint.
- **Within tolerance** = share of phases with error ≤ 67 ms (2 frames at 30 fps).
- **Impact containment** = share of clips whose predicted impact window contains the coach's impact time.
- **Order check agreement:** `validatePhaseOrder` status vs whether every predicted phase is within tolerance. Report how often `consistent` came with a phase outside tolerance (missed bad phase), and how often `inconsistent` came with all phases within tolerance (false alarm).

| Phase | Source | n (labeled) | `cant_tell` | Median abs. error (ms) | p90 (ms) | Within ±67 ms | 95 % CI |
|---|---|---|---|---|---|---|---|
| Address | | | | | | | |
| Top | | | | | | | |
| Impact (midpoint) | | | | | | | |
| Finish | | | | | | | |

| Impact window | n | Contains coach impact | 95 % CI | Median window width (ms) |
|---|---|---|---|---|
| | | | | |

| Order check | n | consistent | inconsistent | inconclusive | Missed bad phase | False alarm |
|---|---|---|---|---|---|---|
| | | | | | | |

## 5. Pose landmark stability

**What it measures:** whether body points are where coaches put them, stay still when the golfer is still, and get low confidence when hidden.

**Truth:** coach or Micky keypoints on address/top/impact frames of the keypoint subset (`TESTING_PROTOCOL.md` §8), with "not visible" allowed.
**Prediction:** the pose source's keypoints on the nearest analyzed frame (within half a frame). One table per pose source and variant (e.g. MediaPipe Full, MediaPipe Heavy); never pool them.
**Unit:** one keypoint on one labeled frame (accuracy, abstention); one clip (jitter).
**Tool:** `node tools/caddie-eval/pose-accuracy.mjs --all --variant full` computes PCK@0.1, PCK@0.2, honest abstention, and confident-wrong as defined below, per keypoint, per phase, and overall. Jitter isn't computed by a tool yet (next).

**How computed:**

- **Torso length** = distance from shoulder midpoint to hip midpoint in the coach's labels for that frame. All distances are divided by it, so results don't depend on resolution or distance.
- **PCK@0.1** = share of visible labeled points where the predicted point is within 0.1 torso lengths of the label **and** has confidence ≥ `QG_MIN_KEYPOINT_CONFIDENCE`. Report per group: shoulders, hips, elbows, wrists, knees, ankles, nose.
- **Honest abstention** = share of points labeled "not visible" that the model gave confidence below `QG_MIN_KEYPOINT_CONFIDENCE`.
- **Confident-wrong points** = share of confident predicted points more than 0.2 torso lengths from a visible label, or confident on a point labeled "not visible".
- **Address jitter** = over the still-address window (coach `t_address` back to 0.5 s earlier), the standard deviation of each confident point's position ÷ torso length, then the median across points per clip. Report the median and p90 across clips.

| Point group | Visible labels (n) | PCK@0.1 | PCK@0.2 | 95 % CI (PCK@0.1) | "Not visible" labels (n) | Honest abstention | Confident-wrong |
|---|---|---|---|---|---|---|---|
| Shoulders | | | | | | | |
| Hips | | | | | | | |
| Elbows | | | | | | | |
| Wrists | | | | | | | |
| Knees | | | | | | | |
| Ankles | | | | | | | |
| Nose | | | | | | | |
| **All 13** | | | | | | | |

| Phase | Labeled frames scored (n) | PCK@0.1 | PCK@0.2 | Confident-wrong |
|---|---|---|---|---|
| Address | | | | |
| Top | | | | |
| Impact | | | | |

The BlazePose model card's PDJ (PCK@0.2 of torso **diameter**, on Google's own photo set) is not comparable with these numbers; don't put it in the same table.

| Address jitter | Clips (n) | Median (torso lengths) | p90 |
|---|---|---|---|
| All | | | |
| Tripod | | | |
| Handheld | | | |

## 6. Quality-gate rejection accuracy

**What it measures:** whether `runQualityGate` passes clips that can be analyzed and says `inconclusive` for clips that can't.

**Truth:** coach (or Micky) `analyzable` yes/no.
**Prediction:** gate `pass` / `inconclusive`.
**Unit:** one clip.

**How computed:**

- **False rejection rate** = analyzable clips the gate called inconclusive ÷ all analyzable clips. Too high and Caddie is useless.
- **False acceptance rate** = non-analyzable clips the gate passed ÷ all non-analyzable clips. Too high and Caddie coaches clips it shouldn't.
- **Reject reasons** = for each rejected clip, the gate's `inconclusiveReason` and its largest `rejectCounts` entry, tallied against the clip's condition tags.

| Truth \ Gate | pass | inconclusive | Total |
|---|---|---|---|
| analyzable | | | |
| not analyzable | | | |

| Metric | n | Value | 95 % CI |
|---|---|---|---|
| False rejection rate | | | |
| False acceptance rate | | | |
| Inconclusive rate on well-filmed clips (group A) | | | |

| Condition tag | Clips | Gate inconclusive | Most common reason |
|---|---|---|---|
| (one row per tag) | | | |

## 7. False-positive coaching feedback

**What it measures:** how often Caddie claims a fault that isn't there, and whether its main advice is right. Applies to V1 output now, and V2 once it produces feedback.

**Truth:** coach pass-1 fault labels (agreed); coach pass-2 ratings, per coach.
**Unit:** one fault claim, or one clip.

**How computed:**

- **Per-fault precision** = Caddie claims of the fault that coaches marked `yes` ÷ all Caddie claims of that fault. Claims where coaches said `cant_tell_from_angle` are counted in their own column, not as right or wrong.
- **False faults per clean clip** = faults Caddie claimed on clips where coaches marked **no** faults, ÷ number of such clips.
- **Main-improvement rating** = distribution of `correct` / `partly` / `wrong` / `harmful` across clips.

| Fault | Caddie claims (n) | Coach yes | Coach no | Coach can't tell | Precision | 95 % CI |
|---|---|---|---|---|---|---|
| (one row per fault) | | | | | | |

| Clean clips (n) | False faults total | Per clean clip |
|---|---|---|
| | | |

| Rating | Main improvement (n, %) | Drill (n, %) |
|---|---|---|
| correct | | |
| partly | | |
| wrong | | |
| harmful | | |

**Every `harmful` rating, listed:** clip ID, coach ID, what Caddie said (paraphrased, no names), why the coach called it harmful.

## 7a. Coach pass 2 on the local prototype (pilot)

**What it measures:** how coaches judge the output the local prototype actually produces, after their blind pass 1 (`TESTING_PROTOCOL.md` §8, "Pass 2 in the pilot").

**Prototype rated:** (e.g. `mediapipe-full`, the `p2_prototype` value) and its commit.
**Unit:** one clip, per coach. Report each coach separately, then agreement where both rated.

State what the prototype did **at the time of the run**, from `PROTOTYPE_CAPABILITIES`. A row for an item the prototype doesn't produce says "not implemented, not rated", with no counts. **Never fill such a row with numbers, and never rate hand-written or invented feedback.**

| # | Item | Prototype at run time | Clips rated (n) | Distribution (per coach) | Agreement (both coaches) |
|---|---|---|---|---|---|
| 1 | Swing-phase identification accuracy | not implemented | not rated | — | — |
| 2 | Body landmark reliability | implemented (pose overlay) | | reliable / mostly_reliable / unreliable / cant_tell | % exact; kappa if n ≥ 20 |
| 3 | Accuracy of observable swing measurements | not implemented | not rated | — | — |
| 4 | Correctness of identified faults | not implemented | not rated | — | — |
| 5 | Usefulness of coaching explanations | not implemented | not rated | — | — |
| 6 | Safety and practicality of suggested drills | not implemented | not rated | — | — |

Landmark problems by phase (from `p2_landmark_problem_phases`, tallied; no names):

| Phase / body part | Clips mentioning it (n) |
|---|---|
| | |

The quality gate and camera angle are scored against pass-1 labels in §3 and §6, not rated here.

## 8. Processing time and cost

**What it measures:** how long a user waits and what each analyzed swing costs.

**How computed:**

- **Latency** per stage and total, from the harness's own timestamps (local runs), or from `caddie_analyses.created_at` to `updated_at` (production; **needs production-read approval**). Report p50 and p90 per path.
- **Cost per swing** = Roboflow runs × price per run + Gemini input tokens × input price + output (and thinking) tokens × output price, using `usageMetadata` from the actual responses. Write down each price, its source, and the date it was checked. If a price is an assumption, say so in the row.

| Stage | Path | n | p50 (s) | p90 (s) |
|---|---|---|---|---|
| Upload | | | | |
| Frame extraction | | | | |
| Pose | | | | |
| Gemini | | | | |
| **Total (tap to result)** | | | | |

### 8a. Local processing performance and resources (local pose runs)

From each clip's `pose-mediapipe-<variant>.run.json` (and `v2-checks-...json` for the checks). One table per variant. Write the hardware once: CPU model, logical cores, memory, OS (WSL or not), Node and Chromium versions, delegate (CPU/GPU).

| Measure | Variant | Clips (n) | p50 | p90 | Max | Source field |
|---|---|---|---|---|---|---|
| Model load (ms) | | | | | | `performance.modelLoadMs` |
| Inference per frame (ms) | | | | | | `performance.inferenceMsPerFrame.median` per clip |
| Round trip per frame (ms) | | | | | | `performance.roundTripMsPerFrame.median` (harness transfer cost) |
| Wall time per clip (s) | | | | | | `performance.wallSecondsTotal` |
| Wall time / clip length | | | | | | `performance.realtimeFactor` |
| CPU seconds per clip (all processes) | | | | | | `resources.cpuSeconds.total` |
| Average cores busy | | | | | | `resources.avgCoresBusy` |
| Peak RSS, sum of processes (MB) | | | | | | `resources.peakRssBytes.total` (upper bound: shared pages counted more than once) |
| Peak RSS, Chromium (MB) | | | | | | `resources.peakRssBytes.chromium` |
| V2 checks run time (ms) | | | | | | `v2-checks-...json` `runMs` |

These are laptop numbers. They say nothing about a phone or WKWebView (`MEDIAPIPE_POC.md` §6).

| Cost item | Units per swing (mean) | Price (source, date) | Cost per swing (mean) | p90 |
|---|---|---|---|---|
| Roboflow runs | | | | |
| Gemini input tokens | | | | |
| Gemini output + thinking tokens | | | | |
| **Total** | | | | |

Projection at the provisional budget (under $0.05 per swing, $30 per month): swings per month affordable = `—` (fill from measured cost only).

## 9. Results by condition

Key metrics split by condition, so a good average can't hide a bad case. Fill only cells with n ≥ 20 as results; mark smaller cells "too few to conclude".

| Condition | n | Angle confident-wrong | Gate false acceptance | Phase within ±67 ms | PCK@0.1 shoulders/hips |
|---|---|---|---|---|---|
| Tripod | | | | | |
| Handheld | | | | | |
| Daylight | | | | | |
| Backlit | | | | | |
| Overcast / dusk | | | | | |
| Indoor | | | | | |
| Right-handed | | | | | |
| Left-handed | | | | | |
| Baggy clothing | | | | | |
| 30 fps | | | | | |
| 60 / 240 fps | | | | | |

## 10. Threshold decisions

Only for thresholds with enough reliable evidence in this report. Each row needs Micky's sign-off and coach agreement before `thresholds.ts` changes. A validated entry's evidence must point to **this file**.

| Threshold ID | Current value | Proposed value | Status change | Evidence (section, n) | Approved by (Micky + coach IDs) |
|---|---|---|---|---|---|
| | | | placeholder → coach_validated / stays placeholder | | |

## 11. Limitations

What this dataset can't tell us (few golfers, one region's light, one phone model, etc.), and any known problem with labels or the run.

## 12. Sign-off

| Role | ID | Date |
|---|---|---|
| Report author | | |
| Coach reviewer | K | |
| Micky (product owner) | | |
