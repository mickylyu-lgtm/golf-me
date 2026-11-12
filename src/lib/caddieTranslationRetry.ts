// Translation refusals can be the legacy short cooldown or a minute/day
// budget. Keep server metadata and never turn either into an immediate loop.
const DAY_MS = 86_400_000;
const MIN_RETRY_MS = 5_500;
const MAX_FALLBACK_MS = 300_000;

export async function translationRequestError(error: { message: string; context?: unknown }): Promise<Error> {
  const response = error.context instanceof Response ? error.context : undefined;
  let message = error.message;
  let code: string | undefined;
  let retryAfterSeconds: number | undefined;
  try {
    const body = await response?.clone().json();
    if (typeof body?.error === "string") message = body.error;
    if (typeof body?.code === "string") code = body.code;
    if (typeof body?.retryAfterSeconds === "number") retryAfterSeconds = body.retryAfterSeconds;
  } catch { /* Gateways may return a non-JSON body. */ }
  return Object.assign(new Error(message), {
    status: response?.status, code, retryAfterSeconds,
    retryAfter: response?.headers.get("Retry-After") ?? undefined,
  });
}

export function translationRetryDelay(error: unknown, failures = 1, now = Date.now()): number | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { status?: unknown; code?: unknown; retryAfter?: unknown; retryAfterSeconds?: unknown };
  if (e.status !== 429 && !(e.status === 503 && e.code === "rate_limit_unavailable")) return null;
  const seconds = typeof e.retryAfter === "string" && e.retryAfter.trim() !== "" ? Number(e.retryAfter) : NaN;
  const date = typeof e.retryAfter === "string" && !Number.isFinite(seconds) ? Date.parse(e.retryAfter) : NaN;
  const bodySeconds = typeof e.retryAfterSeconds === "number" ? e.retryAfterSeconds : NaN;
  const supplied = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000
    : Number.isFinite(date) && date > now ? date - now
    : Number.isFinite(bodySeconds) && bodySeconds > 0 ? bodySeconds * 1000 : null;
  // Missing/malformed metadata backs off from the historic 5.5s cooldown,
  // capped at five minutes. Valid daily budgets retain their full wait.
  return supplied === null
    ? Math.min(MAX_FALLBACK_MS, MIN_RETRY_MS * 2 ** Math.min(10, Math.max(0, failures - 1)))
    : Math.min(DAY_MS, Math.max(MIN_RETRY_MS, Math.ceil(supplied)));
}
