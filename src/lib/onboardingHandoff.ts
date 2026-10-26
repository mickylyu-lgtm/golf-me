// Set by Quick Profile right before its save flips the session to onboarded,
// so GuestOnly sends that render straight to /ready instead of "/". Going
// through "/" mounted Home for a frame, which auto-started the tutorial and
// flashed it on the way to Ready (Micky, 2026-10-26). Cleared by Ready on
// mount, or by Quick Profile when the save fails. Read-only in render, so a
// double render (StrictMode) sees the same answer.
let finishing = false;

export function setOnboardingFinishing(value: boolean): void {
  finishing = value;
}

export function isOnboardingFinishing(): boolean {
  return finishing;
}
