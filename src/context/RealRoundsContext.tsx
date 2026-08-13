import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { realRoundToGolfCall } from "../lib/golfCall";
import type { RoundRow, ParticipantRow } from "../lib/golfCall";
import { profileRowToGolferProfile } from "../lib/profile";
import type { ProfileRow } from "../lib/profile";
import type { GolfCall, GolferProfile } from "../types";

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

interface RealRoundsContextValue {
  golfCalls: GolfCall[];
  profilesById: Map<string, GolferProfile>;
  isLoading: boolean;
  hostRound: (input: HostRealRoundInput) => Promise<GolfCall>;
  joinRound: (roundId: string) => Promise<void>;
  leaveRound: (roundId: string) => Promise<void>;
  cancelRound: (roundId: string) => Promise<void>;
}

const RealRoundsContext = createContext<RealRoundsContextValue | null>(null);

export function RealRoundsProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser, profile } = useAuth();
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, GolferProfile>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const fetchingRef = useRef(false);

  const refetch = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const [{ data: roundRows, error: roundsError }, { data: participantRows, error: participantsError }] = await Promise.all([
        supabase.from("golf_calls").select("*"),
        supabase.from("round_participants").select("*"),
      ]);
      if (roundsError) throw roundsError;
      if (participantsError) throw participantsError;

      const nextRounds = (roundRows ?? []) as RoundRow[];
      const nextParticipants = (participantRows ?? []) as ParticipantRow[];
      setRounds(nextRounds);
      setParticipants(nextParticipants);

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
    }
  }, []);

  useEffect(() => {
    if (isDemo || !authUser) {
      setRounds([]);
      setParticipants([]);
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

  const value: RealRoundsContextValue = { golfCalls, profilesById, isLoading, hostRound, joinRound, leaveRound, cancelRound };
  return <RealRoundsContext.Provider value={value}>{children}</RealRoundsContext.Provider>;
}

export function useRealRounds(): RealRoundsContextValue {
  const ctx = useContext(RealRoundsContext);
  if (!ctx) throw new Error("useRealRounds must be used within a RealRoundsProvider");
  return ctx;
}
