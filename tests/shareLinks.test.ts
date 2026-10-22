// Run: npm run test:onboarding  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAppShare, buildRoundShare, cleanShareField, isShareableRoundId, roundShareUrl, shareOrigin } from "../src/lib/shareLinks.ts";

const ID = "3f1c2a9e-8b7d-4c6e-9a51-0d2e4f6a8b10";
const TEMPLATES = { title: "Join my round on GolfMe", text: "Join my round at {course} on {date}, {time}." };

test("round share carries only course, date, time and the round link", () => {
  // A caller might hand over a whole round object; nothing beyond the four
  // named fields may reach the message or the URL.
  const round = {
    id: ID,
    course: "Dyker Beach Golf Course",
    dateLabel: "Sat, Oct 25",
    timeLabel: "8:30 AM",
    hostId: "11be6983-7cd6-434d-bb52-6bfaf1d6e309",
    hostName: "Micky Lyu",
    joinedGolferIds: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
    participants: [{ name: "Jordan Smith", email: "jordan@example.com" }],
    notes: "Call me at 555-0100",
  };
  const share = buildRoundShare(round, TEMPLATES, "https://golfme.app");
  assert.equal(share.url, `https://golfme.app/golf-calls/${ID}`);
  assert.equal(share.text, "Join my round at Dyker Beach Golf Course on Sat, Oct 25, 8:30 AM.");
  assert.equal(share.title, "Join my round on GolfMe");
  const everything = JSON.stringify(share);
  for (const secret of ["Micky", "Jordan", "example.com", "@", "555-0100", round.hostId, round.joinedGolferIds[0]]) {
    assert.equal(everything.includes(secret), false, `leaked ${secret}`);
  }
  // The only id anywhere is the round's own.
  const ids = everything.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  assert.deepEqual([...new Set(ids)], [ID]);
});

test("host-typed course names can't inject extra lines or run on forever", () => {
  assert.equal(cleanShareField("Dyker\n\nBeach   GC"), "Dyker Beach GC");
  const long = cleanShareField("x".repeat(200));
  assert.equal(long.length, 80);
  assert.ok(long.endsWith("…"));
  const share = buildRoundShare({ id: ID, course: "A\nB", dateLabel: "Sat", timeLabel: "8 AM" }, TEMPLATES, "https://golfme.app");
  assert.equal(share.text.includes("\n"), false);
});

test("link uses the canonical origin outside a real web origin", () => {
  assert.equal(shareOrigin("https://golfme.app"), "https://golfme.app");
  assert.equal(shareOrigin("http://127.0.0.1:5173"), "http://127.0.0.1:5173");
  assert.equal(shareOrigin("capacitor://localhost"), "https://golfme.app");
  assert.equal(shareOrigin("null"), "https://golfme.app");
  assert.equal(shareOrigin(undefined), "https://golfme.app");
  assert.equal(roundShareUrl(ID, "https://golfme.app"), `https://golfme.app/golf-calls/${ID}`);
});

test("only real round ids are shareable", () => {
  assert.equal(isShareableRoundId(ID), true);
  assert.equal(isShareableRoundId("mock-call-1"), false); // demo data ids
  assert.equal(isShareableRoundId(`${ID}/../admin`), false);
});

test("app share is just the pitch and the site", () => {
  const share = buildAppShare({ title: "GolfMe", text: "Find golf partners and rounds near you on GolfMe." }, "https://golfme.app");
  assert.deepEqual(share, { title: "GolfMe", text: "Find golf partners and rounds near you on GolfMe.", url: "https://golfme.app/" });
});
