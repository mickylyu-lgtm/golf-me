import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import ts from "typescript";
import { goBack } from "../src/lib/goBack.ts";
import * as paths from "../src/lib/roundCourseLink.ts";

const courseId = "71b105b1-3eaa-4153-9fe2-53cce1e44e5b";
const roundId = "c6361982-c16b-4c01-bda1-dab0161cb232";
const req = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/golfcall/RoundCourseHeading.tsx", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const mod = { exports: {} as any };
new Function("require", "exports", js)((id: string) => id.endsWith("roundCourseLink") ? paths : req(id), mod.exports);

test("canonical course ID renders an accessible heading link with native href", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(mod.exports.RoundCourseHeading, { name: "Bethpage Black", courseId, roundId, isDemo: false })));
  assert.match(html, /<h1[^>]*><a /);
  assert.ok(html.includes(`href="/courses/${courseId}"`));
  assert.match(html, /Bethpage Black/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /min-h-11/);
});

test("manual, simulator without a course ID, malformed and demo venues render plain titles", () => {
  for (const props of [
    { name: "Bethpage Black" }, { name: "Chelsea Piers Simulator" },
    { name: "Manual venue", courseId: "/etc/foreign" }, { name: "Demo venue", courseId, isDemo: true },
  ]) {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(mod.exports.RoundCourseHeading, { roundId, isDemo: false, ...props })));
    assert.match(html, /<h1[^>]*>[^<]+<\/h1>/);
    assert.doesNotMatch(html, /<a |href=/);
  }
});

test("round context is history state, safely validates Back fallback", () => {
  assert.match(source, /state=\{\{ fromRoundId: roundId \}\}/);
  assert.equal(paths.originatingRoundPath(roundId), `/golf-calls/${roundId}`);
  for (const malformed of [undefined, {}, "//example.com", "/", `${roundId}/evil`]) {
    assert.equal(paths.originatingRoundPath(malformed), undefined);
  }
  const course = readFileSync(new URL("../src/pages/CourseDetail.tsx", import.meta.url), "utf8");
  assert.match(course, /if \(missing && !roundPath\) return <Navigate/);
  assert.match(course, /goBack\(navigate, roundPath \?\? "\/courses\/nearby"\)/);
});

test("Back can POP the originating round (existing scroll restoration) or use exact cold fallback", (t) => {
  const fn = t.mock.fn();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const browser = { history: { state: { idx: 1 } } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  try {
    const fallback = paths.originatingRoundPath(roundId);
    goBack(fn as any, fallback);
    browser.history.state.idx = 0;
    goBack(fn as any, fallback);
    assert.deepEqual(fn.mock.calls.map((c) => c.arguments), [[-1], [`/golf-calls/${roundId}`, { replace: true }]]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
