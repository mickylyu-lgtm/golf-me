// The trim selector's starting window. A fresh pick starts at 0 with the
// longest allowed window; "Change section" reopens it on the window chosen
// before. That earlier window is clamped to the clip and the selector's own
// rules (at most maxSeconds long, at least minSeconds unless the clip itself
// is shorter), so a stale or odd value can never open an invalid selection.
export function initialTrimWindow(
  duration: number,
  maxSeconds: number,
  minSeconds: number,
  previous?: { start?: number; end?: number },
): { start: number; end: number } {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const maxLength = Math.min(maxSeconds, total);
  const minLength = Math.min(minSeconds, maxLength);
  const fresh = { start: 0, end: maxLength };
  const prevStart = previous?.start;
  const prevEnd = previous?.end;
  if (prevStart === undefined || prevEnd === undefined || !Number.isFinite(prevStart) || !Number.isFinite(prevEnd)) {
    return fresh;
  }
  const length = Math.min(maxLength, Math.max(minLength, prevEnd - prevStart));
  const start = Math.min(total - length, Math.max(0, prevStart));
  return { start, end: start + length };
}
