import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { jsx, jsxs } from "react/jsx-runtime";
import { clearOnboardingDraft, optionalHandicap } from "../src/lib/onboardingDraft.ts";
import type { OnboardingDraft } from "../src/lib/onboardingDraft.ts";

const component = ts.transpileModule(
  readFileSync(new URL("../src/pages/ProfileSetup.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
const readyDraft: OnboardingDraft = {
  name: "Synthetic Golfer", is18Plus: true, areaLabel: "Synthetic Town", handicap: "",
};
type Element = { props: Record<string, any> };
function find(node: unknown, match: (props: Element["props"]) => boolean): Element | undefined {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, match) ?? [])[0];
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as Element;
  return match(element.props) ? element : find(element.props.children, match);
}

// Execute the real ProfileSetup render, input handlers and Continue action,
// with only hooks, clock and outbound persistence mocked. No real accounts.
function setup(
  isDemo: boolean,
  draft: OnboardingDraft | null,
  existingHandicap: number | null = null,
  clearDraft = () => {},
) {
  const states: unknown[] = [];
  const writes: Record<string, unknown>[] = [];
  const navigation: string[] = [];
  const timers: (() => void)[] = [];
  let index = 0;
  const nop = () => {};
  const value = () => "";
  const write = (patch: Record<string, unknown>) => { writes.push(patch); };
  const resolve = (id: string) => {
    switch (id) {
      case "react/jsx-runtime": return { jsx, jsxs };
      case "react": return {
        useEffect: nop, useLayoutEffect: nop, useRef: () => ({ current: null }),
        useState: (initial: unknown) => {
          const i = index++;
          if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
          return [states[i], (next: unknown) => { states[i] = typeof next === "function" ? next(states[i]) : next; }];
        },
      };
      case "react-router-dom": return { useNavigate: () => (path: string) => navigation.push(path) };
      case "../context/DataContext": return { useData: () => ({ signUpNewGolfer: write }) };
      case "../context/AuthContext": return {
        useAuth: () => ({ isDemo, profileRow: { handicap: existingHandicap, vibes: [], budget_min: 0, budget_max: 0 }, saveProfile: write }),
      };
      case "../context/ToastContext": return { useToast: () => ({ showToast: nop }) };
      case "../i18n/LocaleContext": return { useLocale: () => ({ t: (key: string) => key }) };
      case "../lib/onboardingDraft": return { loadOnboardingDraft: () => draft, optionalHandicap, clearOnboardingDraft: clearDraft };
      case "../lib/useKeyboardHeight": return { useKeyboardHeight: () => 0 };
      case "../lib/providerPhoto": return { providerPhotoUrl: nop };
      default: return new Proxy({}, { get: () => value });
    }
  };
  const exports: { ProfileSetup?: () => Element } = {};
  new Function("require", "exports", "setTimeout", component)(resolve, exports, (task: () => void) => timers.push(task));
  return {
    writes,
    navigation,
    runTimers() { for (const task of timers.splice(0)) task(); },
    render() {
      index = 0;
      const view = exports.ProfileSetup!();
      const input = find(view, (p) => p.id === "profile-setup-handicap")?.props;
      const next = find(view, (p) => p.children === "common.continue")?.props;
      assert.ok(input);
      assert.ok(next);
      return { input, next };
    },
  };
}

test("a brand-new profile shows a blank text-labeled numeric input", () => {
  const { input } = setup(false, null).render();
  assert.equal(input.type, "number");
  assert.equal(input.value, "");
  assert.equal(input.placeholder, "profile.noHandicapYet");
  assert.equal(input.required, undefined);
});

for (const isDemo of [false, true]) {
  test(`${isDemo ? "demo" : "real"} signup leaves blank null and saves a typed 15`, async () => {
    for (const [changes, saved] of [[[], null], [[15], 15], [[15, ""], null], [[0], 0]] as const) {
      const page = setup(isDemo, readyDraft);
      assert.equal(page.render().next.disabled, false, "handicap isn't required to Continue");
      for (const value of changes) {
        page.render().input.onChange({ target: { value: String(value), valueAsNumber: value === "" ? NaN : value } });
      }
      await page.render().next.onClick();
      assert.equal(page.writes.length, 1);
      assert.equal(page.writes[0].handicap, saved);
    }
  });
}

test("a blank signup draft does not overwrite a handicap already on an unfinished profile", async () => {
  const page = setup(false, readyDraft, 15);
  await page.render().next.onClick();
  assert.equal(page.writes.length, 1);
  assert.equal(Object.hasOwn(page.writes[0], "handicap"), false);
});

test("successful Quick Profile still reaches Ready when local draft cleanup is denied", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let removals = 0;
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      location: { pathname: "/profile-setup" },
      localStorage: { removeItem() { removals++; throw new DOMException("Blocked", "SecurityError"); } },
    } });
    const page = setup(false, readyDraft, null, clearOnboardingDraft);
    await page.render().next.onClick();
    assert.equal(page.writes.length, 1);
    assert.equal(page.writes[0].has_onboarded, true);
    assert.equal(removals, 1);
    page.runTimers();
    assert.deepEqual(page.navigation, ["/ready"]);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
