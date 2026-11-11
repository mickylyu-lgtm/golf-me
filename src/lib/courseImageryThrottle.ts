// Shared across thumbnails, pictures and layouts: a server budget rejection
// must not become a direct-provider fallback or a permanent session failure.
export class CourseImageryThrottle {
  private until = 0;
  private account: string | null = null;
  private generation = 0;
  private bindings = new WeakSet<object>();
  scope(): number { return this.generation; }
  setAccount(id: string | null): void {
    if (id === this.account) return;
    this.account = id;
    this.until = 0;
    this.generation++;
  }
  bindAuth(auth: { onAuthStateChange(callback: (event: string, session: { user: { id: string } } | null) => void): unknown }): void {
    if (this.bindings.has(auth)) return;
    this.bindings.add(auth);
    auth.onAuthStateChange((_event, session) => this.setAccount(session?.user.id ?? null));
  }
  active(now = Date.now()): boolean { return now < this.until; }
  async record(error: unknown, now = Date.now(), scope = this.scope()): Promise<boolean> {
    const response = error && typeof error === "object" && "context" in error ? error.context : null;
    if (!(response instanceof Response) || (response.status !== 429 && response.status !== 503)) return false;
    let body: { code?: string; retryAfterSeconds?: number } | null = null;
    try { body = await response.clone().json(); } catch { /* Gateway 429 may have no JSON. */ }
    if (response.status === 503 && body?.code !== "rate_limit_unavailable") return false;
    const header = response.headers.get("Retry-After");
    const numeric = header === null ? NaN : Number(header);
    const date = header === null ? NaN : Date.parse(header);
    const seconds = Number.isFinite(numeric) && numeric > 0 ? numeric
      : Number.isFinite(date) && date > now ? Math.ceil((date - now) / 1000)
      : typeof body?.retryAfterSeconds === "number" && Number.isFinite(body.retryAfterSeconds) && body.retryAfterSeconds > 0
        ? body.retryAfterSeconds : 30;
    // Still suppress fallback for an old account's rejected response, but do
    // not apply its cooldown to the newly signed-in golfer.
    if (scope === this.scope()) this.until = Math.max(this.until, now + Math.min(seconds, 86400) * 1000);
    return true;
  }
}
export const courseImageryThrottle = new CourseImageryThrottle();
