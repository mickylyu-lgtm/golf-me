import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const js = ts.transpileModule(readFileSync(new URL("../src/pages/CourseDetail.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness() {
  const jsx = require("react/jsx-runtime").jsx;
  let courseId = "sample-a";
  let routeKey = "page-1";
  let state: any = null;
  let isDemo = false;
  let slots: any[] = [];
  let effects: { deps: any[]; cleanup?: () => void }[] = [];
  let pending: (() => void)[] = [];
  let cursor = 0;
  let effectCursor = 0;
  let key: string | null = null;
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  const timerScope = {
    setTimeout(fn: () => void, ms: number) { assert.equal(ms, 12_000); const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  };
  const requests: { id: string; signal?: AbortSignal; resolve: (answer: any) => void; reject: (reason: Error) => void }[] = [];
  const navigate: unknown[][] = [];
  const mod: any = { exports: {} };
  new Function("require", "exports", "window", js)((id: string) => {
    if (id === "react") return {
      useState(value: unknown) {
        const idx = cursor++;
        if (!(idx in slots)) slots[idx] = value;
        const bank = slots;
        return [bank[idx], (next: any) => { bank[idx] = typeof next === "function" ? next(bank[idx]) : next; }];
      },
      useEffect(run: () => (() => void) | undefined, deps: any[]) {
        const idx = effectCursor++;
        const previous = effects[idx];
        if (previous?.deps.every((v, i) => Object.is(v, deps[i]))) return;
        pending.push(() => { previous?.cleanup?.(); effects[idx] = { deps, cleanup: run() }; });
      },
    };
    if (id === "react-router-dom") return {
      useParams: () => ({ courseId }), useLocation: () => ({ state, key: routeKey }),
      useNavigate: () => (...args: unknown[]) => navigate.push(args),
      Navigate: ({ to }: { to: string }) => jsx("div", { "data-redirect": to }),
    };
    if (id.includes("LocaleContext")) return { useLocale: () => ({ t: (key: string) => key }) };
    if (id.includes("AuthContext")) return { useAuth: () => ({ isDemo }) };
    if (id.includes("supabase")) return { supabase: { from(table: string) {
      assert.equal(table, "courses");
      let id: string, signal: AbortSignal | undefined;
      const query = {
        select() { return query; },
        eq(col: string, value: string) { assert.equal(col, "id"); id = value; return query; },
        abortSignal(s: AbortSignal) { signal = s; return query; },
        maybeSingle() { return new Promise((resolve, reject) => { requests.push({ id, signal, resolve, reject }); }); },
      };
      return query;
    } } };
    if (id.includes("CourseDetailContent")) return { CourseDetailContent: ({ course }: any) => jsx("h1", { children: course.name }) };
    if (id.includes("GolfMeLoader")) return { GolfMeLoader: () => jsx("div", { "data-spinner": "true" }) };
    if (id.includes("goBack")) return { goBack: (fn: (...args: unknown[]) => void, path: string) => fn(path) };
    if (id.includes("roundCourseLink")) return require("../src/lib/roundCourseLink.ts");
    return require(id);
  }, mod.exports, timerScope);

  function render() {
    cursor = 0;
    effectCursor = 0;
    pending = [];
    const wrapper = mod.exports.CourseDetail();
    let element = wrapper;
    if (wrapper.type?.name === "CourseDetailPage") {
      if (key !== wrapper.key) {
        for (const e of effects) e.cleanup?.();
        slots = [];
        effects = [];
        key = wrapper.key;
      }
      element = wrapper.type(wrapper.props);
    }
    for (const run of pending) run();
    return element;
  }

  const html = () => renderToStaticMarkup(render());
  function click(label: string) {
    function walk(e: any): any {
      if (!e || typeof e !== "object") return null;
      if (Array.isArray(e)) return e.map(walk).find(Boolean);
      if (e.type === "button" && [e.props.children].flat().includes(label)) return e;
      return walk(e.props?.children);
    }
    const button = walk(render());
    assert.ok(button, label);
    button.props.onClick();
  }
  return {
    html, click, requests, navigate, timers,
    advanceDeadline() { for (const [key, fn] of timers) { timers.delete(key); fn(); } },
    route(id: string, nextKey: string, nextState: any = null, demo = false) {
      courseId = id; routeKey = nextKey; state = nextState; isDemo = demo;
    },
  };
}

const response = (id: string, name: string) => ({
  data: { id, name, city: "Sample City", region: "NY", country: "US", latitude: 40, longitude: -74 },
  error: null,
});
const flush = async () => { await new Promise<void>((resolve) => setImmediate(resolve)); };
const roundId = "28a4d5fd-6436-4e3c-9f3c-7ebc99448ab4";

test("course link remains escapable and retries a hung read; an old result cannot replace the retry", async () => {
  const h = harness();
  h.route("sample-a", "round-link", { fromRoundId: roundId });
  assert.match(h.html(), /data-spinner/);
  h.click("common.back");
  assert.deepEqual(h.navigate, [[`/golf-calls/${roundId}`]]);
  h.advanceDeadline();
  assert.match(h.html(), /coursePage.unavailable.*loading.retry/);
  assert.doesNotMatch(h.html(), /data-spinner/);
  assert.equal(h.requests[0].signal?.aborted, true);
  h.click("loading.retry");
  assert.match(h.html(), /data-spinner/);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(response("sample-a", "Fresh Course A"));
  await flush();
  h.requests[0].resolve(response("sample-a", "Stale Course A"));
  await flush();
  assert.match(h.html(), /Fresh Course A/);
  assert.doesNotMatch(h.html(), /Stale Course A/);
  assert.equal(h.timers.size, 0);
});

test("new course navigation cancels the old read and never shows the previous course/actions", async () => {
  const h = harness();
  h.html();
  h.route("sample-b", "page-2", { course: { id: "sample-a", name: "Wrong handoff" } });
  assert.match(h.html(), /data-spinner/);
  assert.equal(h.requests[0].signal?.aborted, true);
  assert.equal(h.requests[1].id, "sample-b");
  h.requests[1].resolve(response("sample-b", "Course B"));
  h.requests[0].resolve(response("sample-a", "Late Course A"));
  await flush();
  assert.match(h.html(), /Course B/);
  assert.doesNotMatch(h.html(), /Course A|Wrong handoff/);
});

test("temporary rejection is retryable; true misses keep nearby redirect or originating round Back", async () => {
  const h = harness();
  h.html();
  h.requests[0].reject(new Error("offline"));
  await flush();
  assert.match(h.html(), /loading.retry/);
  assert.doesNotMatch(h.html(), /data-redirect/);
  h.click("loading.retry");
  h.html();
  h.requests[1].resolve({ data: null, error: null });
  await flush();
  assert.match(h.html(), /data-redirect="\/courses\/nearby"/);
  h.route("sample-c", "page-3", { fromRoundId: roundId });
  h.html();
  h.requests[2].resolve({ data: null, error: null });
  await flush();
  assert.match(h.html(), /coursePage.unavailable/);
  assert.doesNotMatch(h.html(), /data-redirect|loading.retry/);
});

test("matching search handoffs, including no-ID demo venues, render without a lookup", () => {
  const h = harness();
  h.route("sample-b", "page-2", { course: { id: "sample-b", name: "Course B" } });
  assert.match(h.html(), /Course B/);
  h.route("demo", "page-3", { course: { name: "Demo Links" } }, true);
  assert.match(h.html(), /Demo Links/);
  h.route("demo", "page-4", { course: { name: "Another Demo Links" } }, true);
  assert.match(h.html(), /Another Demo Links/);
  assert.equal(h.requests.length, 0);
});
