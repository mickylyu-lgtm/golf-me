import type { GolfCall } from "../types";
import { haversineMiles } from "./geo";
import type { GeoPoint } from "./geo";

export interface RoundRow {
  id: string;
  host_user_id: string;
  course_id: string | null;
  course_name: string;
  course_area_label: string;
  course_lat: number | null;
  course_lng: number | null;
  date_iso: string;
  tee_time_label: string;
  holes: number;
  game_format: string;
  estimated_price_per_person: number | null;
  total_spots: number;
  skill_level: string;
  vibe: string;
  walk_or_cart: string;
  status: string;
  notes: string | null;
  created_at: string;
  tee_time_source: string;
  booking_source: string | null;
  verification_created_at: string | null;
}

export interface ParticipantRow {
  id: string;
  round_id: string;
  user_id: string;
  participant_status: "joined" | "left";
  joined_at: string;
}

// Maps a real round + its participants onto the existing (mock-shaped)
// GolfCall type — same trick as lib/profile.ts's row->GolferProfile mapper:
// every existing consumer (GolfCallCard, GolfCallDetail, compatibility
// scoring, roundFilters) keeps working unchanged for real rounds.
export function realRoundToGolfCall(round: RoundRow, participants: ParticipantRow[], viewerLocation?: GeoPoint): GolfCall {
  // Host first, mirroring the mock's "joinedGolferIds includes host at
  // index 0" — several consumers (GolfCallCard's host tag, etc.) rely on
  // host membership being reflected here, not read separately.
  const joinedGolferIds = participants
    .filter((p) => p.round_id === round.id && p.participant_status === "joined")
    .map((p) => p.user_id)
    .sort((a) => (a === round.host_user_id ? -1 : 0));

  const distanceMiles =
    viewerLocation && round.course_lat != null && round.course_lng != null
      ? haversineMiles(viewerLocation, { lat: round.course_lat, lng: round.course_lng })
      : 0;

  return {
    id: round.id,
    hostId: round.host_user_id,
    course: round.course_name,
    courseId: round.course_id ?? undefined,
    areaLabel: round.course_area_label,
    distanceMiles,
    dateISO: round.date_iso,
    timeLabel: round.tee_time_label,
    estimatedPricePerPerson: round.estimated_price_per_person ?? 0,
    totalSpots: round.total_spots,
    joinedGolferIds,
    pendingRequestIds: [], // request-to-join is deferred for real rounds this phase
    joinMode: "instant",
    skillLevel: round.skill_level as GolfCall["skillLevel"],
    vibe: round.vibe as GolfCall["vibe"],
    walkOrCart: round.walk_or_cart as GolfCall["walkOrCart"],
    holes: round.holes as GolfCall["holes"],
    gameFormat: round.game_format as GolfCall["gameFormat"],
    status: round.status as GolfCall["status"],
    notes: round.notes ?? undefined,
    createdAt: round.created_at,
    teeTimeSource: round.tee_time_source as GolfCall["teeTimeSource"],
    bookingSource: round.booking_source ?? undefined,
    verificationCreatedAt: round.verification_created_at ?? undefined,
  };
}
