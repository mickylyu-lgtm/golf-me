// Execute PostDetail's actual layout effects with a deterministic frame queue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { focusMovedToOtherField } from "../src/lib/composerFocus.ts";

const source = readFileSync(new URL("../src/pages/PostDetail.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("PostDetail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects: ts.CallExpression[] = [];
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useLayoutEffect") effects.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
const dock = effects.find(node => node.arguments[0]?.getText(ast).includes("lockPageScroll()"))!;
const identity = effects.find(node => node.arguments[1]?.getText(ast) === "[id]");

function fixture() {
  let scrollY = 320;
  let locks = 0;
  let nextFrame = 0;
  const frames = new Map<number, () => void>();
  const composer = { isConnected: true, contains: (el: unknown) => el === input, parentElement: { offsetHeight: 54 } };
  const input = { tagName: "INPUT", isContentEditable: false };
  const otherField = { tagName: "TEXTAREA", isContentEditable: false };
  const document = { activeElement: input as unknown };
  const writes: number[] = [];
  const scope = {
    composerRef: { current: composer as typeof composer | null },
    scrollYBeforeKeyboardRef: { current: 320 as number | null },
    composerPageTopRef: { current: 1000 as number | null },
    keyboardHeight: 300, document, focusMovedToOtherField,
    window: { innerHeight: 844, get scrollY() { return scrollY; }, scrollTo(_x: number, y: number) { scrollY = y; writes.push(y); } },
    requestAnimationFrame: (callback: () => void) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    lockPageScroll: () => { locks++; let released = false; return () => { if (!released) { locks--; released = true; } }; },
  };
  function effect(node: ts.CallExpression | undefined, composerDocked = false): (() => void) | undefined {
    if (!node) return;
    const callback = ts.transpileModule("const callback = " + node.arguments[0].getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.trim().replace(/;$/, "");
    const values = { ...scope, composerDocked, id: "post-a" };
    return new Function(...Object.keys(values), `${callback}; return callback();`)(...Object.values(values));
  }
  return {
    scope, composer, input, otherField, writes, effect,
    dock: (on: boolean) => effect(dock, on),
    identity: () => effect(identity),
    get locks() { return locks; },
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    navigate() { composer.isConnected = false; scope.composerRef.current = null; document.activeElement = null; scrollY = 1800; writes.length = 0; },
  };
}

test("docked comments unmount never queues a post scroll over the restored feed", () => {
  const f = fixture();
  const reset = f.identity();
  const cleanup = f.dock(true);
  reset?.();
  cleanup?.();
  f.navigate();
  f.flush();
  assert.deepEqual(f.writes, []);
  assert.equal(f.locks, 0);
});

test("ordinary keyboard dismissal restores the post once and releases its lock", () => {
  const f = fixture();
  f.identity();
  f.dock(true)?.();
  f.writes.length = 0;
  f.dock(false);
  f.flush();
  assert.deepEqual(f.writes, [320]);
  assert.equal(f.locks, 0);
  assert.equal(f.scope.scrollYBeforeKeyboardRef.current, null);
});

test("keyboard hide then navigation before the next frame cancels restoration", () => {
  const f = fixture();
  const reset = f.identity();
  f.dock(true)?.();
  const cancel = f.dock(false);
  reset?.();
  cancel?.();
  f.navigate();
  f.flush();
  assert.deepEqual(f.writes, []);
});

test("a new field focused after keyboard hide is not pulled to the old composer", () => {
  const f = fixture();
  f.dock(true)?.();
  f.dock(false);
  f.scope.document.activeElement = f.otherField;
  f.writes.length = 0;
  f.flush();
  assert.deepEqual(f.writes, []);
});

test("redocking cancels the pending undock scroll", () => {
  const f = fixture();
  f.dock(true)?.();
  const cancel = f.dock(false);
  cancel?.();
  f.scope.scrollYBeforeKeyboardRef.current = 700;
  f.scope.composerPageTopRef.current = 1400;
  const release = f.dock(true);
  f.writes.length = 0;
  f.flush();
  assert.deepEqual(f.writes, []);
  assert.equal(f.locks, 1);
  release?.();
});

test("post identity cleanup forgets captures before a reused component can restore them", () => {
  const f = fixture();
  f.identity()?.();
  f.dock(false);
  f.flush();
  assert.deepEqual(f.writes, []);
  assert.equal(f.scope.composerPageTopRef.current, null);
  assert.match(dock.arguments[1].getText(ast), /\bid\b/);
});

test("a disconnected or replaced composer cannot restore even if its frame executes", () => {
  for (const disconnect of [true, false]) {
    const f = fixture();
    f.dock(true)?.();
    f.dock(false);
    if (disconnect) f.composer.isConnected = false;
    else f.scope.composerRef.current = null;
    f.writes.length = 0;
    f.flush();
    assert.deepEqual(f.writes, []);
  }
});

test("switching posts while still docked releases the old lock without reusing coordinates", () => {
  const f = fixture();
  const reset = f.identity();
  const release = f.dock(true);
  reset?.();
  release?.();
  f.writes.length = 0;
  const releaseNew = f.dock(true);
  f.flush();
  assert.deepEqual(f.writes, []);
  assert.equal(f.locks, 1);
  releaseNew?.();
  f.dock(false);
  f.flush();
  assert.deepEqual(f.writes, []);
  assert.equal(f.locks, 0);
});
