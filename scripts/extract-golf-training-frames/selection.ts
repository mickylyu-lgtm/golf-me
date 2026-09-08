// Frame selection: which of the dense candidate frames actually get written
// out for labeling.
//
// Two selection pressures, deliberately kept separate rather than folded
// into one score:
//   1. "Diversity" fill (the original v1 approach) -- greedily picks by
//      frame-to-frame visual difference, anchored at the first (Address) and
//      last (Finish) candidates, enforcing minGapSeconds so near-duplicates
//      never both get picked. This naturally spreads picks across
//      backswing/top/downswing/impact/follow-through without any
//      phase-detection model.
//   2. "Hard-example" fill (new) -- reserves a fraction of the frame budget
//      for the candidates with the LOWEST blur-variance (i.e. the most
//      motion-blurred) that diversity fill didn't already pick. Plain
//      diversity fill tends to favor frames adjacent to a blur spike rather
//      than the blurriest frame itself (a slightly-less-blurred neighbor can
//      score just as "different" from its predecessor); this pass makes
//      sure genuinely hard frames survive into the dataset instead of being
//      selected past in favor of easier-to-see ones. See diagnostics.ts's
//      header for what this can't do (occlusion/hand-overlap/club-position
//      need a working pose model, not pixel stats).
import type { ImageDiagnostics } from "./diagnostics.ts";
import { computeImageDiagnostics } from "./diagnostics.ts";
import sharp from "sharp";

const THUMBNAIL_SIZE = 24; // small on purpose -- this only needs to capture "how much moved," not fine detail
const HARD_EXAMPLE_FRACTION = 0.2;
const MIN_HARD_EXAMPLE_SLOTS = 2;

export interface Candidate {
  path: string;
  timestampSeconds: number;
  diffScore: number; // mean absolute grayscale pixel difference vs the previous candidate, 0-255
  diagnostics: ImageDiagnostics;
}

export async function scoreCandidates(files: { path: string; timestampSeconds: number }[]): Promise<Candidate[]> {
  const thumbs: Buffer[] = [];
  const diagnostics: ImageDiagnostics[] = [];
  for (const f of files) {
    const buf = await sharp(f.path).resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "fill" }).grayscale().raw().toBuffer();
    thumbs.push(buf);
    diagnostics.push(await computeImageDiagnostics(f.path));
  }
  return files.map((f, i) => {
    const diffScore = i === 0 ? Infinity : diffOf(thumbs[i - 1], thumbs[i]); // first candidate always "maximally different" -- guarantees it's eligible as the Address anchor
    return { ...f, diffScore, diagnostics: diagnostics[i] };
  });
}

function diffOf(a: Buffer, b: Buffer): number {
  let sum = 0;
  for (let p = 0; p < a.length; p++) sum += Math.abs(a[p] - b[p]);
  return sum / a.length;
}

export type SelectionReason = "anchor-start" | "anchor-end" | "diversity" | "hard-example-blur" | "min-fill";
export interface SelectedCandidate {
  candidate: Candidate;
  reason: SelectionReason;
}

export function selectDiverseFrames(candidates: Candidate[], minFrames: number, maxFrames: number, minGapSeconds: number): SelectedCandidate[] {
  if (candidates.length === 0) return [];
  const selected: SelectedCandidate[] = [{ candidate: candidates[0], reason: "anchor-start" }];
  if (candidates.length > 1) selected.push({ candidate: candidates[candidates.length - 1], reason: "anchor-end" });

  const isFarEnough = (t: number) => selected.every((s) => Math.abs(s.candidate.timestampSeconds - t) >= minGapSeconds);
  const isSelected = (c: Candidate) => selected.some((s) => s.candidate === c);

  const anchorCount = selected.length;
  const hardQuota = Math.max(0, Math.min(maxFrames - anchorCount, Math.max(MIN_HARD_EXAMPLE_SLOTS, Math.round(maxFrames * HARD_EXAMPLE_FRACTION))));
  const diversityCeiling = anchorCount + Math.max(0, maxFrames - anchorCount - hardQuota);

  const rankedByDiff = candidates
    .filter((c) => !isSelected(c))
    .sort((a, b) => b.diffScore - a.diffScore);
  for (const c of rankedByDiff) {
    if (selected.length >= diversityCeiling) break;
    if (!isFarEnough(c.timestampSeconds)) continue;
    selected.push({ candidate: c, reason: "diversity" });
  }

  // Hard-example pass: fill the reserved quota with the blurriest remaining
  // candidates (lowest blurVariance), respecting the gap constraint against
  // everything already picked.
  const rankedByBlur = candidates
    .filter((c) => !isSelected(c))
    .sort((a, b) => a.diagnostics.blurVariance - b.diagnostics.blurVariance);
  for (const c of rankedByBlur) {
    if (selected.length >= maxFrames) break;
    if (selected.filter((s) => s.reason === "hard-example-blur").length >= hardQuota) break;
    if (!isFarEnough(c.timestampSeconds)) continue;
    selected.push({ candidate: c, reason: "hard-example-blur" });
  }

  // Relax the gap constraint only if we're still short of the minimum -- a
  // very short/low-motion clip shouldn't silently produce too few frames to
  // be useful for labeling.
  if (selected.length < minFrames) {
    for (const c of rankedByDiff) {
      if (selected.length >= minFrames) break;
      if (isSelected(c)) continue;
      selected.push({ candidate: c, reason: "min-fill" });
    }
  }

  return selected.sort((a, b) => a.candidate.timestampSeconds - b.candidate.timestampSeconds);
}
