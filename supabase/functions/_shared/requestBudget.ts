// Database-backed, cross-replica budgets. Never substitute an in-memory Map:
// replicas, cold starts, refreshed JWTs and changed IPs would reset it.
export type BudgetAction = "course-search" | "course-enrich" | "course-photos" | "translate-caddie-analysis" | "chat-video";
export interface BudgetClient {
  rpc(name: string, args: Record<string, unknown>): {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  };
}
export type BudgetDecision =
  | { allowed: true }
  | { allowed: false; status: 429 | 503; code: "rate_limited" | "rate_limit_unavailable"; retryAfter: number };

export async function consumeRequestBudget(client: BudgetClient, action: BudgetAction): Promise<BudgetDecision> {
  // Fail closed on missing migration, timeouts and malformed answers. No
  // provider/ffmpeg work is allowed when the central counter is unavailable.
  const unavailable: BudgetDecision = { allowed: false, status: 503, code: "rate_limit_unavailable", retryAfter: 30 };
  try {
    const { data, error } = await client.rpc("consume_request_budget", { p_action: action })
      .abortSignal(AbortSignal.timeout(5000));
    if (error || !data || typeof data !== "object") return unavailable;
    const d = data as Record<string, unknown>;
    if (d.allowed === true && d.retry_after_seconds === 0) return { allowed: true };
    if (d.allowed === false && typeof d.retry_after_seconds === "number" &&
        Number.isInteger(d.retry_after_seconds) && d.retry_after_seconds >= 1 && d.retry_after_seconds <= 86400) {
      return { allowed: false, status: 429, code: "rate_limited", retryAfter: d.retry_after_seconds };
    }
    return unavailable;
  } catch {
    return unavailable;
  }
}

export function budgetResponse(decision: BudgetDecision, cors: Record<string, string>): Response | null {
  if (decision.allowed) return null;
  return new Response(JSON.stringify({
    error: decision.status === 429 ? "Too many requests. Please try again later." : "Please try again shortly.",
    code: decision.code, retryAfterSeconds: decision.retryAfter,
  }), { status: decision.status, headers: {
    ...cors, "Content-Type": "application/json", "Retry-After": String(decision.retryAfter),
    "Cache-Control": "no-store", "Access-Control-Expose-Headers": "Retry-After",
  } });
}
