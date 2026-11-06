// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { KeyboardStyle } from "@capacitor/keyboard";
import { keyboardStyleFor, nativeAppearanceFor, syncNativeAppearance } from "../src/lib/nativeAppearance.ts";

test("the native shell gets the setting, never the resolved scheme", () => {
  // Match iPhone stays "system": the window override would otherwise change
  // what prefers-color-scheme reports and Match iPhone would follow itself.
  assert.equal(nativeAppearanceFor("system", false), "system");
  assert.equal(nativeAppearanceFor("dark", false), "dark");
  assert.equal(nativeAppearanceFor("light", false), "light");
});

test("a forced-light screen (landing) wins over the setting", () => {
  assert.equal(nativeAppearanceFor("dark", true), "light");
  assert.equal(nativeAppearanceFor("system", true), "light");
});

test("keyboard style follows the appearance", () => {
  assert.equal(keyboardStyleFor("dark"), KeyboardStyle.Dark);
  assert.equal(keyboardStyleFor("light"), KeyboardStyle.Light);
  assert.equal(keyboardStyleFor("system"), KeyboardStyle.Default);
});

test("off the native app it does nothing and never throws", () => {
  assert.doesNotThrow(() => syncNativeAppearance("dark"));
  assert.doesNotThrow(() => syncNativeAppearance("system"));
});

test("the plugin name matches the native jsName", () => {
  const swift = fs.readFileSync(new URL("../ios/App/App/AppleSignInPlugin.swift", import.meta.url), "utf8");
  assert.match(swift, /jsName = "GolfMeAppearance"/);
  assert.match(swift, /registerPluginInstance\(GolfMeAppearancePlugin\(\)\)/);
  for (const value of ["light", "dark", "system"]) assert.match(swift, new RegExp(`case "${value}"`));
  const ts = fs.readFileSync(new URL("../src/lib/nativeAppearance.ts", import.meta.url), "utf8");
  assert.match(ts, /registerPlugin<GolfMeAppearancePlugin>\("GolfMeAppearance"\)/);
  assert.match(ts, /isPluginAvailable\("GolfMeAppearance"\)/);
});
