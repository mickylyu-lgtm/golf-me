import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { realRoundToGolfCall } from "../lib/golfCall";
import type { RoundRow, ParticipantRow } from "../lib/golfCall";
import { profileRowToGolferProfile } from "../lib/profile";
import type { ProfileRow } from "../lib/profile";
import type { ChatMessage, GolfCall, GolferProfile } from "../types";
import type { ReviewInput } from "./DataContext";

interface RoundMessageRow {
  id: string;
  round_id: string;
  sender_id: string;
  text: string;
  created_at: string;
}

function roundMessageRowToChatMessage(row: RoundMessageRow): ChatMessage {
  return { id: row.id, golfCallId: row.round_id, senderId: row.sender_id, text: row.text, createdAt: row.created_at };
}

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
  hostRound: (input: HostRealRoundInput) => Promise<GolfCall>;
  joinRound: (roundId: string) => Promise<void>;
  leaveRound: (roundId: string) => Promise<void>;
  cancelRound: (roundId: string) => Promise<void>;
  completeRound: (roundId: string) => Promise<void>;
  editTeeTime: (roundId: string, input: EditTeeTimeInput) => Promise<{ proofInvalidated: boolean }>;
  hasReviewed: (roundId: string, revieweeId: string) => boolean;
  submitReview: (roundId: string, revieweeId: string, input: ReviewInput) => Promise<void>;
  messagesForCall: (roundId: string) => ChatMessage[];
  sendRoundMessage: (roundId: string, text: string) => Promise<void>;
}

function reviewKey(roundId: string, revieweeId: string): string {
  return `${roundId}:${revieweeId}`;
}

const RealRoundsContext = createContext<RealRoundsContextValue | null>(null);

export function RealRoundsProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser, profile } = useAuth();
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [messageRows, setMessageRows] = useState<RoundMessageRow[]>([]);
  const [myReviewedKeys, setMyReviewedKeys] = useState<Set<string>>(new Set());
  const [profilesById, setProfilesById] = useState<Map<string, GolferProfile>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const fetchingRef = useRef(false);
  // Same fix as RealSocialContext's refetch(): a realtime event arriving
  // while a refetch is already in flight used to just be dropped with
  // nothing to trigger a follow-up. This now runs one more refetch right
  // after the in-flight one finishes instead of losing the event.
  const pendingRefetchRef = useRef(false);

  const refetch = useCallback(async () => {
    if (fetchingRef.current) {
      pendingRefetchRef.current = true;
      return;
    }
    fetchingRef.current = true;
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
        const { data: profileRows, error: profilesError } = await supabase.from("profiles").select("*").in("id", Array.from(ids));
        if (profilesError) throw profilesError;
        const map = new Map<string, GolferProfile>();
        for (const row of (profileRows ?? []) as ProfileRow[]) map.set(row.id, profileRowToGolferProfile(row));
        setProfilesById(map);
      } else {
        setProfilesById(new Map());
      }
    } catch (err) {
      console.error("Golf Me: failed to load real rounds.", err);
    } finally {
      fetchingRef.current = false;
      if (pendingRefetchRef.current) {
        pendingRefetchRef.current = false;
        refetch();
      }
    }
  }, [authUser]);

  useEffect(() => {
    if (isDemo || !authUser) {
      setRounds([]);
      setParticipants([]);
      setMessageRows([]);
      setProfilesById(new Map());
      return;
    }

    setIsLoading(true);
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isDemo, authUser, refetch]);

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

  const messagesForCall = useCallback(
    (roundId: string) => messageRows.filter((m) => m.round_id === roundId).map(roundMessageRowToChatMessage),
    [messageRows],
  );

  // No optimistic local echo here (unlike sendDirectMessage) — this file's
  // other mutations (hostRound, joinRound, ...) all follow the same plain
  // insert-then-let-realtime-catch-it convention rather than DMs' separate
  // pending-message system, and a group chat message doesn't need the same
  // instant-feedback treatment a 1:1 DM composer does.
  const sendRoundMessage = useCallback(
    async (roundId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !authUser) return;
      const { error } = await supabase.from("round_messages").insert({ round_id: roundId, sender_id: authUser.id, text: trimmed });
      if (error) throw new Error(error.message);
    },
    [authUser],
  );

  const hasReviewed = useCallback((roundId: string, revieweeId: string) => myReviewedKeys.has(reviewKey(roundId, revieweeId)), [myReviewedKeys]);

  const submitReview = useCallback(
    async (roundId: string, revieweeId: string, input: ReviewInput) => {
      const { error } = await supabase.rpc("submit_round_review", {
        p_round_id: roundId,
        p_reviewed_user_id: revieweeId,
        p_would_play_again: input.wouldPlayAgain,
        p_showed_up: input.showedUp,
        p_on_time: input.onTime,
        p_pace: input.paceOfPlay,
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
  };
  return <RealRoundsContext.Provider value={value}>{children}</RealRoundsContext.Provider>;
}

export function useRealRounds(): RealRoundsContextValue {
  const ctx = useContext(RealRoundsContext);
  if (!ctx) throw new Error("useRealRounds must be used within a RealRoundsProvider");
  return ctx;
}
