// Edit my own text message within 5 minutes of sending (DMs and round chats).
// The database decides (public.edit_message / public.edit_round_message,
// migration 20261108140000): sender only, still allowed to post in that chat,
// text messages only, and
//     created_at <= now() < created_at + 5 minutes
// by the DATABASE clock, from the message's original created_at (editing
// never moves it). This file only decides whether to OFFER Edit, and how to
// read the RPC's answer. The device clock is used for the offer only: a slow
// phone may offer Edit a little late and the server then answers "expired";
// the edit sheet stays open with the golfer's text so nothing typed is lost.
// No React imports, so tests/messageEdit.test.ts runs under plain node.

export const EDIT_WINDOW_MS = 5 * 60 * 1000;

export type EditResult =
  | "edited"
  | "unchanged"
  | "expired"
  | "unsent"
  | "conflict"
  | "empty"
  | "objectionable"
  | "suspended"
  | "notAllowed"
  | "notText"
  | "unsupported"
  | "failed";

export interface EditCandidate {
  id: string;
  senderId: string;
  createdAt: string;
  text: string;
  unsentAt?: string | null;
  system?: boolean;
  delivery?: string;
  image?: unknown;
  voice?: unknown;
  media?: unknown;
}

// A text message: no photo, voice message, video or album (a captioned photo
// is a photo; its media is never replaced, so it isn't editable either).
export function isTextMessage(m: Pick<EditCandidate, "text" | "image" | "voice" | "media">): boolean {
  return !m.image && !m.voice && !m.media && m.text.trim() !== "";
}

// Offered for my own, stored, not-unsent text message while it's inside the
// window by this device's clock.
export function canEditMessage(m: EditCandidate, selfId: string, nowMs: number): boolean {
  if (!selfId || m.senderId !== selfId || m.unsentAt || m.system || m.delivery) return false;
  if (m.id.startsWith("temp-")) return false; // still sending: no row yet
  if (!isTextMessage(m)) return false;
  return editRemainingMs(m.createdAt, nowMs) > 0;
}

// Milliseconds until the offer lapses (0 when it already has).
export function editRemainingMs(createdAt: string, nowMs: number): number {
  const sentMs = Date.parse(createdAt);
  if (!Number.isFinite(sentMs)) return 0;
  return Math.max(0, sentMs + EDIT_WINDOW_MS - nowMs);
}

// The same trim a send does (text.trim()); the server trims again.
export function normalizeEditText(text: string): string {
  return text.trim();
}

// What Save would do with this draft: nothing to save when it's empty or
// the same as the message already says.
export function editDraftState(draft: string, current: string): "empty" | "unchanged" | "ready" {
  const next = normalizeEditText(draft);
  if (!next) return "empty";
  return next === current ? "unchanged" : "ready";
}

// The RPC isn't deployed (PostgREST PGRST202 "Could not find the function",
// Postgres 42883 undefined function): Edit is then hidden.
export function isMissingEditRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "PGRST202" || code === "42883") return true;
  return typeof message === "string" && /could not find the function public\.edit_(round_)?message/i.test(message);
}

// The RPC's raised hint (PostgREST passes it through as `hint`; the message
// starts with the same token).
export function classifyEditError(error: unknown): EditResult {
  if (!error || typeof error !== "object") return "failed";
  if (isMissingEditRpc(error)) return "unsupported";
  const { hint, message } = error as { hint?: unknown; message?: unknown };
  const tokens = [hint, message].filter((s): s is string => typeof s === "string").join(" ");
  if (tokens.includes("edit_window_expired")) return "expired";
  if (tokens.includes("edit_message_unsent")) return "unsent";
  if (tokens.includes("edit_conflict")) return "conflict";
  if (tokens.includes("edit_empty")) return "empty";
  if (tokens.includes("edit_not_text")) return "notText";
  if (tokens.includes("edit_not_allowed")) return "notAllowed";
  if (tokens.includes("objectionable_content")) return "objectionable";
  if (tokens.includes("account_suspended")) return "suspended";
  return "failed";
}

export interface EditResponse {
  status: "edited" | "unchanged";
  text: string;
  editedAt: string | null;
}

// The RPC's jsonb answer: {"status","text","edited_at"}.
export function parseEditResponse(data: unknown): EditResponse | null {
  if (!data || typeof data !== "object") return null;
  const { status, text, edited_at } = data as { status?: unknown; text?: unknown; edited_at?: unknown };
  if ((status !== "edited" && status !== "unchanged") || typeof text !== "string") return null;
  return { status, text, editedAt: typeof edited_at === "string" ? edited_at : null };
}

// Demo accounts (no database): the same rules on the localStorage copy, in
// the same order as the RPC. Returns the result and, when edited, the new
// text + edited time to store.
export function demoEdit(
  target: EditCandidate | undefined,
  selfId: string,
  text: string,
  expectedText: string | undefined,
  nowMs: number,
): { result: EditResult; text?: string; editedAt?: string } {
  if (!target || target.system || target.senderId !== selfId) return { result: "notAllowed" };
  if (target.unsentAt) return { result: "unsent" };
  if (!isTextMessage(target)) return { result: "notText" };
  if (editRemainingMs(target.createdAt, nowMs) <= 0) return { result: "expired" };
  const next = normalizeEditText(text);
  if (!next) return { result: "empty" };
  if (next === target.text) return { result: "unchanged" };
  if (expectedText !== undefined && expectedText !== target.text) return { result: "conflict" };
  return { result: "edited", text: next, editedAt: new Date(nowMs).toISOString() };
}
