// The source file, not only a selected crop, must fit this limit.
// Exactly 10 seconds is rejected. Unknown/invalid duration fails closed.
export const MAX_CADDIE_UPLOAD_SECONDS = 10;
export type CaddieDurationRejection = "too_long" | "unreadable";
export function caddieDurationRejection(duration: unknown): CaddieDurationRejection | null {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return "unreadable";
  return duration >= MAX_CADDIE_UPLOAD_SECONDS ? "too_long" : null;
}
// Server routes inspect source-container metadata, before trusting a crop.
// Never return/log the input: ffmpeg metadata can contain private information.
export function sourceDurationFromFfmpeg(log: string): number | undefined {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : undefined;
}
