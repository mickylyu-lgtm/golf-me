import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { refetchOnResume } from "../lib/resumeRefetch";
import { useAuth } from "./AuthContext";
import { realRoundToGolfCall } from "../lib/golfCall";
import type { RoundRow, ParticipantRow } from "../lib/golfCall";
import { fetchPublicProfiles } from "../lib/publicProfilesFetch";
import { INITIAL_LOAD_STATUS, applyLoadOutcome, isFirstLoadError, isRefreshError } from "../lib/loadStatus";
import type { SendMessageResult } from "../lib/objectionableContent";
import {
  canRetryRoundMessage,
  createPendingRoundMessage,
  discardRoundMessage as discardPending,
  markRoundMessageFailed,
  markRoundMessageRetrying,
  markRoundMessageSent,
  mergeRoundMessages,
  patchRoundPhoto,
  reconcilePendingRoundMessages,
  roundRowsHaveColumn,
  settleRoundSend,
  shouldResendWithoutReply,
} from "../lib/roundChat";
import { classifyImageInsertError, imageRowColumns, isMissingImageSupportError, progressStep, roundImagePath, rowsHaveImageColumn } from "../lib/chatImages";
import type { ImageSendFailure, ImageSupport, ProcessedChatImage } from "../lib/chatImages";
import { chatImageUrls, removeChatImage, uploadChatImage } from "../lib/chatImageClient";
import { isMissingVoiceSupportError, roundVoicePath, rowsHaveVoiceColumn, voiceFileType, voiceRowColumns } from "../lib/chatVoice";
import type { VoiceClip } from "../lib/voiceRecorder";

// Storage path of a photo / voice send: round/<round>/<id>.jpg | .m4a | .webm.
function roundJobPath(job: { roundId: string; messageId: string; audio?: { mime: string } }): string {
  return job.audio ? roundVoicePath(job.roundId, job.messageId, voiceFileType(job.audio.mime).ext) : roundImagePath(job.roundId, job.messageId);
}
import type { PendingRoundMessage, RoundMessageRowLike } from "../lib/roundChat";
import { classifyUnsendError } from "../lib/unsend";
import type { UnsendResult } from "../lib/unsend";
import { isMissingReactionsTableError, myReaction, overlayPendingReactions, reactionRowsToReactions, withReaction } from "../lib/reactions";
import type { MessageReaction, QuickReaction } from "../lib/reactions";
import { createReactionWriteQueue } from "../lib/reactionWrites";
import { createReactionSeqClock, reactionSeqFromRow, sendReactionWrite } from "../lib/reactionOrder";
import type { OrderingSupport, ReactionTransport } from "../lib/reactionOrder";
import { PROBE_EMOJI, customReactionSupport } from "../lib/customReactions";
import type { ChatMessage, GolfCall, GolferProfile } from "../types";
import type { ReviewInput } from "./DataContext";

type RoundMessageRow = RoundMessageRowLike;

export interface HostRealRoundInput {
  courseId: string | null;
  courseName: string;
  courseAreaLabel: string;
  courseLat: number | null;
  courseLng: number | null;
  dateISO: string;
  timeLabel: string;
  holes: 9 | 18;
  gameFormat: string;
  estimatedPricePerPerson: number | null;
  totalSpots: number;
  skillLevel: string;
  vibe: string;
  walkOrCart: string;
  notes?: string;
}

export interface EditTeeTimeInput {
  courseId: string | null;
  courseName: string;
  courseAreaLabel: string;
  courseLat: number | null;
  courseLng: number | null;
  dateISO: string;
  timeLabel: string;
}

interface RealRoundsContextValue {
  golfCalls: GolfCall[];
  profilesById: Map<string, GolferProfile>;
  isLoading: boolean;
  /** True once the first fetch has finished, success OR failure (always true in demo) — lets a deep-linked page wait instead of showing "not found". Check loadError before treating an empty list as empty. */
  hasLoaded: boolean;
  /** Nothing has loaded yet and the last fetch failed (never in demo). Show an error with retry, not "empty". */
  loadError: boolean;
  /** Data loaded before, but the latest refresh failed; the older data is still in state (never in demo). */
  refreshFailed: boolean;
  /** Re-runs the fetch (isLoading is true while it runs). */
  retry: () => Promise<void>;
  hostRound: (input: HostRealRoundInput) => Promise<GolfCall>;
  joinRound: (roundId: string) => Promise<void>;
  leaveRound: (roundId: string) => Promise<void>;
  cancelRound: (roundId: string) => Promise<void>;
  completeRound: (roundId: string) => Promise<void>;
  editTeeTime: (roundId: string, input: EditTeeTimeInput) => Promise<{ proofInvalidated: boolean }>;
  hasReviewed: (roundId: string, revieweeId: string) => boolean;
  submitReview: (roundId: string, revieweeId: string, input: ReviewInput) => Promise<void>;
  /** Real rows plus this device's sending/failed messages for the round (lib/roundChat.ts). */
  messagesForCall: (roundId: string) => ChatMessage[];
  /** Shows the message at once as "sending"; on failure it stays as a failed bubble (retry/discard; "objectionable" = edit/discard, never resent). Never throws. */
  sendRoundMessage: (roundId: string, text: string, replyToId?: string | null) => Promise<SendMessageResult>;
  retryRoundMessage: (message: { clientId: string; roundId: string; text: string; replyToId?: string | null }) => Promise<SendMessageResult>;
  discardRoundMessage: (clientId: string) => void;
  // Photos (lib/chatImages.ts, migration 20261107170000): offered once the
  // database is known to have round_messages.image_path. A photo send shows
  // at once with upload progress; a failure stays as "Not sent" (the same
  // retry / discard as text, through retryRoundMessage / discardRoundMessage).
  imagesSupported: boolean;
  sendRoundImage: (roundId: string, photo: ProcessedChatImage, text: string, replyToId?: string | null) => Promise<SendMessageResult>;
  // Voice messages (lib/chatVoice.ts, migration 20261107180000).
  voiceSupported: boolean;
  sendRoundVoice: (roundId: string, clip: VoiceClip, replyToId?: string | null) => Promise<SendMessageResult>;
  // Migration 20261107130000_round_chat_parity, each part feature-detected
  // so this ships safely before it: replies / unsend once fetched
  // round_messages rows carry reply_to_message_id / unsent_at; reactions
  // once a select on round_message_reactions succeeds. False until then
  // (and never an error): the UI simply doesn't offer them.
  repliesSupported: boolean;
  unsendSupported: boolean;
  /** Sender only, within 5 minutes by the database clock (public.unsend_round_message). */
  unsendRoundMessage: (messageId: string) => Promise<UnsendResult>;
  reactionsSupported: boolean;
  /** Every reaction this account can see (RLS: rounds it's in), tombstones dropped. */
  roundReactions: MessageReaction[];
  /** Same queue + ordering as DMs (lib/reactionWrites, lib/reactionOrder). false = my latest tap failed and was rolled back. */
  setRoundReaction: (messageId: string, emoji: QuickReaction | null) => Promise<boolean>;
  /** The signed-in golfer was in this round and left it (participant row 'left'). */
  hasLeftRound: (roundId: string) => boolean;
}

function reviewKey(roundId: string, revieweeId: string): string {
  return `${roundId}:${revieweeId}`;
}

// Newest reactions loaded per fetch (RLS scopes them to my rounds). Round
// chats are small (at most four golfers) and recent, so this covers them.
const ROUND_REACTION_WINDOW = 2000;

type Support = "unknown" | "yes" | "no";

function sameReactions(a: readonly MessageReaction[], b: readonly MessageReaction[]): boolean {
  return a.length === b.length && a.every((r, i) => r.messageId === b[i].messageId && r.userId === b[i].userId && r.emoji === b[i].emoji);
}

const RealRoundsContext = createContext<RealRoundsContextValue | null>(null);

export function RealRoundsProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser, profile } = useAuth();
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [messageRows, setMessageRows] = useState<RoundMessageRow[]>([]);
  // This device's not-yet-confirmed round messages (same idea as
  // RealSocialContext's pendingMessages for DMs, plus a kept failed state).
  // In memory only: a failed message survives navigation, not an app restart.
  const [pendingMessages, setPendingMessages] = useState<PendingRoundMessage[]>([]);
  const [myReviewedKeys, setMyReviewedKeys] = useState<Set<string>>(new Set());
  const [profilesById, setProfilesById] = useState<Map<string, GolferProfile>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState(INITIAL_LOAD_STATUS);
  const fetchingRef = useRef(false);
  // Same fix as RealSocialContext's refetch(): a realtime event arriving
  // while a refetch is already in flight used to just be dropped with
  // nothing to trigger a follow-up. This now runs one more refetch right
  // after the in-flight one finishes instead of losing the event.
  const pendingRefetchRef = useRef(false);
  // The signed-in user right now, and the latest refetch: a fetch started
  // under one account (e.g. before switching profiles) must not write its
  // results for the next one, and its follow-up must run as the new one.
  const userIdRef = useRef(authUser?.id);
  userIdRef.current = authUser?.id;
  const refetchRef = useRef<() => Promise<void>>(async () => {});

  // Quick reactions on round messages (public.round_message_reactions).
  // Loaded separately from the rounds refetch and never able to fail it:
  // "unknown" until the first fetch, "no" when the table doesn't exist yet
  // (migration not applied; tried again on resume), "yes" once a fetch
  // succeeded. Same write queue + server ordering as DMs, one per account
  // (reset on account switch, below).
  const [roundReactions, setRoundReactions] = useState<MessageReaction[]>([]);
  const reactionsRef = useRef<MessageReaction[]>([]);
  const [reactionsSupport, setReactionsSupport] = useState<Support>("unknown");
  const reactionsSupportRef = useRef<Support>("unknown");
  const reactionsFetchSeqRef = useRef(0);
  const [reactionWrites] = useState(createReactionWriteQueue);
  const [reactionSeqClock] = useState(createReactionSeqClock);
  const reactionOrderingRef = useRef<{ support: OrderingSupport }>({ support: "unknown" });
  const messageRowsRef = useRef<RoundMessageRow[]>([]);
  messageRowsRef.current = messageRows;
  const pendingMessagesRef = useRef<PendingRoundMessage[]>([]);
  pendingMessagesRef.current = pendingMessages;
  // The insert was refused for naming reply_to_message_id (migration not
  // applied, yet a row carried the key: shouldn't happen, but never loop).
  const [replyColumnMissing, setReplyColumnMissing] = useState(false);

  const applyReactions = useCallback((next: MessageReaction[]) => {
    if (sameReactions(reactionsRef.current, next)) return;
    reactionsRef.current = next;
    setRoundReactions(next);
  }, []);

  const fetchReactions = useCallback(async () => {
    const forUser = authUser?.id;
    if (!forUser) return;
    const seq = ++reactionsFetchSeqRef.current;
    const { data, error } = await supabase
      .from("round_message_reactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(ROUND_REACTION_WINDOW);
    if (userIdRef.current !== forUser || seq !== reactionsFetchSeqRef.current) return;
    if (error) {
      if (isMissingReactionsTableError(error)) {
        reactionsSupportRef.current = "no";
        setReactionsSupport("no");
      } else {
        // Keep what's shown; the next refetch tries again.
        console.error("GolfMe: failed to load round message reactions.", error);
      }
      return;
    }
    reactionsSupportRef.current = "yes";
    setReactionsSupport("yes");
    // Custom emoji ("+" in the hold menu): asked once per page load.
    void customReactionSupport.probe(() => supabase.rpc("is_reaction_emoji", { p_emoji: PROBE_EMOJI }));
    const rows = (data ?? []) as { message_id?: unknown; user_id?: unknown; emoji?: unknown; client_seq?: unknown }[];
    // My stored sequences (any device, tombstones too) keep my next write above them.
    for (const row of rows) {
      const s = row.user_id === forUser && typeof row.message_id === "string" ? reactionSeqFromRow(row) : null;
      if (s !== null) reactionSeqClock.observe(row.message_id as string, s);
    }
    // Tombstones (emoji NULL) are dropped here: no pill.
    applyReactions(overlayPendingReactions(reactionRowsToReactions(rows), reactionWrites.pending(), forUser));
  }, [authUser, applyReactions, reactionWrites, reactionSeqClock]);
  const fetchReactionsRef = useRef(fetchReactions);
  fetchReactionsRef.current = fetchReactions;

  const refetch = useCallback(async () => {
    if (fetchingRef.current) {
      pendingRefetchRef.current = true;
      return;
    }
    fetchingRef.current = true;
    const forUser = authUser?.id;
    const stale = () => userIdRef.current !== forUser;
    try {
      const [
        { data: roundRows, error: roundsError },
        { data: participantRows, error: participantsError },
        { data: myReviewRows, error: reviewsError },
        { data: messageRowsData, error: messagesError },
      ] = await Promise.all([
        supabase.from("golf_calls").select("*"),
        supabase.from("round_participants").select("*"),
        authUser ? supabase.from("round_reviews").select("round_id, reviewed_user_id").eq("reviewer_user_id", authUser.id) : Promise.resolve({ data: [], error: null }),
        // RLS (private.is_round_member) already scopes this to rounds the
        // caller hosts or has joined — no round_id filter needed here.
        supabase.from("round_messages").select("*").order("created_at", { ascending: true }),
      ]);
      if (roundsError) throw roundsError;
      if (participantsError) throw participantsError;
      if (reviewsError) throw reviewsError;
      if (messagesError) throw messagesError;
      if (stale()) return;

      const nextRounds = (roundRows ?? []) as RoundRow[];
      const nextParticipants = (participantRows ?? []) as ParticipantRow[];
      setRounds(nextRounds);
      setParticipants(nextParticipants);
      setMessageRows((messageRowsData ?? []) as RoundMessageRow[]);
      setMyReviewedKeys(new Set((myReviewRows ?? []).map((r: { round_id: string; reviewed_user_id: string }) => reviewKey(r.round_id, r.reviewed_user_id))));

      const ids = new Set<string>();
      for (const r of nextRounds) ids.add(r.host_user_id);
      for (const p of nextParticipants) ids.add(p.user_id);
      if (ids.size > 0) {
        // Hosts and rosters by id (golfer_public_profiles, lib/
        // publicProfilesFetch): includes gender/age range for roster
        // preference matching; no coordinates; blocked-either-way absent.
        const { profiles, error: profilesError } = await fetchPublicProfiles(Array.from(ids));
        if (profilesError) throw profilesError;
        if (stale()) return;
        const map = new Map<string, GolferProfile>();
        for (const g of profiles) map.set(g.id, g);
        setProfilesById(map);
      } else {
        setProfilesById(new Map());
      }
      setLoadStatus((prev) => applyLoadOutcome(prev, true));
      // Reactions ride along with every successful refetch (realtime on
      // round_messages, resume), on their own query.
      if (reactionsSupportRef.current !== "no") void fetchReactionsRef.current();
    } catch (err) {
      console.error("GolfMe: failed to load real rounds.", err);
      // State is left as it was: a failed refresh keeps the last good data.
      if (!stale()) setLoadStatus((prev) => applyLoadOutcome(prev, false));
    } finally {
      fetchingRef.current = false;
      if (pendingRefetchRef.current) {
        pendingRefetchRef.current = false;
        void refetchRef.current();
      }
    }
  }, [authUser]);
  refetchRef.current = refetch;

  // A new account (or demo / signed out): nothing of the previous one's
  // reactions, queued writes or sequences carries over. Keyed on the id, not
  // the authUser object (a token refresh must not drop pending writes).
  // Declared before the load effect below, so it runs first.
  const accountKey = isDemo ? "demo" : (authUser?.id ?? "");
  useEffect(() => {
    reactionWrites.reset();
    reactionSeqClock.reset();
    reactionOrderingRef.current = { support: "unknown" };
    reactionsSupportRef.current = "unknown";
    setReactionsSupport("unknown");
    reactionsRef.current = [];
    setRoundReactions([]);
    setReplyColumnMissing(false);
  }, [accountKey, reactionWrites, reactionSeqClock]);

  useEffect(() => {
    if (isDemo || !authUser) {
      setRounds([]);
      setParticipants([]);
      setMessageRows([]);
      setPendingMessages([]);
      setProfilesById(new Map());
      setLoadStatus(INITIAL_LOAD_STATUS);
      return;
    }

    setIsLoading(true);
    setLoadStatus(INITIAL_LOAD_STATUS);
    refetch().finally(() => setIsLoading(false));

    // Global subscription (not per-round) — simplest correct way to satisfy
    // "membership changes appear across devices without restarting," and
    // this app's data volume doesn't need per-route subscription lifecycle
    // management. A full refetch on any change is a deliberate simplicity
    // choice over patching individual rows in place.
    const channel = supabase
      .channel("golf-calls-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "golf_calls" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "round_participants" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "round_messages" }, () => refetch())
      .subscribe();
    const stopResume = refetchOnResume(() => {
      // The reactions migration may have been applied since: look again.
      if (reactionsSupportRef.current === "no") reactionsSupportRef.current = "unknown";
      void refetch();
    });

    return () => {
      supabase.removeChannel(channel);
      stopResume();
    };
  }, [isDemo, authUser, refetch]);

  // Reactions realtime, on its own channel and only once the table is known
  // to exist (subscribing to a table that isn't published would just fail).
  // Any event: reload the reactions (one query; RLS scopes it).
  const reactionsLive = !isDemo && Boolean(authUser) && reactionsSupport === "yes";
  useEffect(() => {
    if (!reactionsLive) return;
    const channel = supabase
      .channel("round-reactions")
      .on("postgres_changes", { event: "*", schema: "public", table: "round_message_reactions" }, () => {
        void fetchReactionsRef.current();
      })
      .subscribe((status) => {
        // (Re)subscribed: catch up on anything missed while disconnected.
        if (status === "SUBSCRIBED") void fetchReactionsRef.current();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reactionsLive]);

  const retry = useCallback(async () => {
    setIsLoading(true);
    try {
      await refetch();
    } finally {
      setIsLoading(false);
    }
  }, [refetch]);

  const golfCalls = useMemo(
    () => rounds.map((r) => realRoundToGolfCall(r, participants, profile?.playingAreaCoords)),
    [rounds, participants, profile?.playingAreaCoords],
  );

  const hostRound = useCallback(
    async (input: HostRealRoundInput): Promise<GolfCall> => {
      const { data, error } = await supabase.rpc("host_golf_call", {
        p_course_id: input.courseId,
        p_course_name: input.courseName,
        p_course_area_label: input.courseAreaLabel,
        p_course_lat: input.courseLat,
        p_course_lng: input.courseLng,
        p_date_iso: input.dateISO,
        p_tee_time_label: input.timeLabel,
        p_holes: input.holes,
        p_game_format: input.gameFormat,
        p_estimated_price_per_person: input.estimatedPricePerPerson,
        p_total_spots: input.totalSpots,
        p_skill_level: input.skillLevel,
        p_vibe: input.vibe,
        p_walk_or_cart: input.walkOrCart,
        p_notes: input.notes ?? null,
      });
      if (error) throw new Error(error.message);
      await refetch();
      const row = data as RoundRow;
      return realRoundToGolfCall(
        row,
        [{ id: "", round_id: row.id, user_id: row.host_user_id, participant_status: "joined", joined_at: new Date().toISOString() }],
        profile?.playingAreaCoords,
      );
    },
    [refetch, profile?.playingAreaCoords],
  );

  const joinRound = useCallback(
    async (roundId: string) => {
      const { error } = await supabase.rpc("join_golf_call", { p_round_id: roundId });
      if (error) throw new Error(error.message);
      await refetch();
    },
    [refetch],
  );

  const leaveRound = useCallback(
    async (roundId: string) => {
      const { error } = await supabase.rpc("leave_golf_call", { p_round_id: roundId });
      if (error) throw new Error(error.message);
      await refetch();
    },
    [refetch],
  );

  const cancelRound = useCallback(
    async (roundId: string) => {
      if (!authUser) throw new Error("Not signed in.");
      const { error } = await supabase.from("golf_calls").update({ status: "cancelled" }).eq("id", roundId).eq("host_user_id", authUser.id);
      if (error) throw new Error(error.message);
      await refetch();
    },
    [refetch, authUser],
  );

  const completeRound = useCallback(
    async (roundId: string) => {
      if (!authUser) throw new Error("Not signed in.");
      const { error } = await supabase.from("golf_calls").update({ status: "completed" }).eq("id", roundId).eq("host_user_id", authUser.id);
      if (error) throw new Error(error.message);
      await refetch();
    },
    [refetch, authUser],
  );

  // The first host-initiated edit of an already-created round (previously
  // only cancel/complete existed post-creation, both single-column status
  // flips) — scoped to just course/date/time, matching the RPC's own
  // narrow scope. If proof was attached and any of those actually changed,
  // the RPC deletes the now-stale booking_proofs row itself and reports it
  // back here so the freed Storage object can be cleaned up too.
  const editTeeTime = useCallback(
    async (roundId: string, input: EditTeeTimeInput): Promise<{ proofInvalidated: boolean }> => {
      const { data, error } = await supabase.rpc("edit_golf_call_tee_time", {
        p_golf_call_id: roundId,
        p_course_id: input.courseId,
        p_course_name: input.courseName,
        p_course_area_label: input.courseAreaLabel,
        p_course_lat: input.courseLat,
        p_course_lng: input.courseLng,
        p_date_iso: input.dateISO,
        p_tee_time_label: input.timeLabel,
      });
      if (error) throw new Error(error.message);
      await refetch();
      const row = (data as { proof_invalidated: boolean; invalidated_storage_path: string | null }[] | null)?.[0];
      if (row?.invalidated_storage_path) {
        await supabase.storage.from("booking-proofs").remove([row.invalidated_storage_path]);
      }
      return { proofInvalidated: Boolean(row?.proof_invalidated) };
    },
    [refetch],
  );

  // Note: refetch() above still loads every round_messages row the caller
  // can see (RLS scopes it to their rounds) on every realtime change. Fine
  // at today's volume; per-round paging is the next step if it grows.
  const messagesForCall = useCallback(
    (roundId: string) => mergeRoundMessages(messageRows, pendingMessages, roundId),
    [messageRows, pendingMessages],
  );

  // A sent message is kept until a refetch brings in its row (by id), so a
  // refetch that started before the insert can't make it blink out.
  // Also re-run when a message is marked sent: its row may already have
  // arrived. reconcile returns the same array when nothing changes, so this
  // settles immediately.
  useEffect(() => {
    setPendingMessages((prev) => reconcilePendingRoundMessages(prev, messageRows));
  }, [messageRows, pendingMessages]);

  // Optimistic, like sendDirectMessage: the bubble shows at once as
  // "sending". On success it's marked sent with the real id; the realtime
  // refetch then replaces it with the row. On failure it stays on screen as
  // "Not sent" with retry/discard, so the text is never silently lost. A
  // content-filter rejection stays too, as "Not sent: <reason>" with Edit /
  // Discard only (retrying unchanged text would fail again; GroupChat's
  // Edit puts it back into an empty composer, or asks first).
  // Replies are sent only once the column is known to exist (a fetched row
  // carries it): an older database would refuse the unknown column.
  const repliesSupported = useMemo(
    () => !replyColumnMissing && roundRowsHaveColumn(messageRows, "reply_to_message_id"),
    [replyColumnMissing, messageRows],
  );
  const repliesSupportedRef = useRef(repliesSupported);
  repliesSupportedRef.current = repliesSupported;

  const attemptSend = useCallback(
    async (clientId: string, roundId: string, text: string, replyToId?: string | null): Promise<SendMessageResult> => {
      if (!authUser) {
        setPendingMessages((prev) => markRoundMessageFailed(prev, clientId, "network"));
        return "failed";
      }
      const row = { round_id: roundId, sender_id: authUser.id, text };
      const insert = (body: typeof row & { reply_to_message_id?: string }) =>
        supabase.from("round_messages").insert(body).select("id, created_at").single();
      const replyTo = replyToId && repliesSupportedRef.current ? replyToId : null;
      let { data, error } = await insert(replyTo ? { ...row, reply_to_message_id: replyTo } : row);
      // The quote can't be stored (column missing, or the database says the
      // quoted message isn't in this round): send the text without it
      // rather than failing the message.
      if (error && replyTo && shouldResendWithoutReply(error)) {
        if (error.code === "PGRST204" || error.code === "42703") setReplyColumnMissing(true);
        setPendingMessages((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, replyToId: null } : p)));
        ({ data, error } = await insert(row));
      }
      // lib/roundChat.ts settleRoundSend: sent / failed (network, rejected)
      // / objectionable, applied to this clientId only. A content-filter
      // rejection is kept as a failed bubble ("Not sent: ...", Edit /
      // Discard), never resent and never written into a composer from
      // here: a late answer can't touch newer input or another round.
      const settled = settleRoundSend(clientId, { data: data as { id: string; created_at: string } | null, error });
      setPendingMessages(settled.apply);
      if (settled.failure === "network" || settled.failure === "rejected") console.error("GolfMe: failed to send round message.", error);
      // Refused by RLS: most likely the round just ended/was cancelled, the
      // golfer left, or a block. Reload so the chat shows the right read-only
      // or locked state instead of an open composer.
      if (settled.failure === "rejected") void refetch();
      return settled.result;
    },
    [authUser, refetch],
  );

  const sendRoundMessage = useCallback(
    async (roundId: string, text: string, replyToId?: string | null): Promise<SendMessageResult> => {
      const trimmed = text.trim();
      if (!trimmed) return "failed";
      const clientId = `temp-${crypto.randomUUID()}`;
      const replyTo = replyToId && repliesSupportedRef.current ? replyToId : null;
      setPendingMessages((prev) => [
        ...prev,
        createPendingRoundMessage({ clientId, roundId, senderId: authUser?.id ?? "", text: trimmed, replyToId: replyTo }),
      ]);
      return attemptSend(clientId, roundId, trimmed, replyTo);
    },
    [authUser, attemptSend],
  );

  // ---- Photos (lib/chatImages.ts, migration 20261107170000) ----
  // Probe once per account (and on resume until known), so the photo button
  // shows even in a round with no messages yet; a fetched row carrying
  // image_path proves it too.
  const [imageProbe, setImageProbe] = useState<ImageSupport>("unknown");
  const imageProbeRef = useRef<ImageSupport>("unknown");
  const [imageColumnMissing, setImageColumnMissing] = useState(false);
  const probeImages = useCallback(async () => {
    const forUser = authUser?.id;
    if (!forUser || imageProbeRef.current === "yes") return;
    const { error } = await supabase.from("round_messages").select("image_path").limit(1);
    if (userIdRef.current !== forUser) return;
    const next: ImageSupport = !error ? "yes" : isMissingImageSupportError(error) ? "no" : "unknown";
    imageProbeRef.current = next;
    setImageProbe(next);
    if (next === "yes") setImageColumnMissing(false);
  }, [authUser]);
  useEffect(() => {
    imageProbeRef.current = "unknown";
    setImageProbe("unknown");
    setImageColumnMissing(false);
    if (isDemo || !authUser) return;
    void probeImages();
    return refetchOnResume(() => void probeImages());
    // Per account (the id), not per authUser object (token refreshes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);
  const imagesSupported = !imageColumnMissing && (imageProbe === "yes" || rowsHaveImageColumn(messageRows));

  // Voice messages (lib/chatVoice.ts, migration 20261107180000): own probe.
  const [voiceProbe, setVoiceProbe] = useState<ImageSupport>("unknown");
  const voiceProbeRef = useRef<ImageSupport>("unknown");
  const [voiceColumnMissing, setVoiceColumnMissing] = useState(false);
  const probeVoice = useCallback(async () => {
    const forUser = authUser?.id;
    if (!forUser || voiceProbeRef.current === "yes") return;
    const { error } = await supabase.from("round_messages").select("audio_path").limit(1);
    if (userIdRef.current !== forUser) return;
    const next: ImageSupport = !error ? "yes" : isMissingVoiceSupportError(error) ? "no" : "unknown";
    voiceProbeRef.current = next;
    setVoiceProbe(next);
    if (next === "yes") setVoiceColumnMissing(false);
  }, [authUser]);
  useEffect(() => {
    voiceProbeRef.current = "unknown";
    setVoiceProbe("unknown");
    setVoiceColumnMissing(false);
    if (isDemo || !authUser) return;
    void probeVoice();
    return refetchOnResume(() => void probeVoice());
    // Per account (the id), not per authUser object (token refreshes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);
  const voiceSupported = !voiceColumnMissing && (voiceProbe === "yes" || rowsHaveVoiceColumn(messageRows));

  // The bytes and progress of each photo send, by clientId (display state
  // is in pendingMessages[].photo). A retry resumes where the last attempt
  // stopped: an uploaded photo isn't uploaded again.
  const photoJobsRef = useRef(
    new Map<
      string,
      {
        roundId: string;
        messageId: string;
        blob: Blob;
        localUrl: string;
        width: number;
        height: number;
        thumb: string | null;
        text: string;
        replyTo: string | null;
        uploaded: boolean;
        user: string;
        // A voice message instead of a photo (same machinery).
        audio?: { durationMs: number; mime: string };
      }
    >(),
  );
  const photoInFlightRef = useRef(new Map<string, Promise<SendMessageResult>>());

  const attemptPhoto = useCallback(
    (clientId: string): Promise<SendMessageResult> => {
      const running = photoInFlightRef.current.get(clientId);
      if (running) return running;
      const run = async (): Promise<SendMessageResult> => {
        const job = photoJobsRef.current.get(clientId);
        if (!job || !authUser || job.user !== authUser.id) return "failed";
        const current = () => userIdRef.current === job.user;
        const fail = (failure: ImageSendFailure): SendMessageResult => {
          if (current()) {
            setPendingMessages((prev) =>
              patchRoundPhoto(markRoundMessageFailed(prev, clientId, failure === "rejected" ? "rejected" : "network"), clientId, { failure }),
            );
            // Refused: most likely the round ended, the golfer left, or a block.
            if (failure === "rejected") void refetch();
          }
          return failure === "objectionable" ? "objectionable" : "failed";
        };
        const path = roundJobPath(job);
        if (!job.uploaded) {
          let shown = -1;
          const uploaded = await uploadChatImage(
            path,
            job.blob,
            (fraction) => {
              const step = progressStep(fraction);
              if (step !== shown && current()) {
                shown = step;
                setPendingMessages((prev) => patchRoundPhoto(prev, clientId, { progress: step }));
              }
            },
            undefined,
            job.audio ? voiceFileType(job.audio.mime).contentType : "image/jpeg",
          );
          if (uploaded !== "uploaded") return fail(uploaded);
          job.uploaded = true;
          if (current()) setPendingMessages((prev) => patchRoundPhoto(prev, clientId, { path, progress: 1 }));
        }
        const media = job.audio
          ? voiceRowColumns({ path, durationMs: job.audio.durationMs })
          : imageRowColumns({ path, width: job.width, height: job.height, thumb: job.thumb });
        const row = { id: job.messageId, round_id: job.roundId, sender_id: job.user, text: job.text, ...media };
        const insert = (body: Record<string, unknown>) => supabase.from("round_messages").insert(body).select("id, created_at").single();
        let { data, error } = await insert(job.replyTo ? { ...row, reply_to_message_id: job.replyTo } : row);
        if (error && job.replyTo && shouldResendWithoutReply(error)) {
          if (error.code === "PGRST204" || error.code === "42703") setReplyColumnMissing(true);
          job.replyTo = null;
          setPendingMessages((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, replyToId: null } : p)));
          ({ data, error } = await insert(row));
        }
        if (error) {
          if (job.audio ? isMissingVoiceSupportError(error) : isMissingImageSupportError(error)) {
            if (job.audio) setVoiceColumnMissing(true);
            else setImageColumnMissing(true);
            return fail("rejected");
          }
          const outcome = classifyImageInsertError(error);
          if (outcome !== "sent") {
            console.error("GolfMe: failed to send round photo.", error);
            return fail(outcome);
          }
          // 23505: an earlier attempt's insert landed.
          data = { id: job.messageId, created_at: new Date().toISOString() };
        }
        if (!current()) return "sent";
        chatImageUrls().setLocal(path, job.localUrl);
        photoJobsRef.current.delete(clientId);
        setPendingMessages((prev) => patchRoundPhoto(markRoundMessageSent(prev, clientId, data as { id: string; created_at: string } | null), clientId, { path, progress: 1, failure: undefined }));
        return "sent";
      };
      const promise = run().finally(() => photoInFlightRef.current.delete(clientId));
      photoInFlightRef.current.set(clientId, promise);
      return promise;
    },
    [authUser, refetch],
  );

  const sendRoundImage = useCallback(
    async (roundId: string, photo: ProcessedChatImage, text: string, replyToId?: string | null): Promise<SendMessageResult> => {
      if (!authUser) return "failed";
      const messageId = crypto.randomUUID();
      const clientId = `temp-${messageId}`;
      const trimmed = text.trim();
      const replyTo = replyToId && repliesSupportedRef.current ? replyToId : null;
      photoJobsRef.current.set(clientId, {
        roundId,
        messageId,
        blob: photo.blob,
        localUrl: photo.previewUrl,
        width: photo.width,
        height: photo.height,
        thumb: photo.thumb,
        text: trimmed,
        replyTo,
        uploaded: false,
        user: authUser.id,
      });
      setPendingMessages((prev) => [
        ...prev,
        createPendingRoundMessage({
          clientId,
          roundId,
          senderId: authUser.id,
          text: trimmed,
          replyToId: replyTo,
          photo: { messageId, localUrl: photo.previewUrl, width: photo.width, height: photo.height, thumb: photo.thumb, progress: 0 },
        }),
      ]);
      return attemptPhoto(clientId);
    },
    [authUser, attemptPhoto],
  );

  // Voice: the photo path with an audio file (Not sent · Retry / Discard
  // through retryRoundMessage / discardRoundMessage like any message).
  const sendRoundVoice = useCallback(
    async (roundId: string, clip: VoiceClip, replyToId?: string | null): Promise<SendMessageResult> => {
      if (!authUser) return "failed";
      const messageId = crypto.randomUUID();
      const clientId = `temp-${messageId}`;
      const replyTo = replyToId && repliesSupportedRef.current ? replyToId : null;
      const audio = { durationMs: clip.durationMs, mime: clip.mime };
      photoJobsRef.current.set(clientId, {
        roundId,
        messageId,
        blob: clip.blob,
        localUrl: clip.localUrl,
        width: 0,
        height: 0,
        thumb: null,
        text: "",
        replyTo,
        uploaded: false,
        user: authUser.id,
        audio,
      });
      setPendingMessages((prev) => [
        ...prev,
        createPendingRoundMessage({
          clientId,
          roundId,
          senderId: authUser.id,
          text: "",
          replyToId: replyTo,
          photo: { messageId, localUrl: clip.localUrl, width: 0, height: 0, thumb: null, progress: 0, audio },
        }),
      ]);
      return attemptPhoto(clientId);
    },
    [authUser, attemptPhoto],
  );

  const retryRoundMessage = useCallback(
    async (message: { clientId: string; roundId: string; text: string; replyToId?: string | null }): Promise<SendMessageResult> => {
      // Photo / voice sends resume through their own job (attemptPhoto dedupes
      // an in-flight attempt).
      if (photoJobsRef.current.has(message.clientId)) {
        if (!photoInFlightRef.current.has(message.clientId)) {
          setPendingMessages((prev) => patchRoundPhoto(markRoundMessageRetrying(prev, message.clientId), message.clientId, { failure: undefined }));
        }
        return attemptPhoto(message.clientId);
      }
      // Only a retryable failure goes out again (never a content-filter
      // rejection, never one already sending: no double send on a double tap).
      const pending = pendingMessagesRef.current.find((p) => p.clientId === message.clientId);
      if (!pending || !canRetryRoundMessage(pending)) return pending?.failure === "objectionable" ? "objectionable" : "failed";
      pendingMessagesRef.current = markRoundMessageRetrying(pendingMessagesRef.current, message.clientId);
      setPendingMessages((prev) => markRoundMessageRetrying(prev, message.clientId));
      return attemptSend(message.clientId, pending.roundId, pending.text, pending.replyToId);
    },
    [attemptSend, attemptPhoto],
  );

  // Unsend (public.unsend_round_message): offered only once fetched rows
  // carry unsent_at. The server enforces sender + still in the round + 5
  // minutes, wipes the text and drops the message's reactions in the same
  // transaction; the realtime UPDATE then refetches on every member's device.
  const unsendSupported = useMemo(() => roundRowsHaveColumn(messageRows, "unsent_at"), [messageRows]);
  const unsendRoundMessage = useCallback(
    async (messageId: string): Promise<UnsendResult> => {
      if (!authUser) return "failed";
      // The photo's path, read before the database clears it.
      const imagePath =
        messageRowsRef.current.find((m) => m.id === messageId)?.image_path ??
        messageRowsRef.current.find((m) => m.id === messageId)?.audio_path ??
        pendingMessagesRef.current.find((p) => p.serverId === messageId)?.photo?.path ??
        null;
      const { error } = await supabase.rpc("unsend_round_message", { p_message_id: messageId });
      if (error) {
        const result = classifyUnsendError(error);
        if (result === "failed") console.error("GolfMe: failed to unsend round message.", error);
        return result;
      }
      // Don't wait for the realtime echo to update this device.
      const unsentAt = new Date().toISOString();
      setMessageRows((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                text: "",
                unsent_at: m.unsent_at ?? unsentAt,
                ...(m.image_path !== undefined ? { image_path: null, image_width: null, image_height: null, image_thumb: null } : {}),
                ...(m.audio_path !== undefined ? { audio_path: null, audio_duration_ms: null } : {}),
              }
            : m,
        ),
      );
      applyReactions(reactionsRef.current.filter((r) => r.messageId !== messageId));
      // Nothing points at the photo any more (unsend_round_message cleared
      // it): remove the file itself, best effort (lib/chatImageClient).
      if (imagePath) void removeChatImage(imagePath);
      // Still only a "sent" pending bubble here (its row not fetched yet):
      // the refetch brings the wiped row and reconciles it away.
      void refetch();
      return "unsent";
    },
    [authUser, applyReactions, refetch],
  );

  // Optimistic, queued and ordered exactly like DM reactions
  // (RealSocialContext.setMessageReaction): one write in flight per message,
  // the latest tap queued, each write sequenced (a removal is a tombstone,
  // falling back once to DELETE when the tombstone is refused, e.g. on a
  // round that has ended). false = this tap was my latest intent and its
  // write failed; the pill then settles on what the server confirmed.
  const setRoundReaction = useCallback(
    async (messageId: string, emoji: QuickReaction | null): Promise<boolean> => {
      const selfId = authUser?.id;
      if (!selfId || reactionsSupportRef.current !== "yes") return false;
      // A stored row, or my just-sent message whose row hasn't been fetched yet.
      const message = messageRowsRef.current.find((m) => m.id === messageId);
      if (message ? message.unsent_at : !pendingMessagesRef.current.some((p) => p.serverId === messageId)) return false;
      const forUser = selfId;
      const ordering = reactionOrderingRef.current;
      const transport: ReactionTransport = {
        upsert: async (row, signal) =>
          (await supabase.from("round_message_reactions").upsert(row, { onConflict: "message_id,user_id" }).abortSignal(signal)).error,
        remove: async (id, signal) =>
          (await supabase.from("round_message_reactions").delete().eq("message_id", id).eq("user_id", selfId).abortSignal(signal)).error,
      };
      const done = reactionWrites.set(messageId, emoji, {
        saved: myReaction(reactionsRef.current, messageId, selfId),
        write: async (id, next, signal) => {
          const error = await sendReactionWrite({ transport, clock: reactionSeqClock, ordering, userId: selfId, now: Date.now }, id, next, signal);
          if (error && !signal.aborted) {
            console.error("GolfMe: failed to update round message reaction.", error);
            if (userIdRef.current === forUser && isMissingReactionsTableError(error)) {
              reactionsSupportRef.current = "no";
              setReactionsSupport("no");
            }
          }
          return error;
        },
        onSettled: (id, saved) => {
          if (userIdRef.current !== forUser) return;
          applyReactions(withReaction(reactionsRef.current, id, selfId, saved));
          void fetchReactionsRef.current();
        },
        onLateSuccess: () => {
          if (userIdRef.current !== forUser) return;
          void fetchReactionsRef.current();
        },
      });
      applyReactions(withReaction(reactionsRef.current, messageId, selfId, emoji));
      return done;
    },
    [authUser, applyReactions, reactionWrites, reactionSeqClock],
  );

  const discardRoundMessage = useCallback((clientId: string) => {
    const job = photoJobsRef.current.get(clientId);
    photoJobsRef.current.delete(clientId);
    setPendingMessages((prev) => discardPending(prev, clientId));
    if (!job) return;
    // Uploaded but never stored: remove the orphan (refused by the bucket's
    // delete policy if a row does point at it after all).
    if (job.uploaded) void removeChatImage(roundJobPath(job));
    URL.revokeObjectURL(job.localUrl);
  }, []);

  const hasLeftRound = useCallback(
    (roundId: string) =>
      Boolean(authUser) && participants.some((p) => p.round_id === roundId && p.user_id === authUser!.id && p.participant_status === "left"),
    [participants, authUser],
  );

  const hasReviewed = useCallback((roundId: string, revieweeId: string) => myReviewedKeys.has(reviewKey(roundId, revieweeId)), [myReviewedKeys]);

  const submitReview = useCallback(
    async (roundId: string, revieweeId: string, input: ReviewInput) => {
      const { error } = await supabase.rpc("submit_round_review", {
        p_round_id: roundId,
        p_reviewed_user_id: revieweeId,
        p_would_play_again: input.wouldPlayAgain,
        p_showed_up: input.showedUp,
        // Only ever a real value when actually asked (showedUp === true) —
        // undefined otherwise, sent through as NULL, never a fabricated
        // answer for a no-show. pace is retired from the active flow
        // entirely, always NULL for new reviews; the column and its
        // history stay intact.
        p_on_time: input.onTime ?? null,
        p_pace: null,
        p_respectful: input.respectful,
        p_handicap_accuracy: input.handicapAccuracy,
        p_private_note: input.privateNote ?? null,
      });
      if (error) throw new Error(error.message);
      await refetch();
    },
    [refetch],
  );

  const value: RealRoundsContextValue = {
    golfCalls,
    profilesById,
    isLoading,
    hasLoaded: isDemo || loadStatus.settled,
    loadError: !isDemo && isFirstLoadError(loadStatus),
    refreshFailed: !isDemo && isRefreshError(loadStatus),
    retry,
    hostRound,
    joinRound,
    leaveRound,
    cancelRound,
    completeRound,
    editTeeTime,
    hasReviewed,
    submitReview,
    messagesForCall,
    sendRoundMessage,
    retryRoundMessage,
    discardRoundMessage,
    imagesSupported,
    sendRoundImage,
    voiceSupported,
    sendRoundVoice,
    repliesSupported,
    unsendSupported,
    unsendRoundMessage,
    reactionsSupported: reactionsSupport === "yes",
    roundReactions,
    setRoundReaction,
    hasLeftRound,
  };
  return <RealRoundsContext.Provider value={value}>{children}</RealRoundsContext.Provider>;
}

export function useRealRounds(): RealRoundsContextValue {
  const ctx = useContext(RealRoundsContext);
  if (!ctx) throw new Error("useRealRounds must be used within a RealRoundsProvider");
  return ctx;
}
