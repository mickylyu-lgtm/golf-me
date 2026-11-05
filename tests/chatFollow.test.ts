// Run: npm run test:chat  (node --test, built-in type stripping)
// What DM and round chat do when messages arrive (lib/chatScroll.ts), and
// the DM thread's first-frame guarantees (Micky, 2026-11-04/05: opening a
// chat from a notification jumped; sending while reading older messages
// left the new message off-screen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { followNewMessages, messagesAfter } from "../src/lib/chatScroll.ts";

const msgs = [
  { id: "a", senderId: "me" },
  { id: "b", senderId: "them" },
  { id: "c", senderId: "them" },
];

test("messagesAfter: only what came after the last one handled", () => {
  assert.deepEqual(messagesAfter(msgs, "a").map((m) => m.id), ["b", "c"]);
  assert.deepEqual(messagesAfter(msgs, "c"), []);
  assert.deepEqual(messagesAfter(msgs, null), [], "first load: nothing is 'new'");
  assert.deepEqual(messagesAfter(msgs, "gone"), [], "history cleared / thread switched: nothing is 'new'");
});

test("my own message always pins, even while reading older messages", () => {
  assert.deepEqual(followNewMessages({ added: [{ senderId: "me" }], selfId: "me", nearBottom: false }), { pin: true, unseen: 0 });
  assert.deepEqual(followNewMessages({ added: [{ senderId: "them" }, { senderId: "me" }], selfId: "me", nearBottom: false }), { pin: true, unseen: 0 });
});

test("incoming: pin near the bottom, otherwise count for the pill", () => {
  assert.deepEqual(followNewMessages({ added: [{ senderId: "them" }], selfId: "me", nearBottom: true }), { pin: true, unseen: 0 });
  assert.deepEqual(followNewMessages({ added: [{ senderId: "them" }, { senderId: "them" }], selfId: "me", nearBottom: false }), { pin: false, unseen: 2 });
  assert.deepEqual(followNewMessages({ added: [{ senderId: "system", system: true }], selfId: "me", nearBottom: false }), { pin: false, unseen: 0 }, "system notes don't raise the pill");
  assert.deepEqual(followNewMessages({ added: [], selfId: "me", nearBottom: false }), { pin: false, unseen: 0 });
});

const dm = readFileSync(new URL("../src/pages/DirectMessageThread.tsx", import.meta.url), "utf8");
const box = readFileSync(new URL("../src/lib/useChatViewportBox.ts", import.meta.url), "utf8");

test("DM thread: box measured and page locked before the first paint", () => {
  // Route changes are transitions, so a passive effect paints one unsized,
  // unpinned frame first (the notification "jump").
  assert.match(dm, /useLayoutEffect\(\(\) => \{\s*const measure = \(\) => setBoxTop/, "boxTop measured in a layout effect");
  assert.match(dm, /useLayoutEffect\(\(\) => lockPageScroll\(\), \[\]\)/, "page locked in a layout effect");
  assert.match(dm, /\}, \[boxTop\]\);/, "re-pinned in the frame the box gets its height");
  // Opened before the golfer's profile loaded: the mount effects must run
  // again once the box exists.
  assert.match(dm, /\}, \[hasThread\]\);/);
});

test("round chat page shares the DM layout: measured before paint, locked, no window scrolling", () => {
  assert.match(box, /useLayoutEffect\(\(\) => \(enabled \? lockPageScroll\(\) : undefined\), \[enabled\]\)/);
  assert.equal(/scrollIntoView|scrollBy\(/.test(box), false);
});
