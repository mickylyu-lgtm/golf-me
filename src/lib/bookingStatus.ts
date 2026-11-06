import type { GolfCall } from "../types";
import type { TranslationKey } from "../i18n/locales/en";
// Explicit .ts so tests/bookingStatus.test.ts can load this under node --test.
import { isUpcomingRound } from "./golfCall.ts";

// What a round may honestly say about its tee-time booking
// (docs/booking-status-plan.md). Three things stay separate: the GolfMe
// group (never here), the host-reported booking, and GolfMe's review of the
// host's evidence. Course availability is never claimed (not connected).
//
// Two sources:
//   server -- golf_calls.booking_status / evidence_status (migration
//             20261107150000). Only these values are trusted; anything else
//             reads "not provided" / "no evidence".
//   legacy -- before that migration (and demo rounds): tee_time_source.
//             'user_verified' = the host attached a confirmation, nobody
//             reviewed it -> "Booked · Host reported". Everything else,
//             including the reserved 'provider_verified', -> "not provided".
export type BookingState = "not_provided" | "not_needed" | "needed" | "pending" | "booked_host_reported" | "changed" | "cancelled";
export type EvidenceState = "none" | "submitted" | "reviewed" | "needs_correction";

export interface BookingStatusView {
  model: "server" | "legacy";
  state: BookingState;
  // Only ever not "none" on a booked round.
  evidence: EvidenceState;
  // Show any booking line at all: only for a round still to be played, so
  // an old claim or review never looks current.
  visible: boolean;
  // Show a status chip (cards, round page): visible and something was said.
  showClaim: boolean;
  // The chip's text.
  labelKey: TranslationKey;
  // When the current evidence was reviewed (only with evidence "reviewed").
  reviewedAt?: string;
  // Host-reported booked party size (booked/changed only). Never a count of
  // GolfMe members.
  partySize?: number;
}

type BookingInput = Pick<GolfCall, "teeTimeSource" | "status" | "dateISO" | "timeLabel"> &
  Partial<Pick<GolfCall, "bookingStatus" | "evidenceStatus" | "evidenceReviewedAt" | "bookingPartySize">>;

const SERVER_STATES: Record<string, BookingState> = {
  unknown: "not_provided",
  not_needed: "not_needed",
  needed: "needed",
  pending: "pending",
  booked: "booked_host_reported",
  changed: "changed",
  cancelled: "cancelled",
};

const LABELS: Record<BookingState, TranslationKey> = {
  not_provided: "booking.notProvided",
  not_needed: "booking.statusNotNeeded",
  needed: "booking.statusNeeded",
  pending: "booking.statusPending",
  booked_host_reported: "golfCallDetail.bookingProofBadge",
  changed: "booking.statusChanged",
  cancelled: "booking.statusCancelled",
};

function has(map: Record<string, unknown>, key: unknown): key is string {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key);
}

export function bookingStatusView(call: BookingInput, now: Date = new Date()): BookingStatusView {
  const visible = isUpcomingRound(call, now);
  const model: BookingStatusView["model"] = call.bookingStatus !== undefined ? "server" : "legacy";

  let state: BookingState;
  let evidence: EvidenceState = "none";
  if (model === "server") {
    state = has(SERVER_STATES, call.bookingStatus) ? SERVER_STATES[call.bookingStatus] : "not_provided";
    if (state === "booked_host_reported") {
      const ev = call.evidenceStatus;
      if (ev === "submitted" || ev === "needs_correction") evidence = ev;
      // "reviewed" needs its review time; without one it is not shown as reviewed.
      if (ev === "reviewed" && call.evidenceReviewedAt) evidence = "reviewed";
    }
  } else {
    state = (call.teeTimeSource as string) === "user_verified" ? "booked_host_reported" : "not_provided";
  }

  const partySize =
    (state === "booked_host_reported" || state === "changed") && typeof call.bookingPartySize === "number" && call.bookingPartySize >= 1
      ? call.bookingPartySize
      : undefined;
  const labelKey: TranslationKey = evidence === "reviewed" ? "booking.statusReviewed" : LABELS[state];

  return {
    model,
    state,
    evidence,
    visible,
    showClaim: visible && state !== "not_provided",
    labelKey,
    reviewedAt: evidence === "reviewed" ? call.evidenceReviewedAt : undefined,
    partySize,
  };
}

// The host-picked "Booked via" values (CreateGolfCall / the booking panel).
// golf_calls.booking_source was free text before 20261107150000, so whatever
// else is stored there is never shown: it reads as "Host reported".
export const BOOKING_SOURCES = ["Course Website", "GolfNow", "Lightspeed / Chronogolf", "Phone Reservation", "Other"] as const;
const BOOKING_SOURCE_KEYS: Record<string, TranslationKey> = {
  "Course Website": "golfCallDetail.bookingSourceCourseWebsite",
  GolfNow: "golfCallDetail.bookingSourceGolfNow",
  "Lightspeed / Chronogolf": "golfCallDetail.bookingSourceLightspeed",
  "Phone Reservation": "golfCallDetail.bookingSourcePhone",
  Other: "golfCallDetail.bookingSourceOther",
};

export function bookingSourceKey(source: string | null | undefined): TranslationKey {
  if (has(BOOKING_SOURCE_KEYS, source)) return BOOKING_SOURCE_KEYS[source];
  return "booking.sourceHostReported";
}

// Statuses a host can pick in the booking panel (server model). "unknown"
// can't be picked again once something was said.
export const HOST_BOOKING_CHOICES = ["booked", "pending", "needed", "not_needed", "changed", "cancelled"] as const;
export type HostBookingChoice = (typeof HOST_BOOKING_CHOICES)[number];

export const HOST_BOOKING_CHOICE_KEYS: Record<HostBookingChoice, TranslationKey> = {
  booked: "booking.choiceBooked",
  pending: "booking.statusPending",
  needed: "booking.statusNeeded",
  not_needed: "booking.choiceNotNeeded",
  changed: "booking.choiceChanged",
  cancelled: "booking.statusCancelled",
};

// Evidence can only be added to a booked round that is still to be played.
export function canSubmitEvidence(view: BookingStatusView): boolean {
  return view.model === "server" && view.visible && view.state === "booked_host_reported";
}

// Server errors (Postgres SQLSTATE) the booking calls can raise -> what to say.
export function bookingErrorKey(code: string | undefined): TranslationKey {
  switch (code) {
    case "40001":
      return "booking.errorChanged";
    case "42501":
      return "booking.errorNotAllowed";
    case "22023":
      return "booking.errorInvalid";
    default:
      return "golfCallDetail.bookingProofSaveError";
  }
}
