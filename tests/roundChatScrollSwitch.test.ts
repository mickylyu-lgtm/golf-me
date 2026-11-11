// Exercise GroupChat's actual layout-effect body against a small scroll-box
// model. This catches component wiring regressions without a DOM dependency;
// the existing chatFollow tests cover the shared message-follow helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { followNewMessages, isNearBottom, messagesAfter, pinToBottom } from "../src/lib/chatScroll.ts";

const source = readFileSync(new URL("../src/components/chat/GroupChat.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("GroupChat.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect: ts.CallExpression | undefined;
function findEffect(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useLayoutEffect"
      && node.arguments[0]?.getText(ast).includes("followNewMessages(")) effect = node;
  ts.forEachChild(node, findEffect);
}
findEffect(ast);
assert.ok(effect, "GroupChat keeps its message-follow layout effect");
const callback = effect.arguments[0] as ts.ArrowFunction;
assert.ok(ts.isBlock(callback.body));
const body = callback.body.statements.map((statement) => statement.getText(ast)).join("\n");
const runEffect = new Function(
  "callId", "messages", "lastMessageId", "currentUser", "listRef",
  "nearBottomRef", "lastSeenIdRef", "scrollCallIdRef", "setUnseenCount",
  "followNewMessages", "messagesAfter", "pinToBottom", body,
);

type Message = { id: string; clientId?: string; senderId: string; system?: boolean };
const history = (round: string, count = 40): Message[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${round}-${index}`, senderId: "them" }));

function chat() {
  let unseen = 0;
  let top = 0;
  const list = {
    scrollHeight: 0,
    clientHeight: 384,
    get scrollTop() { return top; },
    set scrollTop(value: number) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
  };
  const nearBottom = { current: true };
  const lastSeen = { current: null as string | null };
  const round = { current: null as string | null };
  return {
    list,
    nearBottom,
    lastSeen,
    unseen: () => unseen,
    render(callId: string, messages: Message[]) {
      list.scrollHeight = messages.length * 48;
      const last = messages.at(-1);
      runEffect(callId, messages, last?.clientId ?? last?.id ?? null, { id: "me" }, { current: list },
        nearBottom, lastSeen, round,
        (next: number | ((value: number) => number)) => { unseen = typeof next === "function" ? next(unseen) : next; },
        followNewMessages, messagesAfter, pinToBottom);
    },
    scrollUp() {
      list.scrollTop = 96;
      nearBottom.current = isNearBottom(list);
    },
    atBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight <= 0; },
  };
}

test("round selection is a layout-effect dependency, including two empty rounds", () => {
  const deps = effect!.arguments[1];
  assert.ok(deps && ts.isArrayLiteralExpression(deps));
  assert.ok(deps.elements.some((item) => item.getText(ast) === "callId"));
});

test("switching equally populated rounds resets scroll and the old unseen pill", () => {
  const c = chat();
  const a = history("a");
  const b = history("b", 41);
  c.render("a", a);
  assert.equal(c.atBottom(), true);
  c.scrollUp();
  c.render("a", [...a, { id: "a-incoming", senderId: "them" }]);
  assert.equal(c.list.scrollTop, 96);
  assert.equal(c.unseen(), 1);
  c.render("b", b);
  assert.equal(c.atBottom(), true);
  assert.equal(c.unseen(), 0);
  assert.equal(c.nearBottom.current, true);
  assert.equal(c.lastSeen.current, "b-40");
});

test("an empty round opens cleanly and follows its later history load", () => {
  const c = chat();
  const a = history("a");
  c.render("a", a);
  c.scrollUp();
  c.render("a", [...a, { id: "a-new", senderId: "them" }]);
  c.render("empty", []);
  assert.equal(c.unseen(), 0);
  assert.equal(c.lastSeen.current, null);
  assert.equal(c.nearBottom.current, true);
  c.render("empty", history("loaded", 60));
  assert.equal(c.atBottom(), true);
  assert.equal(c.unseen(), 0);
});

test("rapid A to B to A switches each open at the latest message", () => {
  const c = chat();
  for (const id of ["a", "b", "a", "b", "a"]) {
    c.render(id, history(id));
    assert.equal(c.atBottom(), true, id);
    assert.equal(c.unseen(), 0, id);
    c.scrollUp();
  }
});

test("same-round updates still preserve older reading and sending still pins", () => {
  const c = chat();
  const a = history("a");
  c.render("a", a);
  c.scrollUp();
  c.render("a", a);
  assert.equal(c.list.scrollTop, 96);
  const incoming = [...a, { id: "incoming", senderId: "them" }];
  c.render("a", incoming);
  assert.equal(c.list.scrollTop, 96);
  assert.equal(c.unseen(), 1);
  c.render("a", [...incoming, { id: "mine", clientId: "optimistic", senderId: "me" }]);
  assert.equal(c.atBottom(), true);
  assert.equal(c.unseen(), 0);
});
