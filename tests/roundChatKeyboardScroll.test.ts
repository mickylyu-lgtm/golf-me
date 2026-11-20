// Execute GroupChat's actual dock/restore effects without an iOS keyboard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { focusMovedToOtherField } from "../src/lib/composerFocus.ts";

const path = new URL("../src/components/chat/GroupChat.tsx", import.meta.url);
const ast = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const layouts: ts.CallExpression[] = [];
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useLayoutEffect") layouts.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
const dock = layouts.find(node => node.arguments[0].getText(ast).includes("const releaseScroll = lockPageScroll()"))!;
const identity = layouts.find(node => node.arguments[1]?.getText(ast) === "[callId, layout]");

function fixture() {
  let nextFrame = 0;
  let locks = 0;
  const frames = new Map<number, () => void>();
  const input = { tagName: "TEXTAREA" };
  const composer = { offsetHeight: 54, isConnected: true, contains: (el: unknown) => el === input };
  const list = { scrollTop: 15, scrollHeight: 1000 };
  const writes: number[] = [];
  const scope = {
    composerRef: { current: composer as typeof composer | null },
    listRef: { current: list },
    scrollYBeforeKeyboardRef: { current: 738 as number | null },
    composerPageTopRef: { current: 1250 as number | null },
    keyboardHeight: 300,
    document: { activeElement: input as unknown },
    window: { innerHeight: 844, scrollY: 738, scrollTo(_x: number, y: number) { this.scrollY = y; writes.push(y); } },
    pinToBottom(el: typeof list) { el.scrollTop = el.scrollHeight; },
    lockPageScroll() { locks++; return () => { locks--; }; },
    focusMovedToOtherField,
    requestAnimationFrame(callback: () => void) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
  };
  function execute(effect: ts.CallExpression | undefined, composerDocked = false): (() => void) | undefined {
    if (!effect) return;
    const callback = ts.transpileModule("const execute = " + effect.arguments[0].getText(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const values = { ...scope, composerDocked };
    return new Function(...Object.keys(values), callback + "\nreturn execute();")(...Object.values(values));
  }
  return {
    scope, composer, list, writes,
    dock: (on: boolean) => execute(dock, on),
    identity: () => execute(identity),
    get locks() { return locks; },
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
  };
}

test("round card unmount while docked cannot overwrite Back or a new route's scroll", () => {
  for (const destinationY of [0, 1700]) {
    const f = fixture();
    const reset = f.identity();
    const release = f.dock(true);
    assert.equal(f.locks, 1);
    f.writes.length = 0;
    f.scope.document.activeElement = { tagName: "BODY" };
    release?.();
    reset?.();
    f.composer.isConnected = false;
    f.scope.composerRef.current = null;
    f.scope.window.scrollTo(0, destinationY);
    f.flush();
    assert.deepEqual(f.writes, [destinationY]);
    assert.equal(f.locks, 0);
  }
});

test("round card keyboard dismissal restores the original position exactly once", () => {
  const f = fixture();
  f.dock(true)?.();
  assert.equal(f.list.scrollTop, 1000, "the already-existing dock pin stays intact");
  f.writes.length = 0;
  f.dock(false);
  f.flush();
  f.flush();
  assert.deepEqual(f.writes, [738]);
  assert.equal(f.locks, 0);
  assert.equal(f.scope.scrollYBeforeKeyboardRef.current, null);
});

test("Back between undock and restore cancels the old scroll", () => {
  const f = fixture();
  f.dock(true)?.();
  const cancel = f.dock(false);
  cancel?.();
  f.writes.length = 0;
  f.scope.window.scrollTo(0, 1700);
  f.flush();
  assert.deepEqual(f.writes, [1700]);
});

test("pending restore only applies to the original connected composer and its focus", () => {
  for (const invalidate of [
    (f: ReturnType<typeof fixture>) => { f.composer.isConnected = false; },
    (f: ReturnType<typeof fixture>) => { f.scope.composerRef.current = null; },
    (f: ReturnType<typeof fixture>) => { f.scope.document.activeElement = { tagName: "TEXTAREA" }; },
  ]) {
    const f = fixture();
    f.dock(true)?.();
    f.dock(false);
    invalidate(f);
    f.writes.length = 0;
    f.flush();
    assert.deepEqual(f.writes, []);
  }
});

test("reopening the keyboard cancels a prior restore", () => {
  const f = fixture();
  f.dock(true)?.();
  f.dock(false)?.();
  f.scope.scrollYBeforeKeyboardRef.current = 400;
  f.scope.composerPageTopRef.current = 900;
  const release = f.dock(true);
  f.writes.length = 0;
  f.flush();
  assert.deepEqual(f.writes, []);
  assert.equal(f.locks, 1);
  release?.();
});

test("new round identity clears old coordinates even if chat stays docked", () => {
  const f = fixture();
  const reset = f.identity();
  const release = f.dock(true);
  reset?.();
  release?.();
  f.writes.length = 0;
  f.dock(true)?.();
  f.dock(false);
  f.flush();
  assert.deepEqual(f.writes, []);
  assert.equal(f.scope.composerPageTopRef.current, null);
  assert.match(dock.arguments[1].getText(ast), /\bcallId\b/);
  assert.match(dock.arguments[1].getText(ast), /\blayout\b/);
});
