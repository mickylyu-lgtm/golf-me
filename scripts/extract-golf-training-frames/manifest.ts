// The persistent, cross-run dataset manifest -- lives at
// ~/Desktop/training_data/dataset-manifest.json, alongside raw_videos/ and
// selected_frames/, NOT inside the git repo (this is local pipeline state,
// not app code or a secret). Re-reading and re-writing this file each run is
// what makes duplicate-video skipping and session-id stability possible
// across incremental batches of new footage.
import { readFile, writeFile } from "node:fs/promises";

export interface FrameRecord {
  file: string;
  timestampSeconds: number;
  diffScore: number | null;
  brightnessMean: number;
  contrastStdDev: number;
  blurVariance: number;
  diagnosticFlags: string[];
  selectionReason: "anchor-start" | "anchor-end" | "diversity" | "hard-example-blur" | "min-fill";
}

export type VideoStatus = "processed" | "processed-backfill" | "skipped-duplicate" | "failed" | "no-candidate-frames";

export interface VideoRecord {
  key: string; // path relative to raw_videos root, e.g. "batch_02/foo.mp4"
  filename: string;
  hash: string | null;
  sessionId: string | null;
  // Timestamp used for session-grouping, persisted so re-grouping on a
  // later run doesn't depend on the source file still being on disk with
  // the same mtime.
  timestampMs: number;
  timestampSource: "filename" | "mtime";
  durationSeconds: number | null;
  extractedAt: string;
  candidateFrameCount: number;
  candidateFps: number | null;
  activeWindow: { startSeconds: number; endSeconds: number } | null;
  selectedFrameCount: number;
  frames: FrameRecord[];
  duplicateOf: string | null;
  status: VideoStatus;
  errorMessage: string | null;
}

export interface DatasetManifest {
  schemaVersion: 2;
  generatedAt: string;
  videos: Record<string, VideoRecord>;
}

function emptyManifest(): DatasetManifest {
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), videos: {} };
}

export async function loadManifest(path: string): Promise<DatasetManifest> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (raw?.schemaVersion === 2 && raw.videos) return raw as DatasetManifest;
    console.warn(`  [manifest] ${path} exists but doesn't match schemaVersion 2 -- starting a fresh manifest (existing frames/output on disk are untouched).`);
    return emptyManifest();
  } catch {
    return emptyManifest();
  }
}

export async function saveManifest(path: string, manifest: DatasetManifest): Promise<void> {
  manifest.generatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(manifest, null, 2));
}
