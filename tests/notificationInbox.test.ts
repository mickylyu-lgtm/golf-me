// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EARLIER_LIMIT,
  EARLIER_MAX_AGE_MS,
  groupNotifications,
  linkPath,
  notificationBadgeKind,
  notificationIdsClearedByRoute,
  pathsOpenedByRoute,
  resolveNotificationActor,
  withLocallyRead,
} from "../src/lib/notificationInbox.ts";
import type { ActorLookup, InboxNotification } from "../src/lib/notificationInbox.ts";

let seq = 0;
function n(partial: Partial<InboxNotification> & Pick<InboxNotification, "type" | "linkTo">): InboxNotification {
  seq += 1;
  return { id: `n${seq}`, read: false, createdAt: new Date(Date.UTC(2026, 10, 5, 12, 0, seq)).toISOString(), ...partial };
}

// ---- grouping ----

// The fixtures are dated 2026-11-05; grouping is judged "now" on that day
// so Earlier's age cut-off never depends on when the tests run.
const NOW = Date.parse("2026-11-05T13:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

test("unread rows are the list, read rows go to Earlier, both newest first", () => {
  const a = n({ type: "new_message", linkTo: "/messages/g1", createdAt: "2026-11-05T10:00:00Z" });
  const b = n({ type: "round_joined", linkTo: "/golf-calls/r1", read: true, createdAt: "2026-11-05T11:00:00Z" });
  const c = n({ type: "new_follower", linkTo: "/golfer/g2", createdAt: "2026-11-05T12:00:00Z" });
  const d = n({ type: "post_reply", linkTo: "/community/p1", read: true, createdAt: "2026-11-05T09:00:00Z" });
  const { unread, earlier } = groupNotifications([a, b, c, d], EARLIER_LIMIT, NOW);
  assert.deepEqual(unread.map((x) => x.id), [c.id, a.id]);
  assert.deepEqual(earlier.map((x) => x.id), [b.id, d.id]);
});

test("a tapped (now read) notification leaves the main list", () => {
  const a = n({ type: "new_message", linkTo: "/messages/g1" });
  const before = groupNotifications([a], EARLIER_LIMIT, NOW);
  assert.equal(before.unread.length, 1);
  const after = groupNotifications(withLocallyRead([a], new Set([a.id])), EARLIER_LIMIT, NOW);
  assert.equal(after.unread.length, 0);
  assert.equal(after.earlier.length, 1);
});

test("Earlier is capped; nothing unread is ever cut", () => {
  const rows = Array.from({ length: EARLIER_LIMIT + 20 }, () => n({ type: "round_left", linkTo: "/golf-calls/x", read: true }));
  rows.push(...Array.from({ length: 70 }, () => n({ type: "new_message", linkTo: "/messages/y" })));
  const { unread, earlier } = groupNotifications(rows, EARLIER_LIMIT, NOW);
  assert.equal(unread.length, 70);
  assert.equal(earlier.length, EARLIER_LIMIT);
  assert.equal(groupNotifications(rows, 0, NOW).earlier.length, 0);
});

test("Earlier only keeps a few days of read rows; unread rows never age out", () => {
  const fresh = n({ type: "round_joined", linkTo: "/golf-calls/r1", read: true, createdAt: new Date(NOW - 2 * DAY).toISOString() });
  const stale = n({ type: "round_joined", linkTo: "/golf-calls/r2", read: true, createdAt: new Date(NOW - EARLIER_MAX_AGE_MS - 1).toISOString() });
  const edge = n({ type: "round_joined", linkTo: "/golf-calls/r3", read: true, createdAt: new Date(NOW - EARLIER_MAX_AGE_MS).toISOString() });
  const oldUnread = n({ type: "new_message", linkTo: "/messages/g1", createdAt: new Date(NOW - 30 * DAY).toISOString() });
  const { unread, earlier } = groupNotifications([fresh, stale, edge, oldUnread], EARLIER_LIMIT, NOW);
  assert.deepEqual(earlier.map((x) => x.id), [fresh.id, edge.id]);
  assert.deepEqual(unread.map((x) => x.id), [oldUnread.id]);
});

test("grouping does not mutate the input order", () => {
  const rows = [n({ type: "a", linkTo: "/x", createdAt: "2026-01-01T00:00:00Z" }), n({ type: "b", linkTo: "/y", createdAt: "2026-02-01T00:00:00Z" })];
  const ids = rows.map((r) => r.id);
  groupNotifications(rows);
  assert.deepEqual(rows.map((r) => r.id), ids);
});

// ---- local read overlay ----

test("withLocallyRead keeps the same array when nothing changes", () => {
  const rows = [n({ type: "new_message", linkTo: "/messages/g1", read: true })];
  assert.equal(withLocallyRead(rows, new Set()), rows);
  assert.equal(withLocallyRead(rows, new Set([rows[0].id])), rows, "already read");
  assert.equal(withLocallyRead(rows, new Set(["other"])), rows);
});

test("withLocallyRead flips only the listed unread rows", () => {
  const rows = [n({ type: "new_message", linkTo: "/messages/g1" }), n({ type: "new_message", linkTo: "/messages/g2" })];
  const out = withLocallyRead(rows, new Set([rows[1].id]));
  assert.equal(out[0], rows[0]);
  assert.equal(out[1].read, true);
  assert.equal(rows[1].read, false, "input untouched");
});

// ---- which notifications a screen clears ----

test("linkPath drops query, hash and trailing slashes", () => {
  assert.equal(linkPath("/golf-calls/r1?from=push#chat"), "/golf-calls/r1");
  assert.equal(linkPath("/messages/g1/"), "/messages/g1");
  assert.equal(linkPath("/"), "/");
  assert.equal(linkPath(""), "/");
});

test("opening a DM thread clears that golfer's message notifications only", () => {
  const fromG1 = n({ type: "new_message", actorId: "g1", linkTo: "/messages/g1" });
  const fromG1OddLink = n({ type: "new_message", actorId: "g1", linkTo: "/messages" });
  const fromG2 = n({ type: "new_message", actorId: "g2", linkTo: "/messages/g2" });
  const followFromG1 = n({ type: "new_follower", actorId: "g1", linkTo: "/golfer/g1" });
  const readFromG1 = n({ type: "new_message", actorId: "g1", linkTo: "/messages/g1", read: true });
  const ids = notificationIdsClearedByRoute("/messages/g1", [fromG1, fromG1OddLink, fromG2, followFromG1, readFromG1]);
  assert.deepEqual(ids, [fromG1.id, fromG1OddLink.id]);
});

test("opening a round clears that round's notifications, and its chat clears them too", () => {
  const joined = n({ type: "round_joined", actorId: "g1", linkTo: "/golf-calls/r1" });
  const tee = n({ type: "tee_time_updated", actorId: "g2", linkTo: "/golf-calls/r1?tab=details" });
  const nearby = n({ type: "new_round_nearby", linkTo: "/golf-calls/r1" });
  const other = n({ type: "round_joined", actorId: "g1", linkTo: "/golf-calls/r2" });
  const list = [joined, tee, nearby, other];
  assert.deepEqual(notificationIdsClearedByRoute("/golf-calls/r1", list), [joined.id, tee.id, nearby.id]);
  assert.deepEqual(notificationIdsClearedByRoute("/messages/round/r1", list), [joined.id, tee.id, nearby.id]);
  assert.deepEqual(notificationIdsClearedByRoute("/golf-calls/r2/", list), [other.id]);
});

test("post, Caddie analysis and profile screens clear what links to them", () => {
  const reply = n({ type: "post_reply", actorId: "g1", linkTo: "/community/p1" });
  const caddie = n({ type: "caddie_analysis_complete", linkTo: "/caddie/a1" });
  const follow = n({ type: "new_follower", actorId: "g3", linkTo: "/golfer/g3" });
  const list = [reply, caddie, follow];
  assert.deepEqual(notificationIdsClearedByRoute("/community/p1", list), [reply.id]);
  assert.deepEqual(notificationIdsClearedByRoute("/caddie/a1", list), [caddie.id]);
  assert.deepEqual(notificationIdsClearedByRoute("/golfer/g3", list), [follow.id]);
});

test("tabs, lists and non-id screens never clear anything", () => {
  const list = [
    n({ type: "new_message", actorId: "g1", linkTo: "/messages/g1" }),
    n({ type: "circle_post", actorId: "g1", linkTo: "/community" }),
    n({ type: "round_joined", linkTo: "/golf-calls/new" }),
    n({ type: "caddie_analysis_complete", linkTo: "/caddie/analyze" }),
  ];
  for (const path of ["/", "/messages", "/community", "/caddie", "/find", "/golf-calls/new", "/caddie/analyze", "/community/new", "/community/guidelines", "/messages/round", "/profile/following/find"]) {
    assert.deepEqual(notificationIdsClearedByRoute(path, list), [], path);
  }
  assert.deepEqual(pathsOpenedByRoute("/messages/round"), []);
});

// ---- actor resolution ----

interface P {
  id: string;
  name: string;
}
const profiles = new Map<string, P>([
  ["g1", { id: "g1", name: "Ana" }],
  ["host", { id: "host", name: "Host" }],
  ["blocked", { id: "blocked", name: "Blocked" }],
]);
function lookup(overrides: Partial<ActorLookup<P>> = {}): ActorLookup<P> {
  return {
    selfId: "me",
    getProfile: (id) => profiles.get(id),
    isBlockedEitherWay: (id) => id === "blocked",
    isListed: (id) => id === "host" || id === "g1",
    ...overrides,
  };
}

test("a known actor shows their avatar with photo", () => {
  assert.deepEqual(resolveNotificationActor({ type: "new_message", actorId: "g1" }, lookup()), {
    kind: "person",
    profile: profiles.get("g1"),
    showPhoto: true,
  });
});

test("system notifications and missing actors get the GolfMe icon", () => {
  assert.deepEqual(resolveNotificationActor({ type: "caddie_analysis_complete" }, lookup()), { kind: "system" });
  assert.deepEqual(resolveNotificationActor({ type: "caddie_analysis_complete", actorId: "g1" }, lookup()), { kind: "system" });
  assert.deepEqual(resolveNotificationActor({ type: "round_cancelled", actorId: undefined }, lookup()), { kind: "system" });
  assert.deepEqual(resolveNotificationActor({ type: "new_message", actorId: "deleted" }, lookup()), { kind: "system" }, "unresolvable");
  assert.deepEqual(resolveNotificationActor({ type: "new_message", actorId: "me" }, lookup()), { kind: "system" }, "never yourself");
});

test("a blocked actor never shows a photo", () => {
  const out = resolveNotificationActor({ type: "post_reply", actorId: "blocked" }, lookup());
  assert.equal(out.kind, "person");
  assert.equal(out.kind === "person" && out.showPhoto, false);
  // Usually the profile isn't even resolvable (golfer_public_profiles drops blocks).
  assert.deepEqual(resolveNotificationActor({ type: "post_reply", actorId: "blocked" }, lookup({ getProfile: () => undefined })), { kind: "system" });
});

test("new-round alerts: a cleared or hidden host shows no person", () => {
  assert.deepEqual(resolveNotificationActor({ type: "new_round_nearby" }, lookup()), { kind: "system" }, "actor_id cleared server-side");
  assert.deepEqual(
    resolveNotificationActor({ type: "new_round_nearby", actorId: "hidden" }, lookup({ getProfile: () => ({ id: "hidden", name: "Hidden" }) })),
    { kind: "system" },
    "not in the directory",
  );
  assert.equal(resolveNotificationActor({ type: "new_round_nearby", actorId: "host" }, lookup()).kind, "person");
  // The directory rule is only for new-round alerts: a hidden golfer you share a round with still shows.
  assert.equal(resolveNotificationActor({ type: "round_joined", actorId: "blocked" }, lookup({ isBlockedEitherWay: () => false })).kind, "person");
});

// ---- badge ----

test("every known type has a badge; unknown types fall back", () => {
  const known = [
    "post_reply",
    "comment_reply",
    "new_follower",
    "round_created_from_post",
    "post_became_round",
    "round_joined",
    "round_left",
    "round_cancelled",
    "new_message",
    "booking_proof_attached",
    "tee_time_updated",
    "booking_proof_removed",
    "caddie_analysis_complete",
    "new_round_nearby",
    "circle_post",
    "booking_status_changed",
    "booking_evidence_reviewed",
  ];
  for (const type of known) assert.notEqual(notificationBadgeKind(type), "other", type);
  assert.equal(notificationBadgeKind("booking_status_changed"), "booking");
  assert.equal(notificationBadgeKind("booking_evidence_reviewed"), "booking");
  assert.equal(notificationBadgeKind("new_message"), "message");
  assert.equal(notificationBadgeKind("caddie_analysis_complete"), "caddie");
  assert.equal(notificationBadgeKind("new_follower"), "follow");
  assert.equal(notificationBadgeKind("round_joined"), "round");
  assert.equal(notificationBadgeKind("something_new"), "other");
});