// Starting a job is a Caddie upload only. A retry is a reference to an
// existing analysis; its persisted row, not a client source, is authoritative.
export function caddieRequestSource(body: unknown): "direct_upload" | "retry" | "community_disabled" | "invalid" {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "invalid";
  const request = body as { sourceType?: unknown; retryAnalysisId?: unknown };
  if (typeof request.retryAnalysisId === "string") return "retry";
  if (request.sourceType === "community_post") return "community_disabled";
  return request.sourceType === "direct_upload" ? "direct_upload" : "invalid";
}
