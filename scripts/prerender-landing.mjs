#!/usr/bin/env node
// Post-build step (see package.json "build"): renders the public landing
// page (src/prerender-entry.tsx) to static HTML and injects it into
// dist/index.html as <div id="prerender"> ahead of the app's #root.
//
// Why: the site is a single Vite SPA and every URL serves index.html, so
// without this a crawler or link-preview bot gets an empty page. With it,
// /, /welcome and every other path return the full landing-page markup
// (styled by the normal CSS bundle linked in <head>), and the app takes
// over on load exactly as before — index.html's inline guard script
// hides the static copy instantly for signed-in users and the native iOS
// shell, and Welcome.tsx removes it once the real page is mounted.
//
// Fails soft: any error here prints a warning and leaves dist/index.html
// untouched, so a prerender problem can never break the app build.
//
//   node scripts/prerender-landing.mjs          # after `vite build`
//   PRERENDER_SKIP=1 npm run build              # skip it entirely

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "dist", "index.html");
const MARKER = '<div id="root"></div>';

async function main() {
  if (process.env.PRERENDER_SKIP === "1") {
    console.log("[prerender] skipped (PRERENDER_SKIP=1)");
    return;
  }
  const { createServer } = await import("vite");
  const server = await createServer({
    root,
    mode: "production",
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    // The dev-server pipeline is only used to transform TSX for Node here;
    // nothing is written to dist by it.
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const mod = await server.ssrLoadModule("/src/prerender-entry.tsx");
    const html = mod.render();
    if (typeof html !== "string" || html.length < 2000 || !html.includes("App Store")) {
      throw new Error(`rendered output looks wrong (${typeof html}, ${html?.length ?? 0} chars)`);
    }
    const original = await readFile(indexPath, "utf8");
    if (!original.includes(MARKER)) throw new Error(`${MARKER} not found in dist/index.html`);
    if (original.includes('id="prerender"')) throw new Error("dist/index.html already contains a prerender block");
    const injected = original.replace(MARKER, `<div id="prerender">${html}</div>\n    ${MARKER}`);
    await writeFile(indexPath, injected, "utf8");
    console.log(`[prerender] injected ${Math.round(html.length / 1024)} KB of landing-page HTML into dist/index.html`);
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.warn("[prerender] WARNING: landing page was not prerendered; the app build is unaffected.");
  console.warn(err instanceof Error ? err.stack ?? err.message : err);
});
