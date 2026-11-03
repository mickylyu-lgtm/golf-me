// Run: npm run test:roundchat  (node --test, built-in type stripping)
// Round conversations: the next-round shortcut, the Chat inbox's Rounds
// ordering, the pending -> sent -> failed -> retry lifecycle of a real round
// message, and who may read / post a round's chat.
//
// Times are in New York (the launch city) unless a test switches zones;
// round dates are stored the way CreateGolfCall writes them: noon on the
// host's day, as UTC.
process.env.TZ = "America/New_York";

import { test } from "node:test";
import assert from "node:assert/strict";
import { isUpcomingRound, nextUpcomingRound, orderRoundChats, roundStartTime } from "../src/lib/golfCall.ts";
import {
  canPostRoundChat,
  canReadRoundChat,
  classifyRoundSendError,
  createPendingRoundMessage,
  discardRoundMessage,
  markRoundMessageFailed,
  markRoundMessageRetrying,
  markRoundMessageSent,
  mergeRoundMessages,
  reconcilePendingRoundMessages,
  roundChatAccess,
} from "../src/lib/roundChat.ts";
import type { RoundChatAccessInput, RoundMessageRowLike } from "../src/lib/roundChat.ts";
import type { GolfCall } from "../src/types/index.ts";

const ME = "me";

// Noon local on y-m-d, as UTC (what new Date(`${date}T12:00:00`).toISOString() gives the host).
function hostDay(ymd: string): string {
  return new Date(`${ymd}T12:00:00`).toISOString();
}

function round(id: string, patch: Partial<GolfCall> = {}): GolfCall {
  return {
    id,
    hostId: "host",
    course: `Course ${id}`,
    areaLabel: "Brooklyn",
    dateISO: hostDay("2026-11-05"),
    timeLabel: "9:00 AM",
    estimatedPricePerPerson: 50,
    totalSpots: 4,
    joinedGolferIds: ["host", ME],
    pendingRequestIds: [],
    joinMode: "instant",
    skillLevel: "Intermediate",
    vibe: "Casual",
    walkOrCart: "Either",
    holes: 18,
    gameFormat: "Stroke Play",
    status: "open",
    createdAt: "2026-11-01T00:00:00.000Z",
    ...patch,
  } as GolfCall;
}

const at = (local: string) => new Date(local); // "2026-11-05T08:00:00" -> local time

// --- tee time + upcoming ----------------------------------------------------

test("roundStartTime: the round's day at its tee time, local clock", () => {
  const s = roundStartTime(round("a", { timeLabel: "7:30 PM" }))!;
  assert.equal(s.timeKnown, true);
  assert.equal(s.start.getFullYear(), 2026);
  assert.equal(s.start.getMonth(), 10);
  assert.equal(s.start.getDate(), 5);
  assert.equal(s.start.getHours(), 19);
  assert.equal(s.start.getMinutes(), 30);
  assert.equal(roundStartTime(round("b", { timeLabel: "Morning" }))!.timeKnown, false);
  assert.equal(roundStartTime(round("c", { dateISO: "not a date" })), null);
});

test("upcoming: tee time later today yes, earlier today no, tomorrow yes", () => {
  const now = at("2026-11-05T10:00:00");
  assert.equal(isUpcomingRound(round("a", { timeLabel: "2:00 PM" }), now), true);
  assert.equal(isUpcomingRound(round("a", { timeLabel: "9:00 AM" }), now), false);
  assert.equal(isUpcomingRound(round("a", { dateISO: hostDay("2026-11-06"), timeLabel: "6:00 AM" }), now), true);
  assert.equal(isUpcomingRound(round("a", { dateISO: hostDay("2026-11-04"), timeLabel: "6:00 PM" }), now), false);
});

test("upcoming: no readable tee time stays upcoming for its whole day", () => {
  assert.equal(isUpcomingRound(round("a", { timeLabel: "Morning" }), at("2026-11-05T23:59:00")), true);
  assert.equal(isUpcomingRound(round("a", { timeLabel: "Morning" }), at("2026-11-06T00:01:00")), false);
});

test("upcoming: only open or full rounds", () => {
  const now = at("2026-11-04T10:00:00");
  assert.equal(isUpcomingRound(round("a", { status: "full" }), now), true);
  assert.equal(isUpcomingRound(round("a", { status: "cancelled" }), now), false);
  assert.equal(isUpcomingRound(round("a", { status: "completed" }), now), false);
});

test("timezone edge: late evening in New York is already the next UTC day", () => {
  // 23:30 New York on Nov 5 = 04:30 UTC Nov 6. The round is still "Nov 5".
  const now = at("2026-11-05T23:30:00");
  assert.equal(isUpcomingRound(round("a", { timeLabel: "11:45 PM" }), now), true);
  assert.equal(isUpcomingRound(round("a", { timeLabel: "7:00 AM" }), now), false);
  // A round on Nov 6 is upcoming even though UTC has already reached Nov 6.
  assert.equal(isUpcomingRound(round("b", { dateISO: hostDay("2026-11-06"), timeLabel: "Morning" }), now), true);
});

test("timezone edge: a viewer in Tokyo reads the host's day, not Tokyo's", () => {
  const prev = process.env.TZ;
  try {
    process.env.TZ = "Asia/Tokyo";
    // A New York host's Nov 5 round (stored 2026-11-05T17:00Z) is Nov 6 02:00 in Tokyo,
    // but it's still the Nov 5 round for everyone.
    const r = round("a", { dateISO: "2026-11-05T17:00:00.000Z", timeLabel: "Morning" });
    assert.equal(roundStartTime(r)!.start.getDate(), 5);
    assert.equal(isUpcomingRound(r, new Date("2026-11-05T10:00:00+09:00")), true);
    assert.equal(isUpcomingRound(r, new Date("2026-11-06T10:00:00+09:00")), false);
  } finally {
    process.env.TZ = prev;
  }
});

// --- next round -------------------------------------------------------------

test("next round: earliest upcoming round I host or joined", () => {
  const now = at("2026-11-05T10:00:00");
  const calls = [
    round("later", { dateISO: hostDay("2026-11-08") }),
    round("soon", { dateISO: hostDay("2026-11-06"), timeLabel: "8:00 AM" }),
    round("hosting", { hostId: ME, joinedGolferIds: [ME], dateISO: hostDay("2026-11-07") }),
  ];
  assert.equal(nextUpcomingRound(calls, ME, now)?.id, "soon");
});

test("next round: skips past, cancelled, completed and not-mine; full counts", () => {
  const now = at("2026-11-05T10:00:00");
  const calls = [
    round("pastToday", { timeLabel: "7:00 AM" }),
    round("yesterday", { dateISO: hostDay("2026-11-04") }),
    round("cancelled", { dateISO: hostDay("2026-11-06"), status: "cancelled" }),
    round("completed", { dateISO: hostDay("2026-11-06"), status: "completed" }),
    round("notMine", { dateISO: hostDay("2026-11-06"), joinedGolferIds: ["host", "someone"] }),
    round("full", { dateISO: hostDay("2026-11-07"), status: "full" }),
  ];
  assert.equal(nextUpcomingRound(calls, ME, now)?.id, "full");
  assert.equal(nextUpcomingRound(calls.slice(0, 5), ME, now), null);
  assert.equal(nextUpcomingRound([], ME, now), null);
});

test("next round: same day, clock time before an unreadable one (sorted as midday)", () => {
  const now = at("2026-11-05T06:00:00");
  const calls = [round("morning", { timeLabel: "Morning" }), round("eight", { timeLabel: "8:00 AM" }), round("three", { timeLabel: "3:00 PM" })];
  assert.equal(nextUpcomingRound(calls, ME, now)?.id, "eight");
  assert.deepEqual(orderRoundChats(calls, ME, now).map((c) => c.id), ["eight", "morning", "three"]);
});

// --- Rounds list ordering ---------------------------------------------------

test("Rounds list: upcoming soonest first, then past/ended most recent first; left rounds gone", () => {
  const now = at("2026-11-05T10:00:00");
  const calls = [
    round("completedOld", { dateISO: hostDay("2026-10-20"), status: "completed" }),
    round("upNext", { dateISO: hostDay("2026-11-06") }),
    round("pastOpen", { dateISO: hostDay("2026-11-03") }),
    round("upLater", { dateISO: hostDay("2026-11-10"), status: "full" }),
    round("cancelledRecent", { dateISO: hostDay("2026-11-04"), status: "cancelled" }),
    round("todayDone", { timeLabel: "7:00 AM" }),
    round("leftIt", { dateISO: hostDay("2026-11-07"), joinedGolferIds: ["host"] }),
    round("cancelledFuture", { dateISO: hostDay("2026-11-12"), status: "cancelled" }),
  ];
  assert.deepEqual(
    orderRoundChats(calls, ME, now).map((c) => c.id),
    ["upNext", "upLater", "cancelledFuture", "todayDone", "cancelledRecent", "pastOpen", "completedOld"],
  );
});

test("Rounds list: rounds I host are included", () => {
  const now = at("2026-11-05T10:00:00");
  const calls = [round("mine", { hostId: ME, joinedGolferIds: [ME], dateISO: hostDay("2026-11-06") })];
  assert.deepEqual(orderRoundChats(calls, ME, now).map((c) => c.id), ["mine"]);
});

// --- pending / sent / failed / retry ----------------------------------------

const row = (id: string, text: string, created_at: string, round_id = "r1", sender_id = ME): RoundMessageRowLike => ({ id, round_id, sender_id, text, created_at });

test("send lifecycle: sending -> sent -> dropped once its row arrives", () => {
  let pending = [createPendingRoundMessage({ clientId: "c1", roundId: "r1", senderId: ME, text: "On my way", now: new Date("2026-11-05T14:00:00Z") })];
  let shown = mergeRoundMessages([], pending, "r1");
  assert.equal(shown.length, 1);
  assert.equal(shown[0].delivery, "sending");

  pending = markRoundMessageSent(pending, "c1", { id: "m1", created_at: "2026-11-05T14:00:01Z" });
  shown = mergeRoundMessages([], pending, "r1");
  assert.equal(shown[0].delivery, undefined, "sent renders as a normal message");
  assert.equal(shown[0].id, "m1");

  // A refetch that started before the insert (no row yet) keeps it on screen.
  assert.equal(reconcilePendingRoundMessages(pending, []).length, 1);
  // Its row arrives: no duplicate, and the pending entry is dropped.
  const rows = [row("m1", "On my way", "2026-11-05T14:00:01Z")];
  shown = mergeRoundMessages(rows, pending, "r1");
  assert.equal(shown.length, 1);
  assert.equal(reconcilePendingRoundMessages(pending, rows).length, 0);
});

test("send lifecycle: failed stays (never reconciled away) -> retry -> sent", () => {
  let pending = [createPendingRoundMessage({ clientId: "c1", roundId: "r1", senderId: ME, text: "Running late" })];
  pending = markRoundMessageFailed(pending, "c1", "network");
  // Even an identical row from someone else / earlier doesn't remove a failed message.
  const rows = [row("x", "Running late", new Date().toISOString())];
  assert.equal(reconcilePendingRoundMessages(pending, rows).length, 1);
  const failed = mergeRoundMessages([], pending, "r1")[0];
  assert.equal(failed.delivery, "failed");
  assert.equal(failed.failure, "network");
  assert.equal(failed.text, "Running late");
  assert.equal(failed.clientId, "c1");

  pending = markRoundMessageRetrying(pending, "c1");
  assert.equal(pending[0].state, "sending");
  assert.equal(pending[0].failure, undefined);
  pending = markRoundMessageSent(pending, "c1", { id: "m9", created_at: new Date().toISOString() });
  assert.equal(pending[0].state, "sent");
});

test("retry only moves a failed message; discard removes just that one", () => {
  let pending = [
    createPendingRoundMessage({ clientId: "a", roundId: "r1", senderId: ME, text: "one" }),
    createPendingRoundMessage({ clientId: "b", roundId: "r1", senderId: ME, text: "two" }),
  ];
  pending = markRoundMessageSent(pending, "a", { id: "m1", created_at: new Date().toISOString() });
  assert.equal(markRoundMessageRetrying(pending, "a")[0].state, "sent");
  pending = markRoundMessageFailed(pending, "b", "rejected");
  pending = discardRoundMessage(pending, "b");
  assert.deepEqual(pending.map((p) => p.clientId), ["a"]);
});

test("sent without a returned id: matched by content, tolerating clock skew; one row claims one message", () => {
  const localNow = new Date("2026-11-05T14:00:30Z"); // device clock 30s ahead of the server
  let pending = [
    createPendingRoundMessage({ clientId: "a", roundId: "r1", senderId: ME, text: "ok", now: localNow }),
    createPendingRoundMessage({ clientId: "b", roundId: "r1", senderId: ME, text: "ok", now: localNow }),
  ];
  pending = markRoundMessageSent(markRoundMessageSent(pending, "a", null), "b", null);
  const rows = [row("m1", "ok", "2026-11-05T14:00:00Z")];
  assert.deepEqual(reconcilePendingRoundMessages(pending, rows).map((p) => p.clientId), ["b"]);
  assert.equal(mergeRoundMessages(rows, pending, "r1").length, 2);
});

test("merge: only this round; unsent messages sit at the bottom", () => {
  const rows = [row("m1", "first", "2026-11-05T14:00:00Z"), row("m2", "other round", "2026-11-05T14:00:05Z", "r2"), row("m3", "later", "2026-11-05T14:10:00Z", "r1", "host")];
  const pending = markRoundMessageFailed(
    [createPendingRoundMessage({ clientId: "c1", roundId: "r1", senderId: ME, text: "mine", now: new Date("2026-11-05T14:05:00Z") })],
    "c1",
    "network",
  );
  assert.deepEqual(mergeRoundMessages(rows, pending, "r1").map((m) => m.text), ["first", "later", "mine"]);
  assert.deepEqual(mergeRoundMessages(rows, pending, "r2").map((m) => m.text), ["other round"]);
});

test("classifyRoundSendError: RLS refusal vs everything else", () => {
  assert.equal(classifyRoundSendError({ code: "42501", message: "new row violates row-level security policy" }), "rejected");
  assert.equal(classifyRoundSendError({ code: "", message: "TypeError: Failed to fetch" }), "network");
  assert.equal(classifyRoundSendError(new Error("timeout")), "network");
  assert.equal(classifyRoundSendError(null), "network");
});

// --- read / post access -----------------------------------------------------

const access = (patch: Partial<RoundChatAccessInput>) =>
  roundChatAccess({ exists: true, status: "open", isHost: false, isJoined: true, hasLeft: false, blockedWithHost: false, ...patch });

test("access: members of an open/full round can read and post", () => {
  assert.equal(access({}), "open");
  assert.equal(access({ status: "full" }), "open");
  assert.equal(access({ isHost: true, isJoined: true }), "open");
  assert.ok(canReadRoundChat("open") && canPostRoundChat("open"));
});

test("access: completed / cancelled rounds are read-only for members", () => {
  assert.equal(access({ status: "completed" }), "ended");
  assert.equal(access({ status: "cancelled" }), "cancelled");
  assert.equal(access({ isHost: true, status: "completed" }), "ended");
  for (const a of ["ended", "cancelled"] as const) {
    assert.equal(canReadRoundChat(a), true);
    assert.equal(canPostRoundChat(a), false);
  }
});

test("access: non-member, left, blocked and missing rounds see no messages", () => {
  assert.equal(access({ isJoined: false }), "locked");
  assert.equal(access({ isJoined: false, hasLeft: true }), "left");
  assert.equal(access({ isJoined: false, hasLeft: true, status: "completed" }), "left");
  assert.equal(access({ blockedWithHost: true }), "blocked");
  assert.equal(access({ blockedWithHost: true, status: "completed" }), "blocked");
  assert.equal(access({ isJoined: false, blockedWithHost: true }), "blocked");
  assert.equal(access({ exists: false }), "unavailable");
  for (const a of ["locked", "left", "blocked", "unavailable"] as const) {
    assert.equal(canReadRoundChat(a), false);
    assert.equal(canPostRoundChat(a), false);
  }
});

test("access: the host is never 'blocked' from their own round", () => {
  assert.equal(access({ isHost: true, blockedWithHost: true }), "open");
});
