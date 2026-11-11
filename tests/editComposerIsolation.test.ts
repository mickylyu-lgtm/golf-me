// DOM/focus behavior is covered by scripts/check-message-edit-ui.mjs.
// These run in the normal gate and execute the actual send handlers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createSendGuard } from "../src/lib/sendGuard.ts";
import { draftSendKey } from "../src/lib/chatImages.ts";

const read = (path: string) => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
function handler(path: string, name: string, scope: Record<string, unknown>) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, name + " exists");
  const js = ts.transpileModule("const run = " + found.getText(source) + ";", {
    compilerOptions: { target: ts.ScriptTarget.ESNext },
  }).outputText;
  return new Function(...Object.keys(scope), js + "; return run;")(...Object.values(scope));
}

test("inline edit: disabled composer never claims a draft or sends; restored draft sends once", () => {
  const sendGuardRef = { current: createSendGuard() };
  let sent = 0;
  const scope = { photoBusy: false, sendGuardRef, draftSendKey, value: "Keep this draft", photoKey: null, onSend: () => sent++ };
  const paused = handler("components/chat/ChatComposer.tsx", "send", { ...scope, disabled: true });
  paused(); paused();
  assert.equal(sent, 0);
  const restored = handler("components/chat/ChatComposer.tsx", "send", { ...scope, disabled: false });
  restored(); restored();
  assert.equal(sent, 1);
});

test("inline edit: disabled send click cannot refocus the normal composer", () => {
  let focused = 0;
  let sent = 0;
  const click = handler("components/chat/ChatComposer.tsx", "handleSendClick", {
    disabled: true,
    focusedAtPressRef: { current: true },
    textareaRef: { current: { focus: () => focused++ } },
    send: () => sent++,
  });
  click();
  assert.equal(focused, 0);
  assert.equal(sent, 0);
});

test("inline edit: both thread send handlers exit before touching draft, attachments or network", async () => {
  for (const path of ["pages/DirectMessageThread.tsx", "components/chat/GroupChat.tsx"]) {
    // Any access beyond the editing guard references unavailable state and fails.
    await handler(path, "handleSend", { editing: { id: "editing" } })();
  }
});

test("inline edit: paused wrapper retains children but hides and inerts every composer control", () => {
  const js = ts.transpileModule(read("components/chat/PausedChatComposer.tsx"), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("exports", "require", js)(exports, createRequire(import.meta.url));
  const render = (paused: boolean) => renderToStaticMarkup(createElement(exports.PausedChatComposer, { paused }, createElement("button", null, "Retained")));
  assert.match(render(true), /inert="" aria-hidden="true"/);
  assert.match(render(true), /opacity:0\.25/);
  assert.match(render(true), /data-chat-composer-shield/);
  assert.match(render(true), />Retained<\/button>/);
  assert.doesNotMatch(render(false), /inert=|aria-hidden=|data-chat-composer-shield/);
  assert.match(render(false), /opacity:1/);
  assert.match(render(false), />Retained<\/button>/);
});
