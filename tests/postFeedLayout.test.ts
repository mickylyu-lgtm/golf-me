import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { POST_FEED_GAP_PX, postFeedRowSpan } from "../src/lib/postFeedLayout.ts";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const grid = read("src/components/community/PostFeedGrid.tsx");
const carousel = read("src/components/community/MediaCarousel.tsx");

test("one-pixel grid rows leave a consistent 16px gap for unequal card heights", () => {
  assert.equal(POST_FEED_GAP_PX, 16);
  for (const height of [0, 151, 333.5, 576, 875.125, 2345.9]) {
    const gap = postFeedRowSpan(height) - height;
    assert.ok(gap >= 16 && gap < 17, String(gap));
  }
});

test("invalid or not-yet-measured heights cannot create invalid grid spans", () => {
  for (const height of [NaN, Infinity, -Infinity, -1]) assert.equal(postFeedRowSpan(height), 1);
});

test("layout keeps incoming DOM order and sparse placement rather than dense or column reordering", () => {
  assert.match(grid, /Children\.map\(children/);
  assert.match(grid, /lg:auto-rows-\[1px\]/);
  assert.match(grid, /lg:gap-y-0/);
  assert.doesNotMatch(grid, /grid-flow-dense|columns-\d|\.sort\(|\.reverse\(/);
});

test("cards are measured before paint and repacked after asynchronous size changes", () => {
  assert.match(grid, /useLayoutEffect/);
  assert.match(grid, /new ResizeObserver\(measure\)/);
  assert.match(grid, /observer\.observe\(content\)/);
  assert.match(grid, /observer\.disconnect\(\)/);
  assert.match(grid, /getBoundingClientRect\(\)\.height/);
});

test("Home and all desktop post lists use the same compact grid", () => {
  for (const page of ["Home", "Community", "MyPosts", "SavedPosts"]) {
    assert.match(read("src/pages/" + page + ".tsx"), /<PostFeedGrid/, page);
  }
  const home = read("src/pages/Home.tsx");
  assert.match(home, /<PostFeedGrid className="xl:max-\[1399px\]:grid-cols-1"/);
  assert.ok(home.indexOf("</PostFeedGrid>") < home.indexOf("ref={postsEndRef}"));
  assert.match(home, /observer\.observe\(end\)/, "load-more sentinel is still observed");
});

const ast = ts.createSourceFile("MediaCarousel.tsx", carousel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let phone: ts.FunctionDeclaration | undefined;
let box: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "feedPhotoBoxAspect") phone = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "boxAspect") box = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(phone?.body && box);
const phoneBody = phone.body.statements.map(node => node.getText(ast)).join(";");
const phoneAspect = new Function("photoAspect", "FEED_PHOTO_MIN_ASPECT", "FEED_PHOTO_MAX_ASPECT", phoneBody);
const aspect = new Function("wide", "photoAspect", "FEED_PHOTO_MIN_ASPECT", "feedPhotoBoxAspect", "return " + box.getText(ast));

test("desktop photos retain their full natural aspect, including panoramas and tall portraits", () => {
  for (const ratio of [1 / 3, 4 / 5, 1, 4 / 3, 16 / 9, 3, 6]) {
    assert.equal(aspect(true, ratio, 4 / 5, () => assert.fail("desktop must not clamp")), ratio);
  }
  assert.equal(aspect(true, null, 4 / 5, () => assert.fail()), 4 / 5);
});

test("existing phone aspect limits are unchanged", () => {
  const clamp = (ratio: number | null) => phoneAspect(ratio, 4 / 5, 1.91);
  for (const [ratio, expected] of [[1 / 3, 4 / 5], [1, 1], [6, 1.91]]) {
    assert.equal(aspect(false, ratio, 4 / 5, clamp), expected);
  }
});

test("mixed albums measure the selected photo and ignore stale dimensions from another source", () => {
  assert.match(carousel, /wide \? media\[activeIndex\]/);
  assert.match(carousel, /loadedPhoto\?\.src === photoSrc/);
  assert.match(carousel, /if \(live\) setLoadedPhoto/);
  assert.match(carousel, /style=\{fitCardToPhoto \? \{ aspectRatio: String\(boxAspect\) \}/);
});
