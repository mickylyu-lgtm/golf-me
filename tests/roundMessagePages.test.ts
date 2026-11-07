// Run: node --test tests/roundMessagePages.test.ts  (also in npm run test:roundchat)
// Round chat message loading (lib/roundMessagePages.ts, used by
// context/RealRoundsContext.tsx): newest-first bounded window, per-round
// newest page with a keyset cursor, merge by id with a (created_at, id)
// order, and the store's guards for stale / switched / closed rounds.
//
// The "server" below is an in-memory round_messages table that applies a
// query the way PostgREST does for the shapes the app sends (eq round_id,
// order created_at + id, limit, the keyset `or`), plus a max-rows CAP that
// truncates every response like PostgREST's db-max-rows. The live cap is
// not known; CAP here is a small stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROUND_MESSAGE_PAGE,
  ROUND_MESSAGE_WINDOW,
  compareRoundMessages,
  createRoundMessageStore,
  isBeforeCursor,
  isHistoryCut,
  mergeRoundMessageRows,
  olderPageCursor,
  roundMessagesBefore,
  type RoundMessageCursor,
} from "../src/lib/roundMessagePages.ts";

interface Row {
  id: string;
  round_id: string;
  created_at: string;
  text: string;
}

const CAP = 25;

function ts(second: number, micros = 0): string {
  const base = new Date(Date.UTC(2026, 10, 6, 10, 0, 0) + second * 1000).toISOString().slice(0, 19);
  // PostgREST-style: +00:00, microseconds with trailing zeros dropped.
  const frac = micros ? `.${String(micros).padStart(6, "0").replace(/0+$/, "")}` : "";
  return `${base}${frac}+00:00`;
}

function table(cap = CAP) {
  const rows: Row[] = [];
  let n = 0;
  function matching(opts: { round?: string; before?: RoundMessageCursor }): Row[] {
    return rows
      .filter((r) => (opts.round ? r.round_id === opts.round : true))
      .filter((r) => (opts.before ? isBeforeCursor(r, opts.before) : true));
  }
  return {
    rows,
    insert(round: string, second: number, micros = 0, id?: string): Row {
      const row = { id: id ?? `m${String(++n).padStart(4, "0")}`, round_id: round, created_at: ts(second, micros), text: `t${n}` };
      rows.push(row);
      return row;
    },
    /** The old global query: oldest first, no limit (the cap still applies). */
    oldGlobal(): Row[] {
      return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, cap);
    },
    /** order created_at desc, id desc, limit; optional round and cursor. */
    newestFirst(limit: number, opts: { round?: string; before?: RoundMessageCursor } = {}): Row[] {
      return matching(opts)
        .sort((a, b) => -compareRoundMessages(a, b))
        .slice(0, Math.min(limit, cap));
    },
    /** count: "exact": the total matching the filter, ignoring limit and cap (Content-Range). */
    count(opts: { round?: string } = {}): number {
      return matching(opts).length;
    },
  };
}

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

test("constants: the window and the page are explicit limits (not the server's cap)", () => {
  assert.ok(ROUND_MESSAGE_WINDOW > 0 && ROUND_MESSAGE_PAGE > 0 && ROUND_MESSAGE_PAGE <= ROUND_MESSAGE_WINDOW);
});

test("history longer than the cap: the old oldest-first query misses the newest; the new window holds them", () => {
  const db = table();
  for (let i = 0; i < 60; i++) db.insert("R", i);
  const newest = db.rows[59];
  assert.ok(!ids(db.oldGlobal()).includes(newest.id), "old query shape: the newest message is cut off");
  const store = createRoundMessageStore<Row>();
  store.setWindow(db.newestFirst(ROUND_MESSAGE_WINDOW));
  const held = store.rows();
  assert.equal(held.length, CAP);
  assert.equal(held[held.length - 1].id, newest.id, "newest is last (chronological)");
  assert.deepEqual(ids(held), ids(db.rows.slice(60 - CAP)), "exactly the newest CAP, in order");
});

test("older pages by keyset walk the whole history once: no gaps, no duplicates (shared timestamps at page edges)", () => {
  const db = table();
  // Many rows sharing a second, some sharing the exact microsecond.
  for (let i = 0; i < 70; i++) db.insert("R", Math.floor(i / 7), (i % 3) * 100);
  const seen: Row[] = [];
  let page = db.newestFirst(10, { round: "R" });
  while (page.length > 0) {
    seen.push(...page);
    const cursor = olderPageCursor(page);
    assert.ok(cursor);
    page = db.newestFirst(10, { round: "R", before: cursor });
  }
  assert.equal(seen.length, 70);
  assert.equal(new Set(ids(seen)).size, 70);
  assert.deepEqual(ids(mergeRoundMessageRows([seen])), ids([...db.rows].sort(compareRoundMessages)));
});

test("rows inserted between page requests don't shift older pages", () => {
  const db = table();
  for (let i = 0; i < 30; i++) db.insert("R", i);
  const first = db.newestFirst(10, { round: "R" });
  for (let i = 0; i < 5; i++) db.insert("R", 100 + i); // arrive meanwhile
  const second = db.newestFirst(10, { round: "R", before: olderPageCursor(first)! });
  assert.deepEqual(ids(second), ids(db.rows.slice(10, 20).reverse()));
  assert.equal(ids(first).filter((id) => ids(second).includes(id)).length, 0);
});

test("equal timestamps have one order (id tie-breaker), whichever order rows arrive in", () => {
  const db = table();
  const a = db.insert("R", 5, 0, "b-row");
  const b = db.insert("R", 5, 0, "a-row");
  const c = db.insert("R", 5, 10, "c-row");
  assert.deepEqual(ids(mergeRoundMessageRows([[c, a, b]])), ["a-row", "b-row", "c-row"]);
  assert.deepEqual(ids(mergeRoundMessageRows([[b], [c, a]])), ["a-row", "b-row", "c-row"]);
});

test("timestamp text order matches time order (whole seconds, fractions, microseconds)", () => {
  const order = [ts(1), ts(1, 1), ts(1, 100000), ts(1, 120000), ts(1, 999999), ts(2)];
  const shuffled = [order[3], order[0], order[5], order[2], order[4], order[1]];
  const rows = shuffled.map((created_at, i) => ({ id: `x${i}`, round_id: "R", created_at }));
  assert.deepEqual(
    mergeRoundMessageRows([rows]).map((r) => r.created_at),
    order,
  );
});

test("keyset filter string mirrors isBeforeCursor and quotes its values", () => {
  const cursor = { createdAt: ts(3, 5), id: "7c9e6679-7425-40de-944b-e07fc1f90ae7" };
  assert.equal(
    roundMessagesBefore(cursor),
    `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
  );
  const row = (created_at: string, id: string) => ({ id, round_id: "R", created_at });
  assert.equal(isBeforeCursor(row(ts(3, 4), "z"), cursor), true);
  assert.equal(isBeforeCursor(row(ts(3, 5), "0"), cursor), true);
  assert.equal(isBeforeCursor(row(ts(3, 5), cursor.id), cursor), false);
  assert.equal(isBeforeCursor(row(ts(3, 6), "0"), cursor), false);
  assert.equal(olderPageCursor([]), null);
});

test("a quiet round pushed out of the shared window still shows its newest via its own page", () => {
  const db = table();
  for (let i = 0; i < 10; i++) db.insert("QUIET", i);
  for (let i = 0; i < 60; i++) db.insert("BUSY", 100 + i);
  const store = createRoundMessageStore<Row>();
  store.setWindow(db.newestFirst(ROUND_MESSAGE_WINDOW));
  assert.equal(store.rows().filter((r) => r.round_id === "QUIET").length, 0);
  const { first } = store.watch("QUIET");
  assert.equal(first, true);
  const token = store.beginPage("QUIET");
  assert.equal(store.acceptPage("QUIET", token, db.newestFirst(ROUND_MESSAGE_PAGE, { round: "QUIET" })), true);
  assert.deepEqual(
    ids(store.rows().filter((r) => r.round_id === "QUIET")),
    ids(db.rows.filter((r) => r.round_id === "QUIET")),
  );
});

test("window and page overlap: each row held once; the window's copy (refreshed first) wins", () => {
  const db = table();
  for (let i = 0; i < 5; i++) db.insert("R", i);
  const store = createRoundMessageStore<Row>();
  store.watch("R");
  store.acceptPage("R", store.beginPage("R"), db.newestFirst(10, { round: "R" }));
  const edited = db.newestFirst(10).map((r) => (r.id === "m0003" ? { ...r, text: "" } : r));
  store.setWindow(edited);
  const held = store.rows();
  assert.equal(held.length, 5);
  assert.equal(held.find((r) => r.id === "m0003")?.text, "");
});

test("insert during the initial fetch / duplicate or out-of-order realtime refetches: no duplicates, newest kept", () => {
  const db = table();
  for (let i = 0; i < 5; i++) db.insert("R", i);
  const store = createRoundMessageStore<Row>();
  const early = db.newestFirst(ROUND_MESSAGE_WINDOW); // initial fetch's snapshot
  db.insert("R", 10); // insert lands mid-fetch; realtime queues a follow-up refetch
  const late = db.newestFirst(ROUND_MESSAGE_WINDOW);
  store.setWindow(early);
  store.setWindow(late);
  assert.equal(store.rows().length, 6);
  // The same event delivered twice (two refetches with the same rows).
  store.setWindow(late);
  assert.equal(store.rows().length, 6);
  // Pages: the latest request wins even when an older response lands last.
  store.watch("R");
  const t1 = store.beginPage("R");
  const t2 = store.beginPage("R");
  const newer = db.newestFirst(10, { round: "R" });
  assert.equal(store.acceptPage("R", t2, newer), true);
  assert.equal(store.acceptPage("R", t1, newer.slice(1)), false, "the older response is dropped");
  assert.equal(new Set(ids(store.rows())).size, store.rows().length);
});

test("reconnect catch-up: a refetch after a missed event brings the gap in", () => {
  const db = table();
  for (let i = 0; i < 5; i++) db.insert("R", i);
  const store = createRoundMessageStore<Row>();
  store.setWindow(db.newestFirst(ROUND_MESSAGE_WINDOW));
  db.insert("R", 20); // missed while disconnected
  db.insert("R", 21);
  store.setWindow(db.newestFirst(ROUND_MESSAGE_WINDOW)); // the SUBSCRIBED-again refetch
  assert.deepEqual(ids(store.rows()).slice(-2), ["m0006", "m0007"]);
});

test("switching rounds while a page is pending: the closed round's late page is dropped, nothing leaks", () => {
  const db = table();
  for (let i = 0; i < 5; i++) db.insert("A", i);
  for (let i = 0; i < 5; i++) db.insert("B", 10 + i);
  const store = createRoundMessageStore<Row>();
  const a = store.watch("A");
  const tA = store.beginPage("A");
  a.unwatch(); // user switched to B
  const b = store.watch("B");
  const tB = store.beginPage("B");
  assert.equal(store.acceptPage("B", tB, db.newestFirst(10, { round: "B" })), true);
  assert.equal(store.acceptPage("A", tA, db.newestFirst(10, { round: "A" })), false);
  assert.deepEqual(new Set(store.rows().map((r) => r.round_id)), new Set(["B"]));
  // A page answer carrying another round's rows keeps only its own round's.
  assert.equal(store.acceptPage("B", store.beginPage("B"), db.newestFirst(10)), true);
  assert.deepEqual(new Set(store.rows().map((r) => r.round_id)), new Set(["B"]));
  // A -> B -> A: the first visit's request is stale for the second visit.
  const a2 = store.watch("A");
  assert.equal(store.acceptPage("A", tA, db.newestFirst(10, { round: "A" })), false);
  assert.equal(a2.first, true);
  b.unwatch();
});

test("two open views of one round: closing one keeps the page; unwatch twice is a no-op", () => {
  const db = table();
  db.insert("R", 1);
  const store = createRoundMessageStore<Row>();
  const v1 = store.watch("R");
  const v2 = store.watch("R");
  assert.equal(v2.first, false);
  store.acceptPage("R", store.beginPage("R"), db.newestFirst(10, { round: "R" }));
  assert.equal(v1.unwatch(), false);
  assert.equal(v1.unwatch(), false);
  assert.equal(store.rows().length, 1);
  assert.equal(v2.unwatch(), true, "last view closed: its page goes");
  assert.equal(store.rows().length, 0);
  assert.deepEqual(store.watched(), []);
});

test("account reset: no rows carry over and an in-flight page goes stale; open chats stay watched", () => {
  const db = table();
  db.insert("R", 1);
  const store = createRoundMessageStore<Row>();
  store.setWindow(db.newestFirst(10));
  store.watch("R");
  const token = store.beginPage("R");
  store.reset();
  assert.deepEqual(store.rows(), []);
  assert.equal(store.acceptPage("R", token, db.newestFirst(10, { round: "R" })), false);
  assert.deepEqual(store.watched(), ["R"]);
});

test("patch applies to every source (a local unsend can't be undone by a page landing later)", () => {
  const db = table();
  db.insert("R", 1);
  const store = createRoundMessageStore<Row>();
  store.setWindow(db.newestFirst(10));
  store.watch("R");
  store.acceptPage("R", store.beginPage("R"), db.newestFirst(10, { round: "R" }));
  store.patch((rows) => rows.map((r) => ({ ...r, text: "" })));
  store.setWindow([]); // window no longer has it; the page copy must be wiped too
  assert.equal(store.rows()[0].text, "");
});

test("empty history, a single page, and an exact page boundary", () => {
  const empty = table();
  const store = createRoundMessageStore<Row>();
  store.setWindow(empty.newestFirst(ROUND_MESSAGE_WINDOW));
  assert.deepEqual(store.rows(), []);

  const one = table();
  for (let i = 0; i < 4; i++) one.insert("R", i);
  const page = one.newestFirst(10, { round: "R" });
  assert.equal(page.length, 4);
  assert.deepEqual(one.newestFirst(10, { round: "R", before: olderPageCursor(page)! }), []);

  const exact = table();
  for (let i = 0; i < 10; i++) exact.insert("R", i);
  const full = exact.newestFirst(10, { round: "R" });
  assert.equal(full.length, 10);
  assert.deepEqual(exact.newestFirst(10, { round: "R", before: olderPageCursor(full)! }), [], "next page after an exact boundary is empty");
});

// ------------------------------------------------ "is truncated" rule (Micky: say when the limit is reached)

test("isHistoryCut: with the exact total, held < total; an exactly complete history is not cut", () => {
  assert.equal(isHistoryCut({ held: 200, total: 200, fetched: 200, limit: 200 }), false, "exactly full page, nothing more");
  assert.equal(isHistoryCut({ held: 200, total: 201, fetched: 200, limit: 200 }), true);
  assert.equal(isHistoryCut({ held: 199, total: 199, fetched: 199, limit: 200 }), false);
  assert.equal(isHistoryCut({ held: 0, total: 0, fetched: 0, limit: 200 }), false);
});

test("isHistoryCut without a total: an exactly full response may have more; one short of full is complete", () => {
  assert.equal(isHistoryCut({ held: 200, total: null, fetched: 200, limit: ROUND_MESSAGE_PAGE }), true);
  assert.equal(isHistoryCut({ held: 199, total: null, fetched: 199, limit: ROUND_MESSAGE_PAGE }), false);
  // The DM window (RealSocialContext MESSAGE_WINDOW = 1000) uses the same rule on its full refresh.
  assert.equal(isHistoryCut({ held: 1000, total: null, fetched: 1000, limit: 1000 }), true);
  assert.equal(isHistoryCut({ held: 999, total: null, fetched: 999, limit: 1000 }), false);
  assert.equal(isHistoryCut({ held: 1000, total: 1000, fetched: 1000, limit: 1000 }), false, "full window, exact total says nothing more");
  assert.equal(isHistoryCut({ held: 1000, total: 4321, fetched: 1000, limit: 1000 }), true);
});

test("isHistoryCut: a server cap below the limit is caught only by the total", () => {
  assert.equal(isHistoryCut({ held: 50, total: 300, fetched: 50, limit: 200 }), true);
  assert.equal(isHistoryCut({ held: 50, total: null, fetched: 50, limit: 200 }), false, "no total: a capped response looks complete (why the app asks for count)");
});

function loadPage(store: ReturnType<typeof createRoundMessageStore<Row>>, db: ReturnType<typeof table>, round: string, withCount = true) {
  const token = store.beginPage(round);
  return store.acceptPage(round, token, db.newestFirst(ROUND_MESSAGE_PAGE, { round }), withCount ? db.count({ round }) : null);
}

test("round historyCut: exactly full page vs one short, with and without the count; false before the page loads", () => {
  const exact = table(1000);
  for (let i = 0; i < ROUND_MESSAGE_PAGE; i++) exact.insert("R", i);
  const store = createRoundMessageStore<Row>();
  store.watch("R");
  assert.deepEqual(store.historyCut("R"), { cut: false, held: 0 }, "no page yet: no notice (no flicker)");
  loadPage(store, exact, "R");
  assert.deepEqual(store.historyCut("R"), { cut: false, held: ROUND_MESSAGE_PAGE });
  loadPage(store, exact, "R", false);
  assert.equal(store.historyCut("R").cut, true, "no total + exactly full page: may have more");

  exact.insert("R", 10_000);
  loadPage(store, exact, "R");
  assert.deepEqual(store.historyCut("R"), { cut: true, held: ROUND_MESSAGE_PAGE }, "one more than a page exists");

  const short = table(1000);
  for (let i = 0; i < ROUND_MESSAGE_PAGE - 1; i++) short.insert("S", i);
  const s2 = createRoundMessageStore<Row>();
  s2.watch("S");
  loadPage(s2, short, "S", false);
  assert.deepEqual(s2.historyCut("S"), { cut: false, held: ROUND_MESSAGE_PAGE - 1 });
});

test("round historyCut counts window and page together (each row once)", () => {
  const db = table(1000);
  for (let i = 0; i < 260; i++) db.insert("R", i);
  const store = createRoundMessageStore<Row>();
  store.setWindow(db.newestFirst(ROUND_MESSAGE_WINDOW)); // the window holds all 260
  store.watch("R");
  loadPage(store, db, "R");
  assert.deepEqual(store.historyCut("R"), { cut: false, held: 260 }, "page is full but the window has the rest");
  store.reset();
  assert.deepEqual(store.historyCut("R"), { cut: false, held: 0 });
});

// ------------------------------------------------ a server cap BELOW the requested page and window sizes

test("cap 50 < page 200 < window 1000: busy rounds fill the window, the open round's newest are still all held", () => {
  const db = table(50);
  for (let i = 0; i < 120; i++) db.insert("R", i * 10); // the open round, older activity
  for (const busy of ["B1", "B2", "B3"]) for (let i = 0; i < 150; i++) db.insert(busy, 2000 + i);
  const store = createRoundMessageStore<Row>();
  store.setWindow(db.newestFirst(ROUND_MESSAGE_WINDOW));
  assert.equal(store.rows().length, 50);
  assert.equal(store.rows().filter((r) => r.round_id === "R").length, 0, "the open round is outside the capped window");
  store.watch("R");
  loadPage(store, db, "R");
  const held = store.rows().filter((r) => r.round_id === "R");
  const newestR = db.rows.filter((r) => r.round_id === "R").slice(-50);
  assert.deepEqual(ids(held), ids(newestR), "newest-first then reversed: exactly R's newest 50, oldest to newest");
  assert.equal(held[held.length - 1].id, newestR[newestR.length - 1].id);
  assert.deepEqual(store.historyCut("R"), { cut: true, held: 50 }, "and the thread says it shows only the latest");
  // The global newest is held too.
  const all = store.rows();
  assert.equal(all[all.length - 1].id, [...db.rows].sort(compareRoundMessages).at(-1)!.id);
});

test("cap 50: realtime inserts in several rounds during and after the initial fetch never lose the open round's newest", () => {
  const db = table(50);
  for (let i = 0; i < 80; i++) db.insert("R", i);
  for (let i = 0; i < 80; i++) db.insert("B", 100 + i);
  const store = createRoundMessageStore<Row>();
  store.watch("R");
  const tokenEarly = store.beginPage("R");
  const windowEarly = db.newestFirst(ROUND_MESSAGE_WINDOW);
  const pageEarly = db.newestFirst(ROUND_MESSAGE_PAGE, { round: "R" });
  const countEarly = db.count({ round: "R" });
  // Inserts land while the initial fetch is in flight, in R and B.
  db.insert("R", 500);
  db.insert("B", 501);
  db.insert("R", 502);
  store.setWindow(windowEarly);
  store.acceptPage("R", tokenEarly, pageEarly, countEarly);
  // Realtime: the follow-up refetch (window + R's page).
  store.setWindow(db.newestFirst(ROUND_MESSAGE_WINDOW));
  loadPage(store, db, "R");
  // More after: busy round floods the window.
  for (let i = 0; i < 60; i++) db.insert("B", 600 + i);
  db.insert("R", 700);
  store.setWindow(db.newestFirst(ROUND_MESSAGE_WINDOW));
  loadPage(store, db, "R");
  const held = store.rows().filter((r) => r.round_id === "R");
  assert.deepEqual(ids(held.slice(-50)), ids(db.rows.filter((r) => r.round_id === "R").slice(-50)));
  assert.equal(new Set(ids(store.rows())).size, store.rows().length, "no duplicates");
  const sorted = [...store.rows()].sort(compareRoundMessages);
  assert.deepEqual(ids(store.rows()), ids(sorted), "chronological");
});

test("cap 50: after switching rounds, the new round's newest are held and the old round's late page is dropped", () => {
  const db = table(50);
  for (let i = 0; i < 90; i++) db.insert("R", i);
  for (let i = 0; i < 90; i++) db.insert("S", 1000 + i);
  for (let i = 0; i < 90; i++) db.insert("B", 3000 + i);
  const store = createRoundMessageStore<Row>();
  const r = store.watch("R");
  const late = store.beginPage("R");
  const rPage = db.newestFirst(ROUND_MESSAGE_PAGE, { round: "R" });
  r.unwatch();
  store.watch("S");
  store.setWindow(db.newestFirst(ROUND_MESSAGE_WINDOW));
  loadPage(store, db, "S");
  db.insert("S", 9000); // realtime after the switch
  store.setWindow(db.newestFirst(ROUND_MESSAGE_WINDOW));
  loadPage(store, db, "S");
  assert.equal(store.acceptPage("R", late, rPage, 90), false);
  assert.equal(store.rows().some((x) => x.round_id === "R"), false);
  assert.deepEqual(
    ids(store.rows().filter((x) => x.round_id === "S")),
    ids(db.rows.filter((x) => x.round_id === "S").slice(-50)),
  );
  assert.deepEqual(store.historyCut("S"), { cut: true, held: 50 });
});

test("cap = window = 1000 (live max_rows, confirmed by Micky 2026-11-06): the exact boundary", () => {
  const db = table(1000);
  for (let i = 0; i < 1000; i++) db.insert(i % 2 ? "B" : "R", i); // the oldest row is R's
  const window = db.newestFirst(ROUND_MESSAGE_WINDOW);
  assert.equal(window.length, ROUND_MESSAGE_WINDOW);
  // Exactly 1000 exist: complete with the total; without it, a full window "may have more".
  assert.equal(isHistoryCut({ held: window.length, total: db.count(), fetched: window.length, limit: ROUND_MESSAGE_WINDOW }), false);
  assert.equal(isHistoryCut({ held: window.length, total: null, fetched: window.length, limit: ROUND_MESSAGE_WINDOW }), true);
  // One more: still 1000 back (newest), the total says cut, and the oldest is the one left out.
  const newest = db.insert("R", 5000);
  const after = db.newestFirst(ROUND_MESSAGE_WINDOW);
  assert.equal(after.length, ROUND_MESSAGE_WINDOW);
  assert.equal(isHistoryCut({ held: after.length, total: db.count(), fetched: after.length, limit: ROUND_MESSAGE_WINDOW }), true);
  const store = createRoundMessageStore<Row>();
  store.setWindow(after);
  assert.equal(store.rows().at(-1)!.id, newest.id);
  assert.equal(store.rows().some((r) => r.id === db.rows[0].id), false, "the very oldest is the one cut");
  // The per-round page (200) is under the cap, so it returns its full page and the count decides.
  store.watch("R");
  loadPage(store, db, "R");
  assert.deepEqual(store.historyCut("R"), { cut: true, held: db.count({ round: "R" }) - 1 }, "R has 501; 500 held via window + page");
});
