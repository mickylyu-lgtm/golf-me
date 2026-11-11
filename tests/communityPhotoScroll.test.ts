// Run with npm test. Execute the production scroll effects/handler against
// a small scroll-box model, plus guard their pre-paint and CSS wiring.
// Real native touch input is covered by the accompanying local QA report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/community/MediaCarousel.tsx", import.meta.url), "utf8");
const postSource = readFileSync(new URL("../src/components/community/PostCard.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("MediaCarousel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects: ts.CallExpression[] = [];
let scroll: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ["useEffect", "useLayoutEffect"].includes(node.expression.getText(ast))) effects.push(node);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleScroll") scroll = node;
  ts.forEachChild(node, visit);
}
visit(ast);
const opening = effects.find(node => node.arguments[0]?.getText(ast).includes("initialIndex * track.clientWidth"));
const returning = effects.find(node => node.arguments[0]?.getText(ast).includes("showSlide.index"));
assert.ok(opening && returning && scroll?.body);
function body(effect: ts.CallExpression): string {
  const callback = effect.arguments[0] as ts.ArrowFunction;
  assert.ok(ts.isBlock(callback.body));
  return callback.body.statements.map(node => node.getText(ast)).join("\n");
}
const open = new Function("trackRef", "initialIndex", body(opening));
const restore = new Function("trackRef", "showSlide", "media", "setActiveIndex", body(returning));
const onScroll = new Function("trackRef", "media", "setActiveIndex", scroll.body.statements.map(node => node.getText(ast)).join("\n"));

test("opening and return jumps happen before paint, never as a CSS smooth animation", () => {
  assert.equal(opening!.expression.getText(ast), "useLayoutEffect");
  assert.equal(returning!.expression.getText(ast), "useLayoutEffect");
  assert.doesNotMatch(source, /overflow-x-auto scroll-smooth/);
  assert.match(source, /snap-x snap-mandatory overflow-x-auto/);
});

test("opening a later photo is already at its target when the first swipe starts", () => {
  for (const index of [1, 2, 9]) {
    const track = { clientWidth: 390, scrollLeft: 0 };
    open({ current: track }, index);
    assert.equal(track.scrollLeft, index * 390);
    // Nothing remains scheduled to carry this subsequent swipe back.
    track.scrollLeft -= 390;
    assert.equal(track.scrollLeft, (index - 1) * 390);
  }
});

test("closing restores the card immediately and clamps stale indices", () => {
  for (const [requested, expected] of [[0, 0], [1, 1], [2, 2], [-1, 0], [8, 2]]) {
    const track = { clientWidth: 350, scrollLeft: 0 };
    let active = 0;
    restore({ current: track }, { index: requested }, [0, 1, 2], (n: number) => { active = n; });
    assert.equal(track.scrollLeft, expected * 350);
    assert.equal(active, expected);
  }
});

test("a second close at the same index is a new request after manual card scrolling", () => {
  const deps = returning!.arguments[1];
  assert.ok(deps && ts.isArrayLiteralExpression(deps));
  assert.ok(deps.elements.some(node => node.getText(ast) === "showSlide"));
  assert.match(postSource, /setCardMediaSlide\(\{ index: last \}\)/);
  assert.match(postSource, /showSlide=\{cardMediaSlide\}/);
  const track = { clientWidth: 350, scrollLeft: 0 };
  let previous: { index: number } | undefined;
  for (let cycle = 0; cycle < 3; cycle++) {
    const request = { index: 1 };
    assert.equal(Object.is(previous, request), false);
    restore({ current: track }, request, [0, 1, 2], () => {});
    assert.equal(track.scrollLeft, 350);
    track.scrollLeft = 0;
    previous = request;
  }
});

test("ordinary card scrolling is not pulled back when there is no return request", () => {
  const track = { clientWidth: 350, scrollLeft: 350 };
  restore({ current: track }, undefined, [0, 1, 2], () => assert.fail("must not change index"));
  assert.equal(track.scrollLeft, 350);
});

test("scroll tracking clamps elastic overscroll and still reports the nearest photo", () => {
  for (const [left, expected] of [[-400, 0], [0, 0], [195, 1], [390, 1], [780, 2], [1200, 2]]) {
    let active = 0;
    onScroll({ current: { clientWidth: 390, scrollLeft: left } }, [0, 1, 2],
      (update: (n: number) => number) => { active = update(active); });
    assert.equal(active, expected);
  }
});

test("missing or zero-width tracks do not produce invalid scroll indices", () => {
  open({ current: null }, 2);
  restore({ current: null }, { index: 2 }, [0, 1, 2], () => assert.fail());
  onScroll({ current: { clientWidth: 0, scrollLeft: 100 } }, [0, 1, 2], () => assert.fail());
});

