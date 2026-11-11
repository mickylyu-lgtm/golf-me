import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/golfer/CompareModal.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("CompareModal.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const labels: string[] = [];
function visit(node: ts.Node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "CompareRow") {
    const label = node.attributes.properties.find((prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "label");
    assert.ok(label?.initializer);
    if (ts.isStringLiteral(label.initializer)) {
      labels.push(label.initializer.text);
    } else {
      // The handicap heading uses the shared localized profile label.
      assert.ok(ts.isJsxExpression(label.initializer));
      const call = label.initializer.expression;
      assert.ok(call && ts.isCallExpression(call));
      assert.equal(call.expression.getText(ast), "t");
      assert.equal(call.arguments.length, 1);
      assert.ok(ts.isStringLiteral(call.arguments[0]));
      assert.equal(call.arguments[0].text, "profile.handicap");
      labels.push("Handicap");
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);

test("Compare omits the credibility row and all of its tier labels", () => {
  assert.ok(!labels.includes("Credibility"));
  assert.doesNotMatch(source, /credibilityLabel|Building Credibility|credibility\.building/);
});

test("Compare preserves all eight other rows in their original order", () => {
  assert.deepEqual(labels, [
    "Handicap", "Rounds Played", "Would Play Again", "Show-Up Rate",
    "Pace", "Golf Vibe", "Budget / Round", "Walking or Cart",
  ]);
});

test("Compare preserves its existing match-reason sections and close behavior", () => {
  assert.match(source, /<MatchReasons reasons=\{positives\}/);
  assert.match(source, /<MatchReasons reasons=\{negatives\}/);
  assert.match(source, /<Modal title=\{`Compare with \$\{firstName\}`\} onClose=\{onClose\}/);
});
