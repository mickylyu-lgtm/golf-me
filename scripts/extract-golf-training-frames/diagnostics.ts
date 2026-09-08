// Pixel-level quality diagnostics -- no pose/object model involved, just
// image statistics via sharp (already a project dependency). These are
// deliberately cheap proxies:
//   - brightness/contrast: mean/stdev of the grayscale histogram.
//   - blur: "variance of Laplacian" (Aslund's classic no-reference blur
//     metric) -- convolve with a Laplacian kernel, then take the variance of
//     the result. A sharp, in-focus frame has lots of high-frequency edge
//     energy (high variance); a motion-blurred one is smoothed out (low
//     variance). This is the same proxy used for "is this frame in focus"
//     in most classic (pre-deep-learning) blur-detection pipelines.
// None of this can tell you WHY a frame is hard (occlusion, hands
// overlapping, club-behind-body) -- that needs a working pose/object model,
// which is exactly what v2 doesn't have yet. See session-metadata.ts for the
// manual-tagging escape hatch for everything pixel stats can't see.
import sharp from "sharp";

const BLUR_ANALYSIS_WIDTH = 320; // large enough that Laplacian variance is meaningful, small enough to stay cheap
const LAPLACIAN_KERNEL = { width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] };

export interface ImageDiagnostics {
  brightnessMean: number; // 0-255, grayscale mean
  contrastStdDev: number; // 0-255, grayscale stdev
  blurVariance: number; // variance of Laplacian; lower = blurrier
  flags: string[];
}

const DARK_THRESHOLD = 60;
const OVEREXPOSED_THRESHOLD = 200;
const LOW_CONTRAST_THRESHOLD = 20;
// Calibrated empirically against this project's early batches, not a
// universal constant -- revisit if real footage runs consistently
// higher-resolution/sharper than what v1 labeling has seen so far.
const BLUR_THRESHOLD = 150;

export async function computeImageDiagnostics(input: Buffer | string): Promise<ImageDiagnostics> {
  const base = sharp(input).grayscale();

  const stats = await base.clone().stats();
  const brightnessMean = stats.channels[0].mean;
  const contrastStdDev = stats.channels[0].stdev;

  const { data, info } = await base
    .clone()
    .resize(BLUR_ANALYSIS_WIDTH, null, { fit: "inside" })
    .convolve(LAPLACIAN_KERNEL)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  let variance = 0;
  for (let i = 0; i < data.length; i++) variance += (data[i] - mean) ** 2;
  const blurVariance = variance / data.length;
  void info;

  const flags: string[] = [];
  if (brightnessMean < DARK_THRESHOLD) flags.push("dark");
  if (brightnessMean > OVEREXPOSED_THRESHOLD) flags.push("overexposed");
  if (contrastStdDev < LOW_CONTRAST_THRESHOLD) flags.push("low-contrast");
  if (blurVariance < BLUR_THRESHOLD) flags.push("blurry");

  return {
    brightnessMean: Math.round(brightnessMean * 10) / 10,
    contrastStdDev: Math.round(contrastStdDev * 10) / 10,
    blurVariance: Math.round(blurVariance * 10) / 10,
    flags,
  };
}
