// Round group chat: who can see / post, and the optimistic send state of a
// real (Supabase) round message. Pure (no React; imports only other pure libs) so
// tests/roundChat.test.ts runs it under node --test; RealRoundsContext,
// GroupChat, GolfCallDetail and RoundChatThread wire it up.
import type { ChatMessage, GolfCallStatus } from "../types";
import { imageFromRow } from "./chatImages.ts";
import type { ChatImageRef, ImageRowColumns, ImageSendFailure } from "./chatImages.ts";
import { voiceFromRow } from "./chatVoice.ts";
import type { VoiceRowColumns } from "./chatVoice.ts";
import { failedSendOutcome } from "./dmFailedSend.ts";
import { isObjectionableContentError, type SendMessageResult } from "./objectionableContent.ts";
import { mediaFromRow } from "./chatMedia.ts";
import type { ChatMediaItem } from "./chatMedia.ts";
import type { OutgoingMediaItemState } from "../types";

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

// What the viewer gets for a round's chat:
//   open        member, round open/full: read + post
//   ended       member, round completed: read only
//   cancelled   member, round cancelled: read only
//   blocked     a block exists either way between the viewer and the host
//               (the server refuses their posts, migration 20260924100300)
//   left        the viewer was in the round and left it (RLS no longer
//               returns its messages to them)
//   locked      never a member
//   unavailable the round doesn't exist, or is hidden from the viewer
// Only open / ended / cancelled ever show messages.
export type RoundChatAccess = "open" | "ended" | "cancelled" | "blocked" | "left" | "locked" | "unavailable";

export interface RoundChatAccessInput {
  /** The round resolved for this viewer (DataContext.getGolfCall hides a blocked host's round from non-members). */
  exists: boolean;
  status?: GolfCallStatus;
  isHost: boolean;
  isJoined: boolean;
  hasLeft: boolean;
  /** Block either way between the viewer and the round's host. Ignored for the host. */
  blockedWithHost: boolean;
}

export function roundChatAccess(input: RoundChatAccessInput): RoundChatAccess {
  if (!input.exists) return "unavailable";
  const isMember = input.isHost || input.isJoined;
  if (!isMember) {
    if (input.hasLeft) return "left";
    return input.blockedWithHost ? "blocked" : "locked";
  }
  if (!input.isHost && input.blockedWithHost) return "blocked";
  if (input.status === "cancelled") return "cancelled";
  if (input.status === "completed") return "ended";
  return "open";
}

/** Messages are shown (members only). */
export function canReadRoundChat(access: RoundChatAccess): boolean {
  return access === "open" || access === "ended" || access === "cancelled";
}

/** The composer is shown. Mirrors the round_messages insert policy (migration 20261103120000). */
export function canPostRoundChat(access: RoundChatAccess): boolean {
  return access === "open";
}

// ---------------------------------------------------------------------------
// Pending / sent / failed
// ---------------------------------------------------------------------------

// Why a send failed:
//   rejected  the server refused it (RLS: no longer a member, a block, or
//             the round has ended). Retrying won't help until that changes.
//   network   anything else (offline, timeout, 5xx): retry is worthwhile.
//   objectionable  the content filter refused the text (P0001
//             objectionable_content). Never resent as is: the bubble offers
//             Edit (back into the composer) and Discard, no Retry.
export type RoundSendFailure = "rejected" | "network" | "objectionable";

export interface PendingRoundMessage {
  clientId: string;
  roundId: string;
  senderId: string;
  text: string;
  /** Local clock, only for ordering on screen. */
  createdAt: string;
  /**
   * sending  insert in flight (subtle bubble)
   * sent     insert succeeded; kept until the refetched round_messages list
   *          contains serverId, so a refetch that started before the insert
   *          can't make the message blink out
   * failed   insert failed; kept with "Not sent · Tap to retry" until the
   *          golfer retries or discards it
   */
  state: "sending" | "sent" | "failed";
  serverId?: string;
  serverCreatedAt?: string;
  failure?: RoundSendFailure;
  /** The message it quotes (swipe-to-reply), kept for a retry. */
  replyToId?: string | null;
  /**
   * A photo message (lib/chatImages.ts): the id made on this device (also
   * the storage file name and the row's id), this device's copy, upload
   * progress and, when failed, why. The bytes themselves are kept by the
   * context, not here.
   */
  photo?: PendingRoundPhoto;
}

export interface PendingRoundPhoto {
  messageId: string;
  localUrl: string;
  width: number;
  height: number;
  thumb: string | null;
  progress: number;
  failure?: ImageSendFailure;
  /** Set once uploaded. */
  path?: string;
  /** A voice message (lib/chatVoice.ts) instead of a photo: same send machinery. */
  audio?: { durationMs: number; mime: string };
  /** A video / album (lib/chatMedia.ts): items' shape, and their local copies + progress. `path` is then the items' prefix. */
  mediaKinds?: { kind: "image" | "video"; width: number; height: number; durationMs: number; thumb: string | null }[];
  media?: OutgoingMediaItemState[];
}

export interface RoundMessageRowLike extends ImageRowColumns, VoiceRowColumns {
  id: string;
  round_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  // Only present once migration 20261107130000_round_chat_parity is
  // applied; their presence on fetched rows is how the client detects
  // replies and unsend (roundRowsHaveColumn).
  reply_to_message_id?: string | null;
  unsent_at?: string | null;
  /** Only present once migration 20261108140000_chat_message_edit is applied (editSupported). */
  edited_at?: string | null;
  /** A video / album (migration 20261107220000). */
  media?: unknown;
}

export function createPendingRoundMessage(input: {
  clientId: string;
  roundId: string;
  senderId: string;
  text: string;
  replyToId?: string | null;
  now?: Date;
  photo?: PendingRoundPhoto;
}): PendingRoundMessage {
  return {
    clientId: input.clientId,
    roundId: input.roundId,
    senderId: input.senderId,
    text: input.text,
    createdAt: (input.now ?? new Date()).toISOString(),
    state: "sending",
    replyToId: input.replyToId ?? null,
    ...(input.photo ? { photo: input.photo } : {}),
  };
}

/** Updates a pending photo's display state (progress, path, failure). */
export function patchRoundPhoto(pending: readonly PendingRoundMessage[], clientId: string, patch: Partial<PendingRoundPhoto>): PendingRoundMessage[] {
  return pending.map((p) => (p.clientId === clientId && p.photo ? { ...p, photo: { ...p.photo, ...patch } } : p));
}

/** A pending video / album's items: real paths once stored (prefix in `path`), placeholders before. */
function pendingMedia(photo: PendingRoundPhoto): ChatMediaItem[] {
  return (photo.mediaKinds ?? []).map((k, i) => ({
    kind: k.kind,
    path: photo.path ? `${photo.path}/${i}.${k.kind === "video" ? "mp4" : "jpg"}` : `pending/${photo.messageId}/${i}`,
    poster: k.kind === "video" ? (photo.path ? `${photo.path}/${i}.poster.jpg` : null) : undefined,
    width: k.width,
    height: k.height,
    durationMs: k.kind === "video" ? k.durationMs : undefined,
    thumb: k.thumb,
  }));
}

/** The image a pending message shows: the stored path once uploaded, else a placeholder key (shown from localUrl). */
function pendingImage(photo: PendingRoundPhoto): ChatImageRef {
  return { path: photo.path ?? `pending/${photo.messageId}`, width: photo.width, height: photo.height, thumb: photo.thumb };
}

// ---------------------------------------------------------------------------
// Feature detection (migration 20261107130000_round_chat_parity)
// ---------------------------------------------------------------------------

/** A fetched row carries this column (rows are selected with "*"), i.e. the migration is applied. */
export function roundRowsHaveColumn(rows: readonly object[], column: "reply_to_message_id" | "unsent_at" | "edited_at"): boolean {
  return rows.some((r) => Object.prototype.hasOwnProperty.call(r, column));
}

/**
 * The insert named reply_to_message_id before the migration (PostgREST
 * PGRST204 "Could not find the 'reply_to_message_id' column", Postgres
 * 42703), or quoted a message the database says isn't in this round
 * (hint reply_not_in_round). Either way the text is sent again without the
 * quote rather than failing.
 */
export function shouldResendWithoutReply(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message, hint } = error as { code?: unknown; message?: unknown; hint?: unknown };
  if (hint === "reply_not_in_round") return true;
  if (typeof message === "string" && message.includes("reply_not_in_round")) return true;
  return (code === "PGRST204" || code === "42703") && typeof message === "string" && message.includes("reply_to_message_id");
}

/** Who can be quoted / reacted to / unsent: a stored (not still-sending, not failed), not-unsent, non-system message. */
export function isActionableRoundMessage(m: Pick<ChatMessage, "id" | "system" | "delivery" | "unsentAt">): boolean {
  return !m.system && !m.delivery && !m.unsentAt && !m.id.startsWith("temp-");
}

function update(pending: readonly PendingRoundMessage[], clientId: string, patch: (p: PendingRoundMessage) => PendingRoundMessage): PendingRoundMessage[] {
  return pending.map((p) => (p.clientId === clientId ? patch(p) : p));
}

export function markRoundMessageSent(pending: readonly PendingRoundMessage[], clientId: string, row?: { id: string; created_at: string } | null): PendingRoundMessage[] {
  return update(pending, clientId, (p) => ({ ...p, state: "sent", failure: undefined, serverId: row?.id, serverCreatedAt: row?.created_at }));
}

export function markRoundMessageFailed(pending: readonly PendingRoundMessage[], clientId: string, failure: RoundSendFailure): PendingRoundMessage[] {
  return update(pending, clientId, (p) => ({ ...p, state: "failed", failure }));
}

/** A failed message the golfer may resend unchanged: not one the content filter refused. */
export function canRetryRoundMessage(m: { state?: PendingRoundMessage["state"]; delivery?: ChatMessage["delivery"]; failure?: RoundSendFailure }): boolean {
  const failed = m.state === "failed" || m.delivery === "failed";
  return failed && m.failure !== "objectionable";
}

/** Retry: only a failed message goes back to sending, and never a content-filter rejection. */
export function markRoundMessageRetrying(pending: readonly PendingRoundMessage[], clientId: string): PendingRoundMessage[] {
  return update(pending, clientId, (p) => (canRetryRoundMessage(p) ? { ...p, state: "sending", failure: undefined } : p));
}

// ---------------------------------------------------------------------------
// Edit a rejected message (content filter)
// ---------------------------------------------------------------------------

// Same rule as a failed DM (lib/dmFailedSend.ts failedSendOutcome): the
// text goes back into the composer only when that composer is this round's
// and is empty with no reply picked. Otherwise nothing is overwritten
// silently: the golfer is asked "Replace your draft?" (or copies the text).
// A composer showing another round never receives it.
export interface RoundComposerSnapshot {
  roundId: string;
  text: string;
  replyToId: string | null;
}

export type EditRejectedOutcome = "restore" | "confirmReplace" | "otherRound";

export function editRejectedOutcome(composer: RoundComposerSnapshot, message: { roundId: string }): EditRejectedOutcome {
  // "draft" = a different thread: never write into it from here.
  const outcome = failedSendOutcome({ threadId: composer.roundId, text: composer.text, replyToId: composer.replyToId }, message.roundId, "");
  if (outcome === "restore") return "restore";
  return outcome === "keep" ? "confirmReplace" : "otherRound";
}

export function discardRoundMessage(pending: readonly PendingRoundMessage[], clientId: string): PendingRoundMessage[] {
  return pending.filter((p) => p.clientId !== clientId);
}

// The clock skew tolerated when a sent message's id is unknown and it has to
// be matched to its row by content instead.
const MATCH_SKEW_MS = 2 * 60 * 1000;

function rowMatches(p: PendingRoundMessage, row: RoundMessageRowLike): boolean {
  if (p.serverId) return row.id === p.serverId;
  return (
    row.round_id === p.roundId &&
    row.sender_id === p.senderId &&
    row.text === p.text &&
    new Date(row.created_at).getTime() >= new Date(p.createdAt).getTime() - MATCH_SKEW_MS
  );
}

/**
 * Drops sent messages whose real row has arrived. Sending and failed ones are
 * never dropped here: a failed one leaves only by retry or discard, so its
 * text is never silently lost.
 */
export function reconcilePendingRoundMessages(pending: readonly PendingRoundMessage[], rows: readonly RoundMessageRowLike[]): PendingRoundMessage[] {
  if (pending.length === 0) return pending as PendingRoundMessage[];
  const claimed = new Set<string>();
  const next = pending.filter((p) => {
    // A photo message's id is made on the device: once a row with it is
    // here, it is stored, whatever this device last heard (the realtime
    // refetch can beat the insert's own answer).
    if (p.photo && rows.some((r) => r.id === p.photo!.messageId)) return false;
    if (p.state !== "sent") return true;
    const row = rows.find((r) => !claimed.has(r.id) && rowMatches(p, r));
    if (!row) return true;
    claimed.add(row.id);
    return false;
  });
  return next.length === pending.length ? (pending as PendingRoundMessage[]) : next;
}

/**
 * One round's messages for display: the real rows, plus this device's
 * pending ones that aren't in the rows yet. A sent message renders as a
 * normal message (id = its server id once known); sending and failed ones
 * carry `delivery` so GroupChat can style them.
 */
export function mergeRoundMessages(rows: readonly RoundMessageRowLike[], pending: readonly PendingRoundMessage[], roundId: string): ChatMessage[] {
  const real: ChatMessage[] = rows
    .filter((r) => r.round_id === roundId)
    .map((r) => {
      const image = imageFromRow(r);
      const voice = voiceFromRow(r);
      const media = r.media ? mediaFromRow(r.media) : null;
      return {
        ...(voice ? { voice } : {}),
        ...(media ? { media } : {}),
        id: r.id,
        golfCallId: r.round_id,
        senderId: r.sender_id,
        text: r.text,
        createdAt: r.created_at,
        replyToId: r.reply_to_message_id ?? null,
        unsentAt: r.unsent_at ?? null,
        editedAt: r.edited_at ?? null,
        ...(image ? { image } : {}),
      };
    });
  const mine = reconcilePendingRoundMessages(
    pending.filter((p) => p.roundId === roundId),
    rows,
  );
  const extra: ChatMessage[] = mine.map((p) => {
    const photo = p.photo
      ? {
          ...(p.photo.mediaKinds
            ? { media: pendingMedia(p.photo) }
            : p.photo.audio
              ? { voice: { path: p.photo.path ?? `pending/${p.photo.messageId}`, durationMs: p.photo.audio.durationMs } }
              : { image: pendingImage(p.photo) }),
          outgoingPhoto: {
            localUrl: p.photo.localUrl,
            progress: p.state === "sending" ? p.photo.progress : undefined,
            failure: p.state === "failed" ? p.photo.failure : undefined,
            ...(p.photo.media ? { items: p.photo.media } : {}),
          },
        }
      : {};
    return p.state === "sent"
      ? {
          id: p.serverId ?? p.clientId,
          clientId: p.clientId,
          golfCallId: p.roundId,
          senderId: p.senderId,
          text: p.text,
          createdAt: p.serverCreatedAt ?? p.createdAt,
          replyToId: p.replyToId ?? null,
          ...photo,
        }
      : {
          id: p.clientId,
          clientId: p.clientId,
          golfCallId: p.roundId,
          senderId: p.senderId,
          text: p.text,
          createdAt: p.createdAt,
          delivery: p.state,
          failure: p.failure,
          replyToId: p.replyToId ?? null,
          ...photo,
        };
  });
  if (extra.length === 0) return real;
  // Real rows keep server order; this device's unsent ones always sit at the
  // bottom (where the golfer just typed them), in the order they were sent.
  const sent = extra.filter((m) => !m.delivery);
  const unsent = extra.filter((m) => m.delivery);
  const ordered = [...real, ...sent].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...ordered, ...unsent];
}

// Postgres insufficient_privilege (RLS rejected the insert). PostgREST passes
// the SQLSTATE through as `code`.
export function classifyRoundSendError(err: unknown): RoundSendFailure {
  if (isObjectionableContentError(err)) return "objectionable";
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  return code === "42501" ? "rejected" : "network";
}

/**
 * What an insert's answer does to the pending list: only the message with
 * this clientId changes (so a late answer can't touch any other round's or
 * any newer message), and nothing here ever touches a composer.
 */
export function settleRoundSend(
  clientId: string,
  answer: { data?: { id: string; created_at: string } | null; error?: unknown },
): { result: SendMessageResult; failure?: RoundSendFailure; apply: (pending: readonly PendingRoundMessage[]) => PendingRoundMessage[] } {
  if (!answer.error) {
    return { result: "sent", apply: (pending) => markRoundMessageSent(pending, clientId, answer.data ?? null) };
  }
  const failure = classifyRoundSendError(answer.error);
  return {
    result: failure === "objectionable" ? "objectionable" : "failed",
    failure,
    apply: (pending) => markRoundMessageFailed(pending, clientId, failure),
  };
}
