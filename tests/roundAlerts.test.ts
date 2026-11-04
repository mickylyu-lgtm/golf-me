// Run: npm run test:trust  (node --test, built-in type stripping)
// "Notify me" on an empty round search = the existing new-round alerts
// (profiles.notify_new_rounds). Every state the card can show, plus the
// enable flow: success only after the save resolves, push asked only when
// iOS is still undecided, never on web or demo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertRadiusMiles, deriveRoundAlertState, enableRoundAlerts } from "../src/lib/roundAlerts.ts";
import type { PushPermission, RoundAlertInputs } from "../src/lib/roundAlerts.ts";

const base: RoundAlertInputs = {
  isDemo: false,
  hasHomeArea: true,
  notifyOn: false,
  pushEnabled: true,
  native: true,
  permission: "granted",
  saving: false,
  saveFailed: false,
};
const state = (patch: Partial<RoundAlertInputs>) => deriveRoundAlertState({ ...base, ...patch });

test("no home area: says so instead of claiming alerts, whatever the switch says", () => {
  assert.equal(state({ hasHomeArea: false }), "noHomeArea");
  assert.equal(state({ hasHomeArea: false, notifyOn: true }), "noHomeArea");
  assert.equal(state({ hasHomeArea: false, isDemo: true, notifyOn: true }), "noHomeArea");
});

test("off -> tap to turn on; saving; save failed -> retry", () => {
  assert.equal(state({ notifyOn: false }), "off");
  assert.equal(state({ saving: true }), "saving");
  assert.equal(state({ saveFailed: true }), "saveFailed");
  // Once the switch is actually on, an old failure no longer matters.
  assert.equal(state({ notifyOn: true, saveFailed: true }), "onPush");
});

test("already on: the delivery line depends on platform and push", () => {
  assert.equal(state({ notifyOn: true, native: false, permission: "denied" }), "onWeb");
  assert.equal(state({ notifyOn: true, pushEnabled: false }), "onPushOff");
  assert.equal(state({ notifyOn: true, permission: null }), "onChecking");
  assert.equal(state({ notifyOn: true, permission: "granted" }), "onPush");
  assert.equal(state({ notifyOn: true, permission: "denied" }), "onPushDenied");
  assert.equal(state({ notifyOn: true, permission: "prompt" }), "onPushPrompt");
  assert.equal(state({ notifyOn: true, permission: "unavailable" }), "onInApp");
});

test("demo: local-only, never claims push", () => {
  assert.equal(state({ isDemo: true, notifyOn: true }), "onDemo");
  assert.equal(state({ isDemo: true, notifyOn: false }), "off");
});

test("radius mirrors the fan-out rule: <=0 -> 25, capped at 100", () => {
  assert.equal(alertRadiusMiles(10), 10);
  assert.equal(alertRadiusMiles(0), 25);
  assert.equal(alertRadiusMiles(-5), 25);
  assert.equal(alertRadiusMiles(undefined), 25);
  assert.equal(alertRadiusMiles(Number.NaN), 25);
  assert.equal(alertRadiusMiles(150), 100);
});

function deps(overrides: { isDemo?: boolean; native?: boolean; pushEnabled?: boolean; save?: () => Promise<void>; permissions?: PushPermission[] } = {}) {
  const calls: string[] = [];
  const permissions = [...(overrides.permissions ?? ["granted"])];
  return {
    calls,
    deps: {
      isDemo: overrides.isDemo ?? false,
      native: overrides.native ?? true,
      pushEnabled: overrides.pushEnabled ?? true,
      save:
        overrides.save ??
        (async () => {
          calls.push("save");
        }),
      checkPermission: async () => {
        calls.push("check");
        return permissions.length > 1 ? (permissions.shift() as PushPermission) : permissions[0];
      },
      requestPush: async () => {
        calls.push("request");
      },
    },
  };
}

test("save failure: not ok, no push prompt, nothing claimed", async () => {
  const { deps: d, calls } = deps({
    save: async () => {
      calls.push("save");
      throw new Error("network");
    },
    permissions: ["prompt"],
  });
  const result = await enableRoundAlerts(d);
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["save"]);
});

test("success is reported only after the save resolves", async () => {
  let resolveSave: () => void = () => {};
  let settled = false;
  const { deps: d } = deps({ save: () => new Promise<void>((r) => (resolveSave = r)) });
  const pending = enableRoundAlerts(d).then((r) => {
    settled = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(settled, false);
  resolveSave();
  assert.equal((await pending).ok, true);
});

test("native + permission 'prompt': asks for push once, then re-reads permission", async () => {
  const { deps: d, calls } = deps({ permissions: ["prompt", "granted"] });
  const result = await enableRoundAlerts(d);
  assert.deepEqual(calls, ["save", "check", "request", "check"]);
  assert.deepEqual(result, { ok: true, permission: "granted" });
});

test("native + already granted or denied: never re-prompts", async () => {
  for (const p of ["granted", "denied", "unavailable"] as PushPermission[]) {
    const { deps: d, calls } = deps({ permissions: [p] });
    const result = await enableRoundAlerts(d);
    assert.deepEqual(calls, ["save", "check"], p);
    assert.deepEqual(result, { ok: true, permission: p });
  }
});

test("web: saves, never touches push", async () => {
  const { deps: d, calls } = deps({ native: false, permissions: ["prompt"] });
  assert.deepEqual(await enableRoundAlerts(d), { ok: true, permission: null });
  assert.deepEqual(calls, ["save"]);
});

test("push turned off in Settings: saves, does not prompt", async () => {
  const { deps: d, calls } = deps({ pushEnabled: false, permissions: ["prompt"] });
  assert.deepEqual(await enableRoundAlerts(d), { ok: true, permission: null });
  assert.deepEqual(calls, ["save"]);
});

test("demo: local save only, never asks for push", async () => {
  const { deps: d, calls } = deps({ isDemo: true, permissions: ["prompt"] });
  assert.deepEqual(await enableRoundAlerts(d), { ok: true, permission: null });
  assert.deepEqual(calls, ["save"]);
});
