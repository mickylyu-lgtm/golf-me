// Run: node --test tests/chatMediaPicker.test.ts  (built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createChatMediaPicker,
  fileFromNativeResult,
  unreadablePickFile,
  type ChatMediaKind,
  type ChatMediaPickerDriver,
  type NativePickResult,
} from "../src/lib/chatMediaPicker.ts";

// "GolfMe" as base64, standing in for JPEG bytes.
const BYTES_B64 = Buffer.from("GolfMe").toString("base64");

function fakeDriver(native: boolean, respond: () => Promise<NativePickResult> = () => Promise.resolve({ cancelled: true })) {
  const calls: (readonly ChatMediaKind[])[] = [];
  const driver: ChatMediaPickerDriver = {
    nativeAvailable: () => native,
    pickNative: (kinds) => {
      calls.push(kinds);
      return respond();
    },
  };
  return { driver, calls };
}

function harness() {
  const opened: number[] = [];
  const picked: File[] = [];
  return {
    opened,
    picked,
    options: { openFileInput: () => opened.push(1), onPicked: (f: File) => picked.push(f) },
  };
}

test("web: opens the file input synchronously, inside the tap, and never calls native", async () => {
  const { driver, calls } = fakeDriver(false);
  const pick = createChatMediaPicker(driver);
  const h = harness();
  const pending = pick(h.options);
  // Before any await: a file input only opens from a user gesture.
  assert.equal(h.opened.length, 1);
  assert.equal(await pending, "web");
  assert.equal(calls.length, 0);
  assert.equal(h.picked.length, 0);
});

test("web: a driver that throws on the availability check falls back to the file input", async () => {
  const driver: ChatMediaPickerDriver = {
    nativeAvailable: () => {
      throw new Error("no bridge");
    },
    pickNative: () => Promise.reject(new Error("unreachable")),
  };
  const h = harness();
  assert.equal(await createChatMediaPicker(driver)(h.options), "web");
  assert.equal(h.opened.length, 1);
});

test("native: a picked photo goes on as a File with its bytes and type; the file input stays closed", async () => {
  const { driver, calls } = fakeDriver(true, () => Promise.resolve({ kind: "image", mimeType: "image/jpeg", base64: BYTES_B64 }));
  const h = harness();
  assert.equal(await createChatMediaPicker(driver)(h.options), "native");
  assert.equal(h.opened.length, 0);
  assert.deepEqual(calls, [["image"]]);
  assert.equal(h.picked.length, 1);
  const file = h.picked[0];
  assert.ok(file instanceof File);
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.name, "photo.jpg");
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), "GolfMe");
});

test("native: kinds are passed through (video later)", async () => {
  const { driver, calls } = fakeDriver(true);
  const h = harness();
  await createChatMediaPicker(driver)({ ...h.options, kinds: ["image", "video"] });
  assert.deepEqual(calls, [["image", "video"]]);
});

test("native: cancel picks nothing and shows nothing", async () => {
  const { driver } = fakeDriver(true, () => Promise.resolve({ cancelled: true }));
  const h = harness();
  assert.equal(await createChatMediaPicker(driver)(h.options), "cancelled");
  assert.equal(h.picked.length, 0);
  assert.equal(h.opened.length, 0);
});

test("native: an error hands on an unreadable file (the page's usual toast), not the file input", async () => {
  const { driver } = fakeDriver(true, () => Promise.reject(Object.assign(new Error("That photo can't be read."), { code: "unreadable" })));
  const h = harness();
  assert.equal(await createChatMediaPicker(driver)(h.options), "failed");
  assert.equal(h.opened.length, 0);
  assert.equal(h.picked.length, 1);
  assert.equal(h.picked[0].size, 0);
  assert.equal(h.picked[0].type, "image/jpeg");
});

test("native: a malformed result is also handed on as unreadable", async () => {
  const { driver } = fakeDriver(true, () => Promise.resolve({ kind: "image", mimeType: "image/jpeg", base64: "" }));
  const h = harness();
  assert.equal(await createChatMediaPicker(driver)(h.options), "failed");
  assert.equal(h.picked.length, 1);
  assert.equal(h.picked[0].size, 0);
});

test("native: 'in_progress' from the plugin is ignored silently", async () => {
  const { driver } = fakeDriver(true, () => Promise.reject(Object.assign(new Error("open"), { code: "in_progress" })));
  const h = harness();
  assert.equal(await createChatMediaPicker(driver)(h.options), "busy");
  assert.equal(h.picked.length, 0);
});

test("native: a second tap while the picker is up is ignored; after it settles, taps work again", async () => {
  let settle: (r: NativePickResult) => void = () => {};
  const { driver, calls } = fakeDriver(true, () => new Promise((resolve) => (settle = resolve)));
  const pick = createChatMediaPicker(driver);
  const h = harness();
  const first = pick(h.options);
  assert.equal(await pick(h.options), "busy");
  assert.equal(calls.length, 1);
  settle({ cancelled: true });
  assert.equal(await first, "cancelled");
  const third = pick(h.options);
  settle({ kind: "image", mimeType: "image/jpeg", base64: BYTES_B64 });
  assert.equal(await third, "native");
  assert.equal(calls.length, 2);
});

test("fileFromNativeResult: only images with a real image type and bytes", () => {
  assert.equal(fileFromNativeResult({ kind: "video", mimeType: "video/mp4", base64: BYTES_B64 }), null);
  assert.equal(fileFromNativeResult({ kind: "image", mimeType: "text/html", base64: BYTES_B64 }), null);
  assert.equal(fileFromNativeResult({ kind: "image", base64: BYTES_B64 }), null);
  assert.equal(fileFromNativeResult({ kind: "image", mimeType: "image/jpeg", base64: "%%%not base64%%%" }), null);
  assert.equal(fileFromNativeResult({ kind: "image", mimeType: "image/png", base64: BYTES_B64 })?.name, "photo.png");
});

test("unreadablePickFile: an empty JPEG-typed file", () => {
  const f = unreadablePickFile();
  assert.equal(f.size, 0);
  assert.equal(f.type, "image/jpeg");
});
