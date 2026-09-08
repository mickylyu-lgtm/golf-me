// Shared default locations for the local (non-Roboflow) dataset pipeline.
// Everything here lives outside the git repo, under ~/Desktop/training_data --
// this is local scratch/staging state for building the GolfMe Swing Model v2
// dataset, not app code, so it's never committed.
import os from "node:os";
import path from "node:path";

const TRAINING_DATA_ROOT = path.join(os.homedir(), "Desktop", "training_data");

export const DEFAULT_RAW_VIDEOS_DIR = path.join(TRAINING_DATA_ROOT, "raw_videos");
export const DEFAULT_SELECTED_FRAMES_DIR = path.join(TRAINING_DATA_ROOT, "selected_frames");
export const DEFAULT_MANIFEST_PATH = path.join(TRAINING_DATA_ROOT, "dataset-manifest.json");
export const DEFAULT_SESSION_METADATA_PATH = path.join(TRAINING_DATA_ROOT, "session-metadata.json");
export const DEFAULT_SESSION_OVERRIDES_PATH = path.join(TRAINING_DATA_ROOT, "session-overrides.json");
