#!/usr/bin/env node
// Renders the blank Caddie V2 forms in docs/caddie-v2/consent/ to print-ready
// A4 PDFs next to them, using playwright-core (already a devDependency) and
// its locally cached headless Chromium. Offline: every non-file:// request is
// blocked.
//   - CONSENT_FORM_v1.html          participant consent (form version 1.2)
//   - COACH_CONFIDENTIALITY_v1.html coach agreement (agreement version 1.0)
//
// Usage: node tools/caddie-eval/render-consent-pdf.mjs [NAME.html ...]
// With no names, renders both. Name only the form whose wording changed, so the
// other PDF is not rewritten.
// No Chromium cached, or it fails on a missing shared library (common on
// WSL)? Either set LD_LIBRARY_PATH to a folder holding those libraries, or do
// the one-step export: open the HTML in Chrome (e.g. on Windows), Print,
// Destination "Save as PDF", paper A4, margins Default, background graphics
// off. Same result. Re-render whenever a form's wording or version changes.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(repo, "docs", "caddie-v2", "consent");
const ALL_FORMS = ["CONSENT_FORM_v1.html", "COACH_CONFIDENTIALITY_v1.html"];
const requested = process.argv.slice(2);
const unknown = requested.filter((n) => !ALL_FORMS.includes(n));
if (unknown.length) {
  process.stderr.write(`Unknown form(s): ${unknown.join(", ")}. Choose from: ${ALL_FORMS.join(", ")}\n`);
  process.exit(2);
}
const forms = requested.length ? requested : ALL_FORMS;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route("**/*", (route) => (route.request().url().startsWith("file://") ? route.continue() : route.abort()));
  await page.emulateMedia({ media: "print", colorScheme: "light" });
  for (const name of forms) {
    const html = path.join(dir, name);
    const pdf = html.replace(/\.html$/, ".pdf");
    await page.goto(pathToFileURL(html).href);
    await page.pdf({ path: pdf, format: "A4", preferCSSPageSize: true, printBackground: false });
    process.stdout.write(`Wrote ${path.relative(repo, pdf)}\n`);
  }
} finally {
  await browser.close();
}
