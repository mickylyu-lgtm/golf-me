// Server-side content filter (migration 20260930120000_add_objectionable_content_filter):
// a BEFORE INSERT/UPDATE trigger rejects posts, comments, profile text, round
// notes/course names, round chat and DMs that contain a blocked term. It raises
// P0001 with the stable token below in both the message and the hint.
export const OBJECTIONABLE_CONTENT_TOKEN = "objectionable_content";

// Deliberately not `instanceof Error`: AuthContext.saveProfile rethrows the raw
// PostgrestError object, while other contexts wrap it as `new Error(message)`.
export function isObjectionableContentError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { message, hint } = err as { message?: unknown; hint?: unknown };
  return [message, hint].some((s) => typeof s === "string" && s.includes(OBJECTIONABLE_CONTENT_TOKEN));
}

/** Outcome of a chat send (round chat or DM): lets the UI show the moderation toast instead of a generic retry message. */
export type SendMessageResult = "sent" | "failed" | "objectionable";
