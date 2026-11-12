// Per-call timing for one Roboflow pose pass, so analyze-swing's logs say
// WHY a pass was slow, not only that it was (2026-11-09 trim test: 80 frames,
// 6 retries, 35.8 s, with no way to tell slow calls from 429 back-off from
// 25 s timeouts). Counts and durations only: no frame data, no provider text.

export type PoseCallOutcome = "ok" | "timeout" | "rate_limited" | "server_error" | "client_error" | "network" | "other";

export interface PoseCallRecord {
  ms: number;
  outcome: PoseCallOutcome;
}

export class PoseCallLog {
  private calls: PoseCallRecord[] = [];
  private backoffMs = 0;
  private readonly startedAt: number;
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
    this.startedAt = now();
  }
  record(ms: number, outcome: PoseCallOutcome): void {
    this.calls.push({ ms: Math.max(0, Math.round(ms)), outcome });
  }
  addBackoff(ms: number): void {
    this.backoffMs += Math.max(0, Math.round(ms));
  }
  /** Flat, log-friendly summary (numbers only). */
  summary(): Record<string, number> {
    const okMs = this.calls.filter((c) => c.outcome === "ok").map((c) => c.ms);
    const allMs = this.calls.map((c) => c.ms);
    const count = (o: PoseCallOutcome) => this.calls.filter((c) => c.outcome === o).length;
    return {
      wall_ms: Math.round(this.now() - this.startedAt),
      calls: this.calls.length,
      ok: okMs.length,
      ok_p50_ms: percentile(okMs, 0.5),
      ok_p90_ms: percentile(okMs, 0.9),
      ok_max_ms: okMs.length ? Math.max(...okMs) : 0,
      max_call_ms: allMs.length ? Math.max(...allMs) : 0,
      timeouts: count("timeout"),
      rate_limited: count("rate_limited"),
      server_errors: count("server_error"),
      client_errors: count("client_error"),
      network_errors: count("network"),
      other_errors: count("other"),
      backoff_ms: this.backoffMs,
    };
  }
}

/** Nearest-rank percentile; 0 for no samples. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

/** Classifies one failed call from its HTTP status (if any) and the thrown error's name. */
export function poseCallOutcome(httpStatus: number | undefined, errorName: string | undefined): PoseCallOutcome {
  if (typeof httpStatus === "number") {
    if (httpStatus === 429) return "rate_limited";
    if (httpStatus >= 500) return "server_error";
    return "client_error";
  }
  if (errorName === "TimeoutError") return "timeout";
  if (errorName === "TypeError") return "network";
  return "other";
}
