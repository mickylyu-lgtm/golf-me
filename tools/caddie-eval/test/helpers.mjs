// Shared fixtures for the local-processing tests. Throwaway temp folders,
// fake video bytes, and synthetic stick-figure poses only. No real clips, no
// network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addConsent, importClip, initDataDir } from "../import-clip.mjs";
import { MEDIAPIPE_LANDMARK_COUNT, MEDIAPIPE_LANDMARK_INDEX, adaptMediaPipeRun } from "../../../src/lib/caddie/v2/mediapipeAdapter.ts";
import { DTL_ADDRESS, FACE_ON_ADDRESS } from "../../../src/lib/caddie/v2/testFixtures.ts";

export const TODAY = "2026-10-21";
export const NO_FFMPEG = { GOLFME_EVAL_FFMPEG: "/nonexistent/ffmpeg", GOLFME_EVAL_FFPROBE: "/nonexistent/ffprobe" };
export const POSES = { FACE_ON_ADDRESS, DTL_ADDRESS };

export function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

let counter = 0;
export function fakeVideo(dir, name = "IMG_0001.MOV") {
  const file = path.join(dir, name);
  const body = Buffer.from(`fake video payload ${counter++} ${Math.random()}`);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70]), body]));
  return file;
}

/** Data dir with C001 consent and one manually-stripped clip. */
export async function setupWithClip({ angle = "face_on", consent = {}, strippedManually = true } = {}) {
  const root = tmp("caddie-eval-local-");
  const dataDir = path.join(root, "data");
  initDataDir(dataDir);
  const srcDir = path.join(root, "phone");
  fs.mkdirSync(srcDir);
  addConsent(
    dataDir,
    {
      contributor: "C001",
      formVersion: "1.1",
      consentDate: "2026-10-20",
      retentionUntil: "2027-01-18",
      adult: true,
      affirmativeConsent: true,
      coachViewing: true,
      remoteCoachViewing: false,
      thirdPartyRoboflow: false,
      thirdPartyGemini: false,
      ...consent,
    },
    TODAY,
  );
  const entry = await importClip(
    dataDir,
    { contributor: "C001", file: fakeVideo(srcDir), angle, club: "driver", mount: "tripod", handedness: "right", lighting: "daylight", skill: "mid", conditions: [], strippedManually },
    NO_FFMPEG,
    TODAY,
  );
  return { root, dataDir, clipId: entry.clipId, entry };
}

/** A MediaPipe-style raw run of a still stick figure in a 720x1280 frame. */
export function syntheticRawRun(points, { frames = 12, width = 720, height = 1280, noPoseFrames = 0 } = {}) {
  const pose = () => {
    const lms = Array.from({ length: MEDIAPIPE_LANDMARK_COUNT }, () => [0.5, 0.5, 0, 0.1, 0.1]);
    for (const [name, idx] of Object.entries(MEDIAPIPE_LANDMARK_INDEX)) {
      const [px, py] = points[name];
      lms[idx] = [(200 + px * 2) / width, (300 + py * 2) / height, 0, 0.95, 0.99];
    }
    return lms;
  };
  return {
    model: "pose_landmarker_full",
    runtimeVersion: "1.1.0",
    frameWidth: width,
    frameHeight: height,
    analysisFps: 30,
    framesRequested: frames,
    frames: Array.from({ length: frames }, (_, i) => ({ frameIndex: i, timestampSeconds: i / 30, poses: i < noPoseFrames ? [] : [pose()] })),
  };
}

/** Writes derived/<clip>/pose-mediapipe-<variant>.json as the extractor would. */
export function writeSyntheticPose(dataDir, clipId, points, { variant = "full", ...opts } = {}) {
  const r = adaptMediaPipeRun(syntheticRawRun(points, opts));
  if (r.status !== "ok") throw new Error("adapter refused synthetic run");
  const dir = path.join(dataDir, "derived", clipId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `pose-mediapipe-${variant}.json`), JSON.stringify(r.sequence));
  return r.sequence;
}
