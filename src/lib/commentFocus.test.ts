/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";



const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../pages/PostDetail.tsx", import.meta.url), "utf8");

describe("comment composer focus", () => {
  it("scopes the replacement to the rounded comment composer", () => {
    expect(page).toContain('className="gm-comment-composer flex');
    expect(css).toMatch(/\.gm-comment-composer input:focus-visible\s*\{\s*outline: none;/);
  });
  it("replaces, rather than removes, visible input focus", () => {
    expect(css).toMatch(/\.gm-comment-composer:has\(input:focus-visible\)\s*\{\s*outline: 2px solid/);
    expect(css).toContain("outline: 2px solid Highlight");
    expect(css).toContain(":focus-visible {");
  });
});
