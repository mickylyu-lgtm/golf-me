import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import ts from "typescript";
import { isFounder, FOUNDER_USER_ID } from "../src/lib/founder.ts";
const req = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/chat/FounderWelcomeText.tsx", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} as any };
new Function("require", "exports", "module", js)((id: string) => id === "../../lib/founder" ? { isFounder } : req(id), mod.exports, mod);
const copy = mod.exports.FOUNDER_WELCOME_TEXT;
const render = (text: string, senderId = FOUNDER_USER_ID) => renderToStaticMarkup(createElement(mod.exports.FounderWelcomeText, { text, senderId }));
test("only approved founder welcome renders exactly three semantic bold spans", () => {
  const html = render(copy);
  assert.deepEqual([...html.matchAll(/<strong[^>]*>(.*?)<\/strong>/g)].map(m => m[1]), ["not a dating app", "appropriate and respectful", "golf content"]);
  assert.equal(html.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'"), copy);
  const sql = readFileSync(new URL("../supabase/migrations/20261119050821_founder_welcome_golf_not_dating.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("'" + copy + "'"));
});
test("other senders cannot trigger welcome styling, even with identical text", () => {
  for (const sender of ["other", "Micky", "", FOUNDER_USER_ID + " "]) assert.doesNotMatch(render(copy, sender), /<strong/);
});
test("old founder messages, edited text and spoof-like markup remain escaped plain text", () => {
  for (const text of ["Hey! I’m Micky, GolfMe’s founder 👋 Glad you’re here.", copy + " ", "**not a dating app**", "<strong>golf content</strong>", '<img src=x onerror="alert(1)">', "appropriate and respectful"]) {
    const html = render(text);
    assert.doesNotMatch(html, /<(strong|img|script)/);
    if (text.includes("<")) assert.ok(html.includes("&lt;"));
  }
});
test("DM integration replaces only plain message text, not copy or preview", () => {
  const dm = readFileSync(new URL("../src/pages/DirectMessageThread.tsx", import.meta.url), "utf8");
  assert.match(dm, /<FounderWelcomeText senderId=\{m.senderId\} text=\{m.text\} \/>/);
  assert.match(dm, /copyText\(m.text\)/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});
