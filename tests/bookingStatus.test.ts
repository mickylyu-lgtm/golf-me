// Run: npm run test:trust  (node --test, built-in type stripping)
// Honest booking status (Stage 1, docs/booking-status-plan.md): only a host
// claim can read as booked, nothing else ever does; no claim on cancelled,
// completed or past rounds; the stored free-text source is never shown.
process.env.TZ = "America/New_York";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bookingErrorKey, bookingSourceKey, bookingStatusView, canSubmitEvidence } from "../src/lib/bookingStatus.ts";
import type { GolfCall } from "../src/types/index.ts";

const NOW = new Date("2026-11-05T15:00:00-05:00"); // Thu 3 PM New York
const round = (over: Partial<GolfCall> = {}) =>
  ({
    teeTimeSource: "manual",
    status: "open",
    dateISO: new Date("2026-11-08T12:00:00-05:00").toISOString(), // Sun
    timeLabel: "9:00 AM",
    ...over,
  }) as GolfCall;

test("legacy: only a host-attached confirmation reads as booked (host reported)", () => {
  const v = bookingStatusView(round({ teeTimeSource: "user_verified" }), NOW);
  assert.equal(v.model, "legacy");
  assert.equal(v.state, "booked_host_reported");
  assert.equal(v.evidence, "none"); // nobody reviewed a legacy upload
  assert.equal(v.showClaim, true);
  assert.equal(v.labelKey, "golfCallDetail.bookingProofBadge");
});

test("server: each booking status maps to its own label; unknown values never read as booked", () => {
  const expect: Record<string, [string, string]> = {
    unknown: ["not_provided", "booking.notProvided"],
    not_needed: ["not_needed", "booking.statusNotNeeded"],
    needed: ["needed", "booking.statusNeeded"],
    pending: ["pending", "booking.statusPending"],
    booked: ["booked_host_reported", "golfCallDetail.bookingProofBadge"],
    changed: ["changed", "booking.statusChanged"],
    cancelled: ["cancelled", "booking.statusCancelled"],
    verified: ["not_provided", "booking.notProvided"],
    "": ["not_provided", "booking.notProvided"],
    toString: ["not_provided", "booking.notProvided"],
  };
  for (const [status, [state, label]] of Object.entries(expect)) {
    // teeTimeSource 'user_verified' must not leak through once the server model exists.
    const v = bookingStatusView(round({ bookingStatus: status as GolfCall["bookingStatus"], teeTimeSource: "user_verified" }), NOW);
    assert.equal(v.model, "server", status);
    assert.equal(v.state, state, status);
    assert.equal(v.labelKey, label, status);
    assert.equal(v.showClaim, state !== "not_provided", status);
  }
});

test("server: evidence only counts on a booked round; reviewed needs its review time", () => {
  const booked = { bookingStatus: "booked" as const };
  assert.equal(bookingStatusView(round({ ...booked, evidenceStatus: "submitted" }), NOW).evidence, "submitted");
  assert.equal(bookingStatusView(round({ ...booked, evidenceStatus: "submitted" }), NOW).labelKey, "golfCallDetail.bookingProofBadge");
  const reviewed = bookingStatusView(round({ ...booked, evidenceStatus: "reviewed", evidenceReviewedAt: "2026-11-04T10:00:00Z" }), NOW);
  assert.equal(reviewed.evidence, "reviewed");
  assert.equal(reviewed.labelKey, "booking.statusReviewed");
  assert.equal(reviewed.reviewedAt, "2026-11-04T10:00:00Z");
  assert.equal(bookingStatusView(round({ ...booked, evidenceStatus: "reviewed" }), NOW).evidence, "none", "reviewed without a time");
  assert.equal(bookingStatusView(round({ ...booked, evidenceStatus: "approved" as GolfCall["evidenceStatus"] }), NOW).evidence, "none");
  for (const status of ["changed", "cancelled", "pending", "needed", "not_needed", "unknown"] as const) {
    const v = bookingStatusView(round({ bookingStatus: status, evidenceStatus: "reviewed", evidenceReviewedAt: "2026-11-04T10:00:00Z" }), NOW);
    assert.equal(v.evidence, "none", status);
    assert.notEqual(v.labelKey, "booking.statusReviewed", status);
  }
});

test("server: a reviewed badge disappears after the round and on cancelled/completed rounds", () => {
  const r = { bookingStatus: "booked" as const, evidenceStatus: "reviewed" as const, evidenceReviewedAt: "2026-11-04T10:00:00Z" };
  assert.equal(bookingStatusView(round(r), NOW).showClaim, true);
  const past = new Date("2026-11-04T12:00:00-05:00").toISOString();
  assert.equal(bookingStatusView(round({ ...r, dateISO: past }), NOW).showClaim, false);
  assert.equal(bookingStatusView(round({ ...r, status: "cancelled" }), NOW).showClaim, false);
  assert.equal(bookingStatusView(round({ ...r, status: "completed" }), NOW).showClaim, false);
});

test("booked party size is host-reported and only kept on booked/changed rounds", () => {
  assert.equal(bookingStatusView(round({ bookingStatus: "booked", bookingPartySize: 3 }), NOW).partySize, 3);
  assert.equal(bookingStatusView(round({ bookingStatus: "changed", bookingPartySize: 3 }), NOW).partySize, 3);
  assert.equal(bookingStatusView(round({ bookingStatus: "pending", bookingPartySize: 3 }), NOW).partySize, undefined);
  assert.equal(bookingStatusView(round({ bookingStatus: "booked", bookingPartySize: 0 }), NOW).partySize, undefined);
});

test("evidence can be added only to a booked, upcoming round on the server model", () => {
  assert.equal(canSubmitEvidence(bookingStatusView(round({ bookingStatus: "booked" }), NOW)), true);
  assert.equal(canSubmitEvidence(bookingStatusView(round({ bookingStatus: "pending" }), NOW)), false);
  assert.equal(canSubmitEvidence(bookingStatusView(round({ teeTimeSource: "user_verified" }), NOW)), false, "legacy");
  assert.equal(canSubmitEvidence(bookingStatusView(round({ bookingStatus: "booked", status: "cancelled" }), NOW)), false);
});

test("server error codes map to translated messages", () => {
  assert.equal(bookingErrorKey("40001"), "booking.errorChanged");
  assert.equal(bookingErrorKey("42501"), "booking.errorNotAllowed");
  assert.equal(bookingErrorKey("22023"), "booking.errorInvalid");
  assert.equal(bookingErrorKey(undefined), "golfCallDetail.bookingProofSaveError");
});

test("legacy, reserved and unknown values never read as booked", () => {
  for (const source of ["manual", "provider_verified", "user_entered", "", "USER_VERIFIED", "verified", undefined, null]) {
    const v = bookingStatusView(round({ teeTimeSource: source as GolfCall["teeTimeSource"] }), NOW);
    assert.equal(v.state, "not_provided", String(source));
    assert.equal(v.showClaim, false, String(source));
  }
});

test("full rounds still show the claim; cancelled and completed show nothing", () => {
  assert.equal(bookingStatusView(round({ teeTimeSource: "user_verified", status: "full" }), NOW).showClaim, true);
  for (const status of ["cancelled", "completed"] as const) {
    const v = bookingStatusView(round({ teeTimeSource: "user_verified", status }), NOW);
    assert.equal(v.visible, false, status);
    assert.equal(v.showClaim, false, status);
  }
});

test("a claim expires once the tee time has passed", () => {
  const today = new Date("2026-11-05T12:00:00-05:00").toISOString();
  assert.equal(bookingStatusView(round({ teeTimeSource: "user_verified", dateISO: today, timeLabel: "4:00 PM" }), NOW).showClaim, true);
  assert.equal(bookingStatusView(round({ teeTimeSource: "user_verified", dateISO: today, timeLabel: "9:00 AM" }), NOW).showClaim, false);
  const yesterday = new Date("2026-11-04T12:00:00-05:00").toISOString();
  assert.equal(bookingStatusView(round({ teeTimeSource: "user_verified", dateISO: yesterday, timeLabel: "Morning" }), NOW).showClaim, false);
});

test("booking source: the five picker values map to their labels, anything else is 'Host reported'", () => {
  assert.equal(bookingSourceKey("Course Website"), "golfCallDetail.bookingSourceCourseWebsite");
  assert.equal(bookingSourceKey("GolfNow"), "golfCallDetail.bookingSourceGolfNow");
  assert.equal(bookingSourceKey("Lightspeed / Chronogolf"), "golfCallDetail.bookingSourceLightspeed");
  assert.equal(bookingSourceKey("Phone Reservation"), "golfCallDetail.bookingSourcePhone");
  assert.equal(bookingSourceKey("Other"), "golfCallDetail.bookingSourceOther");
  for (const s of ["Confirmed directly by the course - guaranteed", "golfnow", "toString", "__proto__", "", null, undefined]) {
    assert.equal(bookingSourceKey(s), "booking.sourceHostReported", String(s));
  }
});

// Copy guard: every locale has the booking keys, and no booking or group
// count string claims verification, confirmation, guarantees or live
// availability.
const LOCALES = ["en", "es", "ja", "ko", "zh-CN", "zh-TW"];
const BOOKING_KEYS = [
  "booking.label",
  "booking.notProvided",
  "booking.joinDisclaimer",
  "booking.availabilityNotConnected",
  "booking.sourceHostReported",
  "booking.statusNotNeeded",
  "booking.statusNeeded",
  "booking.statusPending",
  "booking.statusChanged",
  "booking.statusCancelled",
  "booking.statusReviewed",
  "booking.evidenceSubmitted",
  "booking.evidenceReviewed",
  "booking.evidenceNeedsCorrection",
  "booking.partySize",
  "golfCallDetail.bookingProofBadge",
  "golfCallDetail.bookingProofMatchReason",
  "golfCallDetail.bookingProofExplainerTitle",
  "golfCallDetail.bookingProofExplainerBody",
  "golfCallDetail.bookingProofVerifiedByLabel",
  "golfCallDetail.removeBookingProofConfirm",
  "golfCallDetail.proofInvalidatedToast",
  "host.verifyYourTeeTime",
  "host.verifyYourTeeTimeBody",
  "golfCallCard.spotsRemainingSingular",
  "golfCallCard.spotsRemainingPlural",
  "golfCallDetail.oneSpotLeft",
  "golfCallDetail.foursome",
  "golfCallDetail.foursomeFull",
  "golfCallDetail.joinedInstantToast",
  "coursePage.teeTimesNote",
  "teeTimes.subtitle",
  "teeTimes.liveInsideGolfMe",
];
const BANNED_EN = /verif|confirmed|guarantee|live availab|\byet\b|✓/i;

function localeEntries(name: string): Map<string, string> {
  const src = readFileSync(new URL(`../src/i18n/locales/${name}.ts`, import.meta.url), "utf8");
  const map = new Map<string, string>();
  for (const m of src.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) map.set(m[1], m[2]);
  return map;
}

test("booking and group-count keys exist in all six locales", () => {
  for (const name of LOCALES) {
    const entries = localeEntries(name);
    for (const key of BOOKING_KEYS) assert.ok(entries.get(key), `${name}: ${key}`);
    assert.equal(entries.has("golfCallDetail.spotsOpen"), false, `${name}: spotsOpen removed`);
    assert.equal(entries.has("golfCallDetail.bookingProofNotIndependentlyConfirmed"), false, `${name}: old disclaimer removed`);
  }
});

test("English booking copy makes no verification, guarantee or live-availability claim", () => {
  const en = localeEntries("en");
  for (const key of BOOKING_KEYS) assert.doesNotMatch(en.get(key) ?? "", BANNED_EN, key);
  assert.match(en.get("golfCallDetail.bookingProofBadge") ?? "", /Host reported/);
  assert.equal(
    en.get("booking.joinDisclaimer"),
    "Joining this GolfMe group does not reserve a tee time or a spot with the course. Coordinate booking details with the host.",
  );
});
