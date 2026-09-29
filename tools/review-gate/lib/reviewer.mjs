// Calls the reviewer through a transport with the approved retry/backoff rules
// and strict response validation. Returns an outcome, never throws.
import { validateResponse } from "./schema.mjs";
import { TransportError } from "./transport.mjs";

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(headers, cap) {
  const v = headers?.["retry-after"] ?? headers?.["Retry-After"];
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n * 1000, cap) : null;
}

/**
 * @returns {Promise<{outcome:"ok"|"unavailable"|"quota_exhausted"|"config_error"|"malformed", validation?, attempts:Array, reason:string}>}
 */
export async function callReviewer(request, { transport, limits, onAttempt, sleep = defaultSleep, deadline }) {
  const attempts = [];
  const delays = limits.retryDelaysMs;
  let transientRetries = 0;
  let malformedRetries = 0;

  for (;;) {
    if (deadline && Date.now() > deadline) return { outcome: "unavailable", attempts, reason: "total review time limit exceeded" };
    let res;
    try {
      res = await transport(request, { timeoutMs: limits.requestTimeoutMs });
    } catch (err) {
      const kind = err instanceof TransportError ? err.kind : "crash";
      attempts.push({ outcome: kind });
      // "disabled" and "config" fail before any request leaves the machine, so they are not counted.
      onAttempt?.({ outcome: kind, counted: kind !== "disabled" && kind !== "config" });
      if (kind === "disabled") return { outcome: "unavailable", attempts, reason: err.message };
      if (kind === "config") return { outcome: "config_error", attempts, reason: err.message };
      if (transientRetries < delays.length) {
        await sleep(delays[transientRetries++]);
        continue;
      }
      return { outcome: "unavailable", attempts, reason: `reviewer ${kind} after ${attempts.length} attempts` };
    }

    const usage = res.usage ?? {};
    const status = res.status;
    if (status === 429) {
      let code = "";
      try {
        code = JSON.parse(res.bodyText)?.error?.code ?? "";
      } catch {
        /* ignore */
      }
      if (code === "insufficient_quota") {
        attempts.push({ outcome: "quota_exhausted", status });
        onAttempt?.({ outcome: "quota_exhausted", status, counted: true, usage });
        return { outcome: "quota_exhausted", attempts, reason: "OpenAI project budget exhausted (insufficient_quota)" };
      }
      attempts.push({ outcome: "rate_limited", status });
      onAttempt?.({ outcome: "rate_limited", status, counted: true, usage });
      if (transientRetries < delays.length) {
        await sleep(retryAfterMs(res.headers, limits.maxRetryAfterMs) ?? delays[transientRetries]);
        transientRetries++;
        continue;
      }
      return { outcome: "unavailable", attempts, reason: "rate limited (429) after retries" };
    }
    if (status >= 500) {
      attempts.push({ outcome: "http_5xx", status });
      onAttempt?.({ outcome: "http_5xx", status, counted: true, usage });
      if (transientRetries < delays.length) {
        await sleep(delays[transientRetries++]);
        continue;
      }
      return { outcome: "unavailable", attempts, reason: `HTTP ${status} after retries` };
    }
    if (status >= 400) {
      attempts.push({ outcome: "config_error", status });
      onAttempt?.({ outcome: "config_error", status, counted: true, usage });
      return { outcome: "config_error", attempts, reason: `HTTP ${status} (configuration error, not retried)` };
    }

    const validation = validateResponse(res.bodyText, { task_id: request.task_id, work_hash: request.work_hash }, limits);
    attempts.push({ outcome: validation.ok ? "ok" : "malformed", status });
    onAttempt?.({ outcome: validation.ok ? "ok" : "malformed", status, counted: true, usage });
    if (validation.ok) return { outcome: "ok", attempts, validation, reason: "ok" };
    if (malformedRetries < limits.maxMalformedRetries) {
      malformedRetries++;
      continue;
    }
    return { outcome: "malformed", attempts, validation, reason: `invalid reviewer response: ${validation.errors.slice(0, 3).join("; ")}` };
  }
}
