// Email code / magic-link sign-in: the parts of the flow that must not
// depend on React's timing. Kept free of React/Supabase imports so
// tests/emailCodeFlow.test.ts runs under plain node --test.
//
// - A request gate: one send (or verify) in flight at a time, and a response
//   that arrives after the person moved on ("Change email", "Use a different
//   method") is recognised as stale and ignored.
// - The resend countdown, computed from the send time and the clock instead
//   of counted down by timer ticks (timers stop while iOS has the app in the
//   background, e.g. during a trip to Mail).
// - Which auth redirect errors mean "that sign-in link expired or was used".

// Supabase's default minimum gap between sign-in emails to one address.
export const RESEND_COOLDOWN_SECONDS = 60;

// Seconds until another email may be sent, from the moment the cooldown
// started (the last send, or a "too many requests" answer). Clock skew ends
// the countdown rather than stretching it: a start time in the future
// (device clock moved back) or anything non-finite gives 0. The server's
// own rate limit still applies; a 429 starts a fresh countdown.
export function resendSecondsLeft(startedAt: number | null, now: number, cooldownSeconds = RESEND_COOLDOWN_SECONDS): number {
  if (startedAt === null || !Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;
  const elapsed = now - startedAt;
  if (elapsed < 0) return 0;
  const left = cooldownSeconds - Math.floor(elapsed / 1000);
  return left > 0 && left <= cooldownSeconds ? left : 0;
}

// Milliseconds until the shown number changes, or null when the countdown
// is over (no timer needed).
export function msUntilNextSecond(startedAt: number | null, now: number, cooldownSeconds = RESEND_COOLDOWN_SECONDS): number | null {
  if (resendSecondsLeft(startedAt, now, cooldownSeconds) === 0 || startedAt === null) return null;
  return 1000 - ((now - startedAt) % 1000);
}

export interface CountdownEnv {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  // Subscribes to "the app is showing again" (tab visible, window focus,
  // native resume); returns the unsubscribe.
  onResume(fn: () => void): () => void;
}

// Keeps a resend countdown honest: calls onTick(now) right away, on every
// second boundary while counting, and on every resume (the timer may have
// been frozen in the background). The caller derives the seconds left from
// `now` with resendSecondsLeft, so a late or skipped tick never adds time.
// Returns the stop function.
export function watchResendCountdown(startedAt: number | null, onTick: (now: number) => void, env: CountdownEnv): () => void {
  let timer: unknown = null;
  let stopped = false;
  const update = () => {
    if (stopped) return;
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    const now = env.now();
    onTick(now);
    const delay = msUntilNextSecond(startedAt, now);
    if (delay !== null) timer = env.setTimeout(update, delay);
  };
  const unsubscribe = startedAt === null ? () => {} : env.onResume(update);
  update();
  return () => {
    stopped = true;
    if (timer !== null) env.clearTimeout(timer);
    unsubscribe();
  };
}

// Supabase answers an expired link AND an already-used one (often consumed
// by a mail app's link scanner) with error_code=otp_expired; AuthContext
// passes the code, or the description when a redirect has no code.
export function isFailedLinkError(error: string | null): boolean {
  if (!error) return false;
  return error === "otp_expired" || /invalid or has expired/i.test(error);
}

// The 6-box code field: digits only (a pasted "123 456" or "123-456"
// works), never longer than the code. NFKC turns full-width digits (a
// Japanese/Chinese keyboard's ０-９) into ASCII first.
export function sanitizeCode(raw: string, length: number): string {
  return raw.normalize("NFKC").replace(/\D/g, "").slice(0, length);
}

// Auto-submit once every digit is in, but only once per distinct code: a
// wrong code isn't re-sent by itself, and a re-render can't send it twice.
export function shouldAutoSubmit(code: string, length: number, lastSubmitted: string | null): boolean {
  return code.length === length && code !== lastSubmitted;
}

// What an auth redirect error (or AuthContext's own "session_expired")
// means for the sign-in screen. "canceled": the person backed out of Apple
// or Google; never shown as an error.
export type AuthNotice = "linkExpired" | "canceled" | "sessionExpired" | "other";
export const SESSION_EXPIRED = "session_expired";

export function classifyAuthNotice(error: string | null): AuthNotice | null {
  if (!error) return null;
  if (isFailedLinkError(error)) return "linkExpired";
  if (error === SESSION_EXPIRED) return "sessionExpired";
  if (/cancel/i.test(error)) return "canceled";
  return "other";
}

export interface RequestGate {
  // A token for a new request, or null while one is already in flight
  // (double tap, Enter + tap).
  begin(): number | null;
  // Whether this request is still the one the screen is waiting for.
  isCurrent(token: number): boolean;
  // Marks the request finished; true when it was still current.
  end(token: number): boolean;
  // Stop waiting for whatever is in flight; its answer will be stale.
  cancel(): void;
  readonly inFlight: boolean;
}

export function createRequestGate(): RequestGate {
  let seq = 0;
  let active: number | null = null;
  return {
    begin() {
      if (active !== null) return null;
      seq += 1;
      active = seq;
      return active;
    },
    isCurrent(token) {
      return token === active;
    },
    end(token) {
      if (token !== active) return false;
      active = null;
      return true;
    },
    cancel() {
      active = null;
    },
    get inFlight() {
      return active !== null;
    },
  };
}

export type GatedResult<T> =
  | { status: "busy" }
  | { status: "stale" }
  | { status: "ok"; value: T }
  | { status: "error"; error: unknown };

// Runs `run` through the gate. "busy": another request was already in
// flight, nothing ran. "stale": it ran, but the screen stopped waiting for
// it (cancelled, or superseded), so the caller must ignore the answer.
export async function gatedRequest<T>(gate: RequestGate, run: () => Promise<T>): Promise<GatedResult<T>> {
  const token = gate.begin();
  if (token === null) return { status: "busy" };
  try {
    const value = await run();
    return gate.end(token) ? { status: "ok", value } : { status: "stale" };
  } catch (error) {
    return gate.end(token) ? { status: "error", error } : { status: "stale" };
  }
}
