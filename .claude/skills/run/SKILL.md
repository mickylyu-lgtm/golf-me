---
description: Launch GolfMe's Vite dev server and drive it with headless Chrome via playwright-core to verify UI changes with real screenshots.
---

# Running GolfMe

GolfMe is a Vite + React + TypeScript SPA with mock data only (no
backend) — all state lives in `localStorage`, seeded from
`src/data/*.ts` on first load.

## Dev server

```bash
npm run dev &                      # serves on http://localhost:5173
timeout 30 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done'
```

Stop with `lsof -ti:5173 -sTCP:LISTEN | xargs -r kill` before relaunching.

## Driving it headless

`playwright-core` is a real devDependency here (added specifically so
UI changes can be screenshotted without a browser window) — no
`npm install` needed before using it. It does **not** bundle a
browser, so point it at whatever Chrome/Edge is already on the
machine:

```js
const { chromium } = require("playwright-core");
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
```

If that path doesn't exist, also try
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.

**Gotcha:** `package.json` has `"type": "module"`, so a driver script
must be named `*.cjs` (plain `.js` fails with "require is not defined
in ES module scope"). Write it inside `GolfMe/` itself (not the OS
temp/scratchpad dir) so `require("playwright-core")` resolves against
this project's `node_modules` — then delete it when done, it's a
throwaway driver, not part of the app.

## Auth

There's no real backend — `/login` shows a mock picker. Fastest path
to a logged-in session:

```js
await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
await page.getByText("Try Demo Account").click();
await page.waitForURL("http://localhost:5173/");
```

That logs in as the seeded demo user (Jordan Ramirez /
`DEFAULT_CURRENT_USER_ID` in `src/data/golfers.ts`).

## One representative interaction

```js
const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); // iPhone-width mobile check
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
await page.getByText("Try Demo Account").click();
await page.waitForURL("http://localhost:5173/");
await page.screenshot({ path: "home.png" });
console.log("ERRORS:", JSON.stringify(errors));
```

Always check `errors` is empty — a page can render its shell while a
data computation throws silently in the console.

## Notes

- Mobile-first app — the bottom nav / root-tab carousel only render
  below the `sm` breakpoint, so use a ~390px viewport width to see
  what most users see.
- `npm run lint` (oxlint) and `npx tsc -b` are fast and worth running
  before any browser check — most regressions surface there first.
