#!/usr/bin/env node
// Headless fake-iOS-keyboard check for GolfMe's keyboard layout code.
//
// What it does
//   Starts its own Vite dev server for --root (default: this checkout) with
//   a dummy backend (VITE_SUPABASE_URL=http://127.0.0.1:9, so nothing real
//   is ever reached) and a private dep cache, then drives the bundled
//   chrome-headless-shell (playwright-core) through a fixed list of
//   screens at 375x667 and 390x844 as the demo account. Every request that
//   isn't to the local dev server is aborted.
//
//   Before the app boots it injects a fake native iOS Capacitor bridge:
//   Capacitor.isNativePlatform() is true, getPlatform() is "ios", and the
//   Keyboard plugin is "native". window.__kb drives it:
//     __kb.show(h)  keyboardWillShow {keyboardHeight:h}, then (next task)
//                   resize:"body" -> document.body.style.height =
//                   innerHeight - h, then keyboardDidShow after 250ms
//     __kb.hide()   keyboardWillHide, body height cleared, keyboardDidHide
//                   after 250ms
//     __kb.listenerCounts()  live native listeners per event (catches
//                   duplicated / leaked Keyboard listeners)
//   Real-device ordering it does NOT model: the plugin's 0-delay WillHide
//   timer being cancelled by a following WillShow, keyboard animation, and
//   WKWebView's own scrolling. Physical-iPhone checks still decide.
//
//   For each screen it records, closed / open / (after) closed: the subject
//   element's top/bottom vs the keyboard top (coveredPx > 0 means hidden
//   under the keyboard), scrollY, the page scroll lock (body overflow),
//   whether the bottom nav is visible, the live listener counts, and a
//   screenshot of the open state.
//
// Usage
//   node scripts/dev/fake-keyboard.mjs [--label after] [--out DIR]
//       [--root DIR] [--port 5288] [--screens dm,report-over-keyboard]
//       [--viewports 375x667,390x844] [--kb 300]
//   node scripts/dev/fake-keyboard.mjs --diff before.json after.json
//
//   Results go to DIR/<label>.json (+ DIR/<label>-<screen>-<viewport>.png).
//   DIR defaults to $TMPDIR/golfme-fake-keyboard. --kb overrides the
//   per-viewport keyboard height (375x667: 260, 390x844: 336). For a
//   before/after, run once with --root pointing at a copy of the old code
//   (e.g. a `git worktree` or an exported tree with node_modules symlinked)
//   and --label before, once on this tree with --label after, then --diff.
//   Screens: see SCREENS below (`--screens list` prints them).
//
// Needs: playwright-core (devDependency) and its chromium-headless-shell
// (`npx playwright-core install chromium-headless-shell` once, if
// ~/.cache/ms-playwright has none). On WSL without Chrome's system libs,
// extract them (libnspr4, libnss3, ...) under
// ~/.cache/golfme-chromium-libs/root (or $GOLFME_CHROMIUM_LIBS); the
// script adds that to LD_LIBRARY_PATH. No network beyond localhost.

import { chromium } from "playwright-core";
import { createServer } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

const DEFAULT_KB = { "375x667": 260, "390x844": 336 };

// ---------------------------------------------------------------------------
// Injected before any app script runs.
function fakeNativeBridge() {
  const listeners = new Map(); // eventName -> Map(callbackId -> callback)
  let nextId = 1;
  const state = { height: 0, log: [] };
  const KEYBOARD_METHODS = ["addListener", "removeListener", "removeAllListeners", "setAccessoryBarVisible", "show", "hide", "setScroll", "setStyle", "setResizeMode", "getResizeMode"];
  window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
  window.Capacitor = {
    // Keyboard is the plugin under test; App only so the lifecycle hooks
    // don't reject. Every other plugin reports "not implemented on ios"
    // (as an unlinked plugin would) and is ignored.
    PluginHeaders: [
      { name: "Keyboard", methods: KEYBOARD_METHODS.map((name) => ({ name, rtype: name === "addListener" ? "callback" : "promise" })) },
      { name: "App", methods: ["addListener", "removeListener", "removeAllListeners", "getState", "getLaunchUrl", "getInfo"].map((name) => ({ name, rtype: name === "addListener" ? "callback" : "promise" })) },
    ],
    nativeCallback(plugin, method, options, callback) {
      const id = String(nextId++);
      if (plugin === "Keyboard" && method === "addListener") {
        const name = options && options.eventName;
        if (!listeners.has(name)) listeners.set(name, new Map());
        listeners.get(name).set(id, callback);
      }
      return id;
    },
    nativePromise(plugin, method, options) {
      if (plugin === "Keyboard" && method === "removeListener") {
        listeners.get(options.eventName)?.delete(String(options.callbackId));
      }
      if (plugin === "Keyboard" && method === "removeAllListeners") listeners.clear();
      if (plugin === "Keyboard" && method === "getResizeMode") return Promise.resolve({ mode: "body" });
      if (plugin === "App" && method === "getState") return Promise.resolve({ isActive: true });
      if (plugin === "App" && method === "getLaunchUrl") return Promise.resolve(undefined);
      return Promise.resolve({});
    },
  };
  const fire = (name, data) => {
    state.log.push(name);
    for (const callback of Array.from(listeners.get(name)?.values() ?? [])) callback(data);
  };
  window.__kb = {
    get height() {
      return state.height;
    },
    show(h) {
      state.height = h;
      fire("keyboardWillShow", { keyboardHeight: h });
      setTimeout(() => {
        if (state.height === h) document.body.style.height = `${window.innerHeight - h}px`;
      }, 0);
      setTimeout(() => {
        if (state.height === h) fire("keyboardDidShow", { keyboardHeight: h });
      }, 250);
    },
    hide() {
      state.height = 0;
      fire("keyboardWillHide", undefined);
      document.body.style.height = "";
      setTimeout(() => {
        if (state.height === 0) fire("keyboardDidHide", undefined);
      }, 250);
    },
    listenerCounts() {
      const out = {};
      for (const [name, map] of listeners) out[name] = map.size;
      return out;
    },
    log: () => state.log.slice(),
  };
  const describe = (el) => {
    if (!el || el === document.body) return null;
    const bits = [el.tagName.toLowerCase()];
    if (el.id) bits.push(`#${el.id}`);
    if (el.getAttribute("placeholder")) bits.push(`[${el.getAttribute("placeholder").slice(0, 30)}]`);
    if (el.getAttribute("role")) bits.push(`(${el.getAttribute("role")})`);
    return bits.join("");
  };
  // First match on the current screen: the root-tab carousel keeps other
  // tabs mounted off to the side, so a plain querySelector can hit those.
  window.__kbPick = (selector, text) => {
    const onScreen = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      if (r.right <= 0 || r.left >= window.innerWidth) return false;
      return !el.closest('[aria-hidden="true"], [inert]');
    };
    const all = Array.from(document.querySelectorAll(selector)).filter((el) => !text || new RegExp(text, "i").test((el.getAttribute("aria-label") || "") + " " + (el.textContent || "")));
    return all.filter(onScreen).pop() ?? null;
  };
  window.__kbProbe = (subject) => {
    const el = typeof subject === "string" ? window.__kbPick(subject) : document.activeElement;
    const vh = window.innerHeight;
    const kb = state.height;
    const kbTop = vh - kb;
    const rect = el && el !== document.body ? el.getBoundingClientRect() : null;
    // The bottom tab bar: a nav holding the Caddie tab link, drawn on screen.
    const navVisible = Array.from(document.querySelectorAll("nav")).some((n) => {
      if (!n.querySelector('a[href="/caddie"]')) return false;
      const b = n.getBoundingClientRect();
      if (b.height === 0 || b.top >= vh || b.bottom <= 0 || b.right <= 0 || b.left >= window.innerWidth) return false;
      for (let e = n; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      }
      return true;
    });
    const dialog = window.__kbPick('[role="dialog"]'); // the top-most sheet
    return {
      kb,
      kbTop,
      subject: el ? describe(el) : null,
      top: rect ? Math.round(rect.top) : null,
      bottom: rect ? Math.round(rect.bottom) : null,
      coveredPx: rect && kb > 0 ? Math.max(0, Math.round(rect.bottom - kbTop)) : 0,
      scrollY: Math.round(window.scrollY),
      pageLocked: document.body.style.overflow === "hidden",
      bottomNavVisible: navVisible,
      focused: describe(document.activeElement),
      sheetOverlayPaddingBottom: dialog ? dialog.parentElement?.style.paddingBottom || "0" : null,
      listeners: window.__kb.listenerCounts(),
    };
  };
}

// ---------------------------------------------------------------------------
const frames = (page, n = 2) => page.evaluate((count) => new Promise((resolve) => {
  let left = count;
  const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);
const settle = async (page, ms = 400) => {
  await page.waitForTimeout(ms);
  await frames(page, 2);
};
const probe = (page, subject) => page.evaluate((s) => window.__kbProbe(s), subject ?? null);
const focus = (page, selector) => page.evaluate((s) => {
  const el = window.__kbPick(s);
  if (!el) throw new Error(`no on-screen element for ${s}`);
  el.focus({ preventScroll: false });
  return true;
}, selector);
// Programmatic click (text: a case-insensitive regex on label/text): no
// focus change (a tap on iOS doesn't move focus off the field either), so
// the "keyboard" stays up.
const jsClick = (page, selector, text) => page.evaluate(([s, t]) => {
  const el = window.__kbPick(s, t);
  if (!el) throw new Error(`no on-screen element for ${s} ${t ?? ""}`);
  el.click();
}, [selector, text ?? null]);
const kbShow = (page, h) => page.evaluate((height) => window.__kb.show(height), h);
const kbHide = (page) => page.evaluate(() => window.__kb.hide());

async function gotoRoute(page, base, route) {
  // Client-side navigation keeps the demo session and the app state.
  await page.evaluate((r) => {
    window.history.pushState({}, "", r);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, route);
  await page.waitForFunction((r) => window.location.pathname === r, route);
  await settle(page, 600);
}

// Host a Round step 1 with a course picked and the playing-area field open.
async function openHostForm(page, base) {
  await gotoRoute(page, base, "/golf-calls/new");
  const has = (selector, text) => page.evaluate(([s, t]) => Boolean(window.__kbPick(s, t)), [selector, text ?? null]);
  // The course chip toggles and the draft persists, so only pick it when
  // the form isn't already showing the area field / its Edit button.
  if (!(await has('input[maxlength="80"]'))) {
    if (!(await has("button", "^\\s*edit\\s*$"))) {
      await jsClick(page, "button", "Bethpage Black · Recent");
      await settle(page, 300);
    }
    await jsClick(page, "button", "^\\s*edit\\s*$");
    await settle(page, 300);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

// Demo seed ids (src/data): g11 = Ethan Park (has a DM thread with the
// demo user), call-7 = a round the demo user hosts, post-2 = a post with a
// comment by someone else.
// Each screen: returns { closed, open, openSettled?, after, extra? }.
const SCREENS = {
  // DirectMessageThread (frozen): composer box sized from the keyboard
  // height, bottom nav hidden while open.
  async dm(page, base, kb, shot) {
    const href = "/messages/g11";
    await gotoRoute(page, base, href);
    await focus(page, "textarea");
    const closed = await probe(page, "textarea");
    await kbShow(page, kb);
    await frames(page, 2);
    const open = await probe(page, "textarea");
    await settle(page);
    const openSettled = await probe(page, "textarea");
    await shot("open");
    await kbHide(page);
    await settle(page);
    const after = await probe(page, "textarea");
    return { route: href, closed, open, openSettled, after };
  },

  // The reported bug: a keyboardAware sheet mounted while the keyboard is
  // already up (Report from a comment, the comment box focused). Probed on
  // the first frames after opening, with NO new keyboardWillShow.
  async "report-over-keyboard"(page, base, kb, shot) {
    await gotoRoute(page, base, "/community/post-2");
    await focus(page, "#comment-composer-input");
    await kbShow(page, kb);
    await settle(page);
    const closed = await probe(page, "#comment-composer-input");
    await jsClick(page, 'button[aria-label="More options"]');
    await frames(page, 2);
    await jsClick(page, "button", "^\\s*report");
    await frames(page, 2);
    const open = await probe(page, '[role="dialog"]');
    await settle(page, 700);
    const openSettled = await probe(page, '[role="dialog"]');
    await shot("open");
    await kbHide(page);
    await settle(page, 700);
    const after = await probe(page, '[role="dialog"]');
    return { route: "/community/post-2", closed, open, openSettled, after };
  },

  // Sheets over Find with the keyboard already up and NO new
  // keyboardWillShow (the reported bug's class): Find's search box
  // focused, keyboard open, then Filters (FindRoundModal) opens, then
  // "Playing somewhere else" stacks LocationPicker on it.
  async "picker-over-find"(page, base, kb, shot) {
    await gotoRoute(page, base, "/find");
    await focus(page, 'input[type="search"]');
    await kbShow(page, kb);
    await settle(page);
    const closed = await probe(page, 'input[type="search"]');
    await jsClick(page, "button", "^filters\\b");
    await frames(page, 2);
    const open = await probe(page, '[role="dialog"]');
    await settle(page, 700);
    const openSettled = await probe(page, '[role="dialog"]');
    await shot("open");
    await jsClick(page, '[role="dialog"] button', "somewhere else|^\\s*change\\s*$");
    await frames(page, 2);
    const pickerOpen = await probe(page, '[role="dialog"]');
    await settle(page, 700);
    const pickerSettled = await probe(page, '[role="dialog"]');
    await shot("picker");
    await kbHide(page);
    await settle(page, 700);
    const after = await probe(page, '[role="dialog"]');
    return { route: "/find", closed, open, openSettled, pickerOpen, pickerSettled, after };
  },

  // PostDetail's docking comment composer.
  async "postdetail-dock"(page, base, kb, shot) {
    await gotoRoute(page, base, "/community/post-1");
    await focus(page, "#comment-composer-input");
    const closed = await probe(page, "#comment-composer-input");
    await kbShow(page, kb);
    await frames(page, 2);
    const open = await probe(page, "#comment-composer-input");
    await settle(page);
    const openSettled = await probe(page, "#comment-composer-input");
    await shot("open");
    await kbHide(page);
    await settle(page);
    const after = await probe(page, "#comment-composer-input");
    return { route: "/community/post-1", closed, open, openSettled, after };
  },

  // Round group chat's docking composer.
  async "roundchat-dock"(page, base, kb, shot) {
    const href = "/messages/round/call-7";
    await gotoRoute(page, base, href);
    const subject = '[data-keyboard-drag-dismiss="off"] textarea, [data-keyboard-drag-dismiss="off"] input';
    await focus(page, subject);
    const closed = await probe(page, subject);
    await kbShow(page, kb);
    await frames(page, 2);
    const open = await probe(page, subject);
    await settle(page);
    const openSettled = await probe(page, subject);
    await shot("open");
    await kbHide(page);
    await settle(page);
    const after = await probe(page, subject);
    return { route: href, closed, open, openSettled, after };
  },

  // Host a Round step 1, "Playing area > Edit" field (low on the page): the
  // page-level reveal (useRevealFocusedFieldAboveKeyboard) scrolls it above
  // the keyboard.
  async "host-area-reveal"(page, base, kb, shot) {
    await openHostForm(page, base);
    const subject = 'input[maxlength="80"]';
    await focus(page, subject);
    await page.evaluate(() => window.scrollTo(0, 0));
    await frames(page, 2);
    const closed = await probe(page, subject);
    await kbShow(page, kb);
    await settle(page);
    const open = await probe(page, subject);
    await shot("open");
    await kbHide(page);
    await settle(page);
    const after = await probe(page, subject);
    return { route: "/golf-calls/new", closed, open, after };
  },

  // Drag-to-dismiss (useDismissKeyboardOnDrag) on a normal page: a real
  // touch drag outside the focused field blurs it.
  async "drag-dismiss"(page, base, kb) {
    await openHostForm(page, base);
    await focus(page, 'input[maxlength="80"]');
    await kbShow(page, kb);
    await settle(page);
    const closed = await probe(page);
    const cdp = await page.context().newCDPSession(page);
    // Start on the page heading: plain page content, outside the field and
    // any drag-dismiss opt-out (CourseAutocomplete's panel).
    const { x, y0 } = await page.evaluate(() => {
      const r = window.__kbPick("h1, h2").getBoundingClientRect();
      return { x: Math.round(r.left + 10), y0: Math.round(r.top + r.height / 2) };
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 - i * 8 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await frames(page, 2);
    const open = await probe(page);
    await kbHide(page);
    await settle(page);
    const after = await probe(page);
    return { route: "/golf-calls/new", closed, open, after, blurredByDrag: closed.focused !== open.focused };
  },
};

// ---------------------------------------------------------------------------
function printDiff(beforeFile, afterFile) {
  const before = JSON.parse(fs.readFileSync(beforeFile, "utf8"));
  const after = JSON.parse(fs.readFileSync(afterFile, "utf8"));
  const keys = ["coveredPx", "top", "bottom", "scrollY", "pageLocked", "bottomNavVisible", "focused", "sheetOverlayPaddingBottom", "listeners"];
  for (const id of Object.keys(after.results)) {
    const a = after.results[id];
    const b = before.results[id];
    console.log(`\n== ${id}`);
    if (!b) {
      console.log("  (not in before)");
      continue;
    }
    if (a.error || b.error) {
      console.log(`  before error: ${b.error ?? "-"}\n  after error:  ${a.error ?? "-"}`);
      continue;
    }
    for (const phase of Object.keys(a)) {
      if (!a[phase] || typeof a[phase] !== "object" || !("kb" in a[phase])) continue;
      for (const k of keys) {
        const bv = JSON.stringify(b[phase]?.[k]);
        const av = JSON.stringify(a[phase][k]);
        if (bv !== av) console.log(`  ${phase}.${k}: ${bv} -> ${av}`);
      }
    }
    for (const k of Object.keys(a)) {
      if (typeof a[k] !== "object" && a[k] !== b[k]) console.log(`  ${k}: ${JSON.stringify(b[k])} -> ${JSON.stringify(a[k])}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.diff) {
    printDiff(args.diff, args._[0]);
    return;
  }
  if (args.screens === "list") {
    console.log(Object.keys(SCREENS).join("\n"));
    return;
  }
  const root = path.resolve(args.root ?? repoRoot);
  const label = args.label ?? "run";
  const out = path.resolve(args.out ?? path.join(os.tmpdir(), "golfme-fake-keyboard"));
  const port = Number(args.port ?? 5288);
  const screens = args.screens ? String(args.screens).split(",") : Object.keys(SCREENS);
  const viewports = String(args.viewports ?? "375x667,390x844").split(",");
  fs.mkdirSync(out, { recursive: true });

  // Dummy backend: process env wins over any .env file Vite would load.
  process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
  process.env.VITE_SUPABASE_ANON_KEY = "dummy-anon-key";
  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
    cacheDir: path.join(os.tmpdir(), `golfme-fake-keyboard-vite-${port}`),
    // node_modules may be a symlink into another checkout.
    server: { port, strictPort: true, host: "127.0.0.1", hmr: false, fs: { allow: [root, path.dirname(fs.realpathSync(path.join(root, "node_modules")))] } },
    logLevel: "error",
  });
  await server.listen();
  const base = `http://127.0.0.1:${port}`;

  const executablePath = (() => {
    const cache = path.join(os.homedir(), ".cache", "ms-playwright");
    const dir = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop() : null;
    if (!dir) return undefined;
    const sub = fs.readdirSync(path.join(cache, dir)).find((d) => d.startsWith("chrome-"));
    return sub ? path.join(cache, dir, sub, "chrome-headless-shell") : undefined;
  })();
  // WSL without Chrome's system libs: an extracted lib root (libnspr4 etc.).
  const libRoot = [process.env.GOLFME_CHROMIUM_LIBS, path.join(os.homedir(), ".cache", "golfme-chromium-libs", "root")].find((d) => d && fs.existsSync(d));
  const env = { ...process.env };
  if (libRoot) env.LD_LIBRARY_PATH = [path.join(libRoot, "usr/lib/x86_64-linux-gnu"), path.join(libRoot, "lib/x86_64-linux-gnu"), env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  const browser = await chromium.launch({ headless: true, executablePath, env });
  const results = {};
  try {
    for (const vp of viewports) {
      const [width, height] = vp.split("x").map(Number);
      const kb = Number(args.kb ?? DEFAULT_KB[vp] ?? 300);
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: "reduce" });
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1" && url.port === String(port)) return route.continue();
        if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
        return route.abort();
      });
      await context.addInitScript(fakeNativeBridge);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text().slice(0, 200));
      });
      await page.goto(`${base}/login?demo`, { waitUntil: "load" });
      await page.getByText("Try Demo Account").click();
      await page.waitForURL(`${base}/`);
      await settle(page, 800);
      if (args.inspect) {
        // --inspect /route[,/route2]: list links, buttons and fields there
        // (for writing a new screen).
        for (const route of String(args.inspect).split(",")) {
          await gotoRoute(page, base, route);
          const found = await page.evaluate(() => ({
            path: window.location.pathname,
            links: Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")).slice(0, 40),
            buttons: Array.from(document.querySelectorAll("button")).map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 40)).filter(Boolean).slice(0, 60),
            fields: Array.from(document.querySelectorAll("input, textarea, [contenteditable=true]")).map((f) => `${f.tagName.toLowerCase()}[${f.getAttribute("type") ?? ""}] ${f.getAttribute("placeholder") ?? ""}`.trim()),
          }));
          console.log(JSON.stringify(found, null, 1));
        }
        await context.close();
        continue;
      }
      for (const name of screens) {
        const run = SCREENS[name];
        const id = `${name}@${vp}`;
        if (!run) {
          results[id] = { error: "unknown screen" };
          continue;
        }
        // Each screen starts with the keyboard closed and nothing focused.
        await page.evaluate(() => {
          if (window.__kb.height > 0) window.__kb.hide();
          document.activeElement?.blur?.();
        });
        await settle(page, 300);
        const shot = (phase) => page.screenshot({ path: path.join(out, `${label}-${name}-${vp}-${phase}.png`) });
        errors.length = 0;
        try {
          results[id] = { kbHeight: kb, ...(await run(page, base, kb, shot)) };
        } catch (e) {
          results[id] = { error: String(e).split("\n")[0] };
          await shot("error").catch(() => {});
        }
        const relevant = errors.filter((e) => !/Failed to load resource|net::ERR|127\.0\.0\.1:9|not implemented on ios/i.test(e));
        if (relevant.length) results[id].consoleErrors = relevant.slice(0, 5);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const file = path.join(out, `${label}.json`);
  fs.writeFileSync(file, JSON.stringify({ label, root, results }, null, 2));
  for (const [id, r] of Object.entries(results)) {
    if (r.error) {
      console.log(`${id}: ERROR ${r.error}`);
      continue;
    }
    const phases = Object.keys(r).filter((p) => r[p] && typeof r[p] === "object" && "kb" in r[p]);
    const line = phases.map((p) => `${p}: covered=${r[p].coveredPx} bottom=${r[p].bottom} kbTop=${r[p].kbTop} scrollY=${r[p].scrollY} lock=${r[p].pageLocked} nav=${r[p].bottomNavVisible} pad=${r[p].sheetOverlayPaddingBottom}`).join(" | ");
    console.log(`${id}${r.blurredByDrag !== undefined ? ` blurredByDrag=${r.blurredByDrag}` : ""}\n  ${line}\n  listeners(open)=${JSON.stringify((r.open ?? r.closed).listeners)}`);
  }
  console.log(`\nwrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
