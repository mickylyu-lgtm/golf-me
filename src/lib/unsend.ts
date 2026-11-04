// Unsend a DM within 5 minutes of sending. The database decides
// (public.unsend_message: sender only, created_at within 5 minutes by the
// server clock); this only decides whether to OFFER it, and how to read the
// RPC's answer. No React imports, so tests/unsend.test.ts runs under plain
// node.

export const UNSEND_WINDOW_MS = 5 * 60 * 1000;

export type UnsendResult = "unsent" | "expired" | "failed";

export interface UnsendCandidate {
  id: string;
  senderId: string;
  createdAt: string;
  unsentAt?: string | null;
}

// Offered for my own, real (already stored), not-yet-unsent message while
// it's inside the window by this device's clock. A phone clock that runs
// slow can still offer it a little late; the server then answers
// "expired" and the UI says so.
export function canUnsendMessage(m: UnsendCandidate, selfId: string, nowMs: number): boolean {
  if (!selfId || m.senderId !== selfId || m.unsentAt) return false;
  if (m.id.startsWith("temp-")) return false; // still sending: no row yet
  const sentMs = Date.parse(m.createdAt);
  if (!Number.isFinite(sentMs)) return false;
  return nowMs - sentMs < UNSEND_WINDOW_MS;
}

// Milliseconds until the offer lapses (0 when it already has).
export function unsendRemainingMs(createdAt: string, nowMs: number): number {
  const sentMs = Date.parse(createdAt);
  if (!Number.isFinite(sentMs)) return 0;
  return Math.max(0, sentMs + UNSEND_WINDOW_MS - nowMs);
}

// The RPC's raised hint (PostgREST passes it through as `hint`).
export function classifyUnsendError(error: unknown): UnsendResult {
  if (!error || typeof error !== "object") return "failed";
  const { hint, message } = error as { hint?: unknown; message?: unknown };
  if (hint === "unsend_window_expired") return "expired";
  if (typeof message === "string" && message.includes("unsend_window_expired")) return "expired";
  return "failed";
}
