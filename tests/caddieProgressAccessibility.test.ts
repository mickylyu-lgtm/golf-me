import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("Caddie announces persisted stage changes without announcing every elapsed second", () => {
  const source = readFileSync(new URL("../src/components/caddie/CaddieThinking.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("CaddieThinking.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const liveRegions: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(
      prop => ts.isJsxAttribute(prop) && prop.name.getText(tree) === "aria-live",
    )) liveRegions.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(liveRegions.length, 1);
  const announcement = liveRegions[0].getText(tree);
  assert.match(announcement, /STEP_KEYS\[progress.step\]/);
  assert.match(announcement, /aria-atomic="true"/);
  assert.doesNotMatch(announcement, /formatElapsed|elapsedSeconds/);
  assert.match(source, /formatElapsed\(progress.elapsedSeconds\)/, "the clock remains visible and readable outside the live region");
});
