#!/usr/bin/env node
// Renders docs/caddie-v2/consent/CONSENT_FORM_v1.html to a print-ready A4 PDF
// next to it, using playwright-core (already a devDependency) and its locally
// cached headless Chromium. Offline: every non-file:// request is blocked.
//
// Usage: node tools/caddie-eval/render-consent-pdf.mjs
// No Chromium cached, or it fails on a missing shared library (common on
// WSL)? Either set LD_LIBRARY_PATH to a folder holding those libraries, or do
// the one-step export: open the HTML in Chrome (e.g. on Windows), Print,
// Destination "Save as PDF", paper A4, margins Default, background graphics
// off. Same result. Re-render whenever the form's wording or version changes.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = path.join(repo, "docs", "caddie-v2", "consent", "CONSENT_FORM_v1.html");
const pdf = html.replace(/\.html$/, ".pdf");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route("**/*", (route) => (route.request().url().startsWith("file://") ? route.continue() : route.abort()));
  await page.goto(pathToFileURL(html).href);
  await page.emulateMedia({ media: "print", colorScheme: "light" });
  await page.pdf({ path: pdf, format: "A4", preferCSSPageSize: true, printBackground: false });
  process.stdout.write(`Wrote ${path.relative(repo, pdf)}\n`);
} finally {
  await browser.close();
}
