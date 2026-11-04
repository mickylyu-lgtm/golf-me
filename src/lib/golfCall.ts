import type { GolfCall } from "../types";
// Explicit .ts so tests/roundChat.test.ts can load this module under
// node --test (same as coachReplay.ts -> swingAssessment.ts).
import { haversineMiles } from "./geo.ts";
import type { GeoPoint } from "./geo.ts";

// A round's dateISO is noon on the host's chosen day, converted to UTC
// (CreateGolfCall / EditTeeTimeModal: new Date(`${date}T12:00:00`)). For
// any host between UTC-12 and UTC+11 that instant falls on the same UTC
// calendar date as the day they picked, so reading the UTC date gives the
// host's intended day for every viewer, wherever they are (Health Audit
// P3-3 — reading it in the viewer's own zone showed a New York host's
// Oct 5 round as Oct 6 in Tokyo). Hosts at UTC+12..+14 (e.g. New Zealand in
// summer) would still read one day early — accepted.
// Returns a Date at LOCAL noon on that calendar day, so existing local-day
// logic (same-day checks, weekday, toLocaleDateString) works unchanged.
export function roundCalendarDay(dateISO: string): Date {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return d;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0);
}

// Local calendar date as a <input type="date"> value (YYYY-MM-DD). Not
// toISOString(): that's the UTC date, which is tomorrow in New York after
// 8 PM and yesterday in Asia in the morning — it made "Today" pick the wrong
// (sometimes already-past) day when hosting.
export function localDateInputValue(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Best-effort read of the free-text tee time ("10:00 AM", "7:30pm", "9 am",
// "14:05"). Null when it isn't a clock time ("Morning", "TBD"), so callers
// never reject something they can't actually interpret.
export function parseTeeTimeLabel(label: string): { hours: number; minutes: number } | null {
  const s = String(label ?? "").trim();
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\b/i.exec(s);
  if (twelve) {
    let hours = Number(twelve[1]);
    const minutes = Number(twelve[2] ?? 0);
    if (hours < 1 || hours > 12 || minutes > 59) return null;
    if (twelve[3].toLowerCase() === "p" && hours !== 12) hours += 12;
    if (twelve[3].toLowerCase() === "a" && hours === 12) hours = 0;
    return { hours, minutes };
  }
  const twentyFour = /^(\d{1,2}):(\d{2})\b/.exec(s);
  if (twentyFour) {
    const hours = Number(twentyFour[1]);
    const minutes = Number(twentyFour[2]);
    if (hours > 23 || minutes > 59) return null;
    return { hours, minutes };
  }
  return null;
}

// True when a round being hosted/edited would start in the past: any day
// before today, or today at a clock time that has already passed. Today with
// an unreadable time ("Morning") is allowed — there's nothing to compare.
export function isPastRoundStart(dateYmd: string, timeLabel: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return false;
  const today = localDateInputValue(now);
  if (dateYmd < today) return true;
  if (dateYmd > today) return false;
  const t = parseTeeTimeLabel(timeLabel);
  if (!t) return false;
  return t.hours * 60 + t.minutes < now.getHours() * 60 + now.getMinutes();
}

// A round whose calendar day is before today (viewer's today). Rounds
// happening today still count as upcoming. Used to keep past-dated open
// rounds out of browse/join; the server enforces its own rule too.
export function isPastRound(call: Pick<GolfCall, "dateISO">): boolean {
  const roundDay = roundCalendarDay(call.dateISO);
  if (Number.isNaN(roundDay.getTime())) return false;
  roundDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return roundDay.getTime() < today.getTime();
}

type RoundTiming = Pick<GolfCall, "dateISO" | "timeLabel">;

// When the round starts, in the viewer's local clock: the round's calendar
// day (roundCalendarDay, so every viewer agrees on the day) at its tee time.
// timeKnown is false when the label isn't a clock time ("Morning", "TBD");
// start is then local midnight of that day. Null for an unreadable date.
export function roundStartTime(call: RoundTiming): { start: Date; timeKnown: boolean } | null {
  const day = roundCalendarDay(call.dateISO);
  if (Number.isNaN(day.getTime())) return null;
  const time = parseTeeTimeLabel(call.timeLabel);
  if (time) day.setHours(time.hours, time.minutes, 0, 0);
  else day.setHours(0, 0, 0, 0);
  return { start: day, timeKnown: Boolean(time) };
}

// Still to be played: open or full, and the tee time hasn't passed. With no
// readable tee time it stays upcoming for its whole day. An unreadable date
// stays upcoming (as before this helper existed) rather than vanishing.
export function isUpcomingRound(call: RoundTiming & Pick<GolfCall, "status">, now: Date = new Date()): boolean {
  if (call.status !== "open" && call.status !== "full") return false;
  const timing = roundStartTime(call);
  if (!timing) return true;
  if (timing.timeKnown) return timing.start.getTime() >= now.getTime();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return timing.start.getTime() >= today.getTime();
}

// Ordering key for "soonest first". A round with no clock time sorts as
// midday on its day.
export function roundSortTime(call: RoundTiming): number {
  const timing = roundStartTime(call);
  if (!timing) return Number.POSITIVE_INFINITY;
  return timing.timeKnown ? timing.start.getTime() : timing.start.getTime() + 12 * 60 * 60 * 1000;
}

function isMyRound(call: Pick<GolfCall, "hostId" | "joinedGolferIds">, viewerId: string): boolean {
  return call.hostId === viewerId || call.joinedGolferIds.includes(viewerId);
}

// The Chat inbox's pinned "next round": the earliest upcoming round the
// viewer hosts or has joined. Null when there isn't one.
export function nextUpcomingRound<T extends GolfCall>(calls: readonly T[], viewerId: string, now: Date = new Date()): T | null {
  let best: T | null = null;
  for (const c of calls) {
    if (!isMyRound(c, viewerId) || !isUpcomingRound(c, now)) continue;
    if (!best || roundSortTime(c) < roundSortTime(best) || (roundSortTime(c) === roundSortTime(best) && c.id < best.id)) best = c;
  }
  return best;
}

// The Chat inbox's Rounds list: every round the viewer hosts or has joined
// (a round they left isn't in joinedGolferIds, so it drops out). Upcoming
// rounds first, soonest first; then everything else (past-dated, completed,
// cancelled), most recent first.
export function orderRoundChats<T extends GolfCall>(calls: readonly T[], viewerId: string, now: Date = new Date()): T[] {
  const mine = calls.filter((c) => isMyRound(c, viewerId));
  const upcoming = mine.filter((c) => isUpcomingRound(c, now)).sort((a, b) => roundSortTime(a) - roundSortTime(b) || a.id.localeCompare(b.id));
  const rest = mine.filter((c) => !isUpcomingRound(c, now)).sort((a, b) => roundSortTime(b) - roundSortTime(a) || a.id.localeCompare(b.id));
  return [...upcoming, ...rest];
}

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
    .sort((a, b) => Number(b === round.host_user_id) - Number(a === round.host_user_id));

  // undefined (never 0) when coordinates aren't known -- a round with no
  // course coordinates is unknown-distance, not "right next to the user."
  const distanceMiles =
    viewerLocation && round.course_lat != null && round.course_lng != null
      ? haversineMiles(viewerLocation, { lat: round.course_lat, lng: round.course_lng })
      : undefined;

  return {
    id: round.id,
    hostId: round.host_user_id,
    course: round.course_name,
    courseId: round.course_id ?? undefined,
    courseLat: round.course_lat ?? undefined,
    courseLng: round.course_lng ?? undefined,
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
