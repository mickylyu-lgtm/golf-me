// Run: node --test tests/mediaPicker.test.ts  (built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capabilitiesFromMethods,
  createMediaPicker,
  fileFromNativeResult,
  isInMemoryPick,
  readNativeVideo,
  unreadablePickFile,
  videoFileInfo,
  type MediaKind,
  type MediaPickerDriver,
  type NativeCapabilities,
  type NativeChunk,
  type NativePickResult,
} from "../src/lib/mediaPicker.ts";

// "GolfMe" as base64, standing in for JPEG bytes.
const BYTES_B64 = Buffer.from("GolfMe").toString("base64");

const WEB: NativeCapabilities = { kinds: [], multiple: false };
const BUILD_24 = capabilitiesFromMethods(["addListener", "removeListener", "removeAllListeners", "pick"]);
const BUILD_25 = capabilitiesFromMethods(["addListener", "removeListener", "removeAllListeners", "pick", "readChunk", "discard"]);

// A fake native file the driver serves through readChunk.
function fakeDriver(
  caps: NativeCapabilities,
  respond: () => Promise<NativePickResult> = () => Promise.resolve({ cancelled: true }),
  files: Record<string, Buffer> = {},
) {
  const calls: { kinds: readonly MediaKind[]; limit: number }[] = [];
  const reads: { path: string; offset: number; length: number }[] = [];
  const discarded: string[] = [];
  const driver: MediaPickerDriver = {
    capabilities: () => caps,
    pickNative: (kinds, limit) => {
      calls.push({ kinds, limit });
      return respond();
    },
    readChunk: (path, offset, length): Promise<NativeChunk> => {
      reads.push({ path, offset, length });
      const data = files[path];
      if (!data) return Promise.reject(Object.assign(new Error("Unknown file."), { code: "invalid_argument" }));
      const slice = data.subarray(offset, offset + length);
      return Promise.resolve({ base64: slice.toString("base64"), bytesRead: slice.length });
    },
    discard: (path) => {
      discarded.push(path);
      return Promise.resolve();
    },
  };
  return { driver, calls, reads, discarded };
}

function harness() {
  const opened: number[] = [];
  const picked: File[] = [];
  const loading: boolean[] = [];
  let tooLarge = 0;
  return {
    opened,
    picked,
    loading,
    tooLarge: () => tooLarge,
    options: {
      openFileInput: () => opened.push(1),
      onPicked: (f: File) => picked.push(f),
      onLoading: (l: boolean) => loading.push(l),
      onTooLarge: () => tooLarge++,
    },
  };
}

const VIDEO_PATH = "/var/mobile/Caches/GolfMeMediaPicks/pick-1.mov";

// ---- build detection ------------------------------------------------------

test("capabilities: 2.4 (pick only) is one photo; 2.5 (readChunk) is photos and videos, several at once", () => {
  assert.deepEqual(BUILD_24, { kinds: ["image"], multiple: false });
  assert.deepEqual(BUILD_25, { kinds: ["image", "video"], multiple: true });
  assert.deepEqual(capabilitiesFromMethods([]), { kinds: [], multiple: false });
});

// ---- branching ------------------------------------------------------------

test("web: opens the file input synchronously, inside the tap, and never calls native", async () => {
  const { driver, calls } = fakeDriver(WEB);
  const h = harness();
  const pending = createMediaPicker(driver).pickMedia(h.options);
  // Before any await: a file input only opens from a user gesture.
  assert.equal(h.opened.length, 1);
  assert.equal(await pending, "web");
  assert.equal(calls.length, 0);
  assert.equal(h.picked.length, 0);
});

test("web: a driver that throws on the capability check falls back to the file input", async () => {
  const { driver } = fakeDriver(WEB);
  driver.capabilities = () => {
    throw new Error("no bridge");
  };
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia(h.options), "web");
  assert.equal(h.opened.length, 1);
});

test("2.4 build: photos go native, videos fall back to the file input (synchronously)", async () => {
  const { driver, calls } = fakeDriver(BUILD_24, () => Promise.resolve({ kind: "image", mimeType: "image/jpeg", base64: BYTES_B64 }));
  const picker = createMediaPicker(driver);
  const h = harness();
  assert.equal(await picker.pickMedia(h.options), "native");
  assert.equal(h.opened.length, 0);

  const pending = picker.pickMedia({ ...h.options, kinds: ["video"] });
  assert.equal(h.opened.length, 1);
  assert.equal(await pending, "web");
  assert.equal(await picker.pickMedia({ ...h.options, kinds: ["image", "video"] }), "web");
  assert.equal(calls.length, 1);
});

test("2.4 build: several photos at once falls back to the (multiple) file input", async () => {
  const { driver, calls } = fakeDriver(BUILD_24);
  const h = harness();
  const files: File[][] = [];
  const out = await createMediaPicker(driver).pickMediaFiles({ ...h.options, limit: 5, onPicked: (f) => files.push(f) });
  assert.equal(out, "web");
  assert.equal(h.opened.length, 1);
  assert.equal(calls.length, 0);
});

test("2.5 build: photos and videos both go native; kinds and limit are passed through", async () => {
  const { driver, calls } = fakeDriver(BUILD_25);
  const picker = createMediaPicker(driver);
  const h = harness();
  assert.equal(await picker.pickMedia({ ...h.options, kinds: ["video"] }), "cancelled");
  assert.equal(await picker.pickMediaFiles({ ...h.options, kinds: ["image", "video"], limit: 25, onPicked: () => {} }), "cancelled");
  assert.equal(h.opened.length, 0);
  assert.deepEqual(calls, [
    { kinds: ["video"], limit: 1 },
    // Clamped to the native maximum.
    { kinds: ["image", "video"], limit: 10 },
  ]);
});

// ---- images ---------------------------------------------------------------

test("native photo: goes on as a File with its bytes and type; the file input stays closed", async () => {
  const { driver, calls } = fakeDriver(BUILD_25, () => Promise.resolve({ kind: "image", mimeType: "image/jpeg", base64: BYTES_B64 }));
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia(h.options), "native");
  assert.equal(h.opened.length, 0);
  assert.deepEqual(calls, [{ kinds: ["image"], limit: 1 }]);
  assert.equal(h.picked.length, 1);
  const file = h.picked[0];
  assert.ok(file instanceof File);
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.name, "photo.jpg");
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), "GolfMe");
  assert.deepEqual(h.loading, []);
});

test("native photo: the 2.5 shape (items + top level) gives the same single File", async () => {
  const item = { kind: "image" as const, mimeType: "image/jpeg", base64: BYTES_B64 };
  const { driver } = fakeDriver(BUILD_25, () => Promise.resolve({ ...item, items: [item] }));
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia(h.options), "native");
  assert.equal(h.picked.length, 1);
});

// ---- cancel / errors ------------------------------------------------------

test("native: cancel picks nothing and shows nothing", async () => {
  const { driver } = fakeDriver(BUILD_25, () => Promise.resolve({ cancelled: true }));
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia({ ...h.options, kinds: ["video"] }), "cancelled");
  assert.equal(h.picked.length, 0);
  assert.equal(h.opened.length, 0);
});

test("native photo: an error hands on an unreadable photo (the page's usual toast), not the file input", async () => {
  const { driver } = fakeDriver(BUILD_25, () => Promise.reject(Object.assign(new Error("That photo can't be read."), { code: "unreadable" })));
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia(h.options), "failed");
  assert.equal(h.opened.length, 0);
  assert.equal(h.picked.length, 1);
  assert.equal(h.picked[0].size, 0);
  assert.equal(h.picked[0].type, "image/jpeg");
});

test("native video: an error hands on an empty non-video file (the page's 'not a supported video' check)", async () => {
  const { driver } = fakeDriver(BUILD_25, () => Promise.reject(Object.assign(new Error("x"), { code: "unreadable" })));
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia({ ...h.options, kinds: ["video"] }), "failed");
  assert.equal(h.picked.length, 1);
  assert.equal(h.picked[0].size, 0);
  assert.ok(!h.picked[0].type.startsWith("video/"));
});

test("native: a malformed photo result is also handed on as unreadable", async () => {
  const { driver } = fakeDriver(BUILD_25, () => Promise.resolve({ kind: "image", mimeType: "image/jpeg", base64: "" }));
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia(h.options), "failed");
  assert.equal(h.picked.length, 1);
  assert.equal(h.picked[0].size, 0);
});

test("native: 'in_progress' from the plugin is ignored silently", async () => {
  const { driver } = fakeDriver(BUILD_25, () => Promise.reject(Object.assign(new Error("open"), { code: "in_progress" })));
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia(h.options), "busy");
  assert.equal(h.picked.length, 0);
});

// ---- double tap -----------------------------------------------------------

test("native: a second tap while the picker is up is ignored; after it settles, taps work again", async () => {
  let settle: (r: NativePickResult) => void = () => {};
  const { driver, calls } = fakeDriver(BUILD_25, () => new Promise((resolve) => (settle = resolve)));
  const picker = createMediaPicker(driver);
  const h = harness();
  const first = picker.pickMedia(h.options);
  assert.equal(await picker.pickMedia(h.options), "busy");
  // The multi-select entry point shares the same guard.
  assert.equal(await picker.pickMediaFiles({ ...h.options, limit: 3, onPicked: () => {} }), "busy");
  assert.equal(calls.length, 1);
  settle({ cancelled: true });
  assert.equal(await first, "cancelled");
  const third = picker.pickMedia(h.options);
  settle({ kind: "image", mimeType: "image/jpeg", base64: BYTES_B64 });
  assert.equal(await third, "native");
  assert.equal(calls.length, 2);
});

test("native video: a tap while the picked video is still being read is ignored", async () => {
  const data = Buffer.from("swing-bytes");
  let releaseRead: () => void = () => {};
  const { driver } = fakeDriver(BUILD_25, () => Promise.resolve({ kind: "video", path: VIDEO_PATH, mimeType: "video/quicktime", size: data.length }), {
    [VIDEO_PATH]: data,
  });
  const realRead = driver.readChunk;
  driver.readChunk = (path, offset, length) => new Promise((resolve) => (releaseRead = () => resolve(realRead(path, offset, length))));
  const picker = createMediaPicker(driver);
  const h = harness();
  const first = picker.pickMedia({ ...h.options, kinds: ["video"] });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(h.loading, [true]);
  assert.equal(await picker.pickMedia({ ...h.options, kinds: ["video"] }), "busy");
  releaseRead();
  assert.equal(await first, "native");
  assert.deepEqual(h.loading, [true, false]);
});

// ---- videos / chunk assembly ---------------------------------------------

test("native video: read back in chunks into one File (bytes, type, name), then discarded", async () => {
  const data = Buffer.alloc(5 * 1024 * 1024 + 123);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const { driver, reads, discarded } = fakeDriver(
    BUILD_25,
    () => Promise.resolve({ kind: "video", path: VIDEO_PATH, mimeType: "video/quicktime", size: data.length, name: "IMG_1234" }),
    { [VIDEO_PATH]: data },
  );
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia({ ...h.options, kinds: ["video"] }), "native");
  assert.equal(h.picked.length, 1);
  const file = h.picked[0];
  assert.equal(file.type, "video/quicktime");
  assert.equal(file.name, "IMG_1234.mov");
  assert.equal(file.size, data.length);
  assert.ok(Buffer.from(await file.arrayBuffer()).equals(data));
  assert.ok(isInMemoryPick(file));
  assert.deepEqual(
    reads.map((r) => r.offset),
    [0, 2 * 1024 * 1024, 4 * 1024 * 1024],
  );
  assert.deepEqual(discarded, [VIDEO_PATH]);
  assert.deepEqual(h.loading, [true, false]);
});

test("native video: bigger than maxVideoBytes is never read; onTooLarge runs instead of onPicked", async () => {
  const { driver, reads, discarded } = fakeDriver(BUILD_25, () =>
    Promise.resolve({ kind: "video", path: VIDEO_PATH, mimeType: "video/quicktime", size: 300 * 1024 * 1024 }),
  );
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia({ ...h.options, kinds: ["video"], maxVideoBytes: 200 * 1024 * 1024 }), "too_large");
  assert.equal(h.picked.length, 0);
  assert.equal(h.tooLarge(), 1);
  assert.equal(reads.length, 0);
  assert.deepEqual(discarded, [VIDEO_PATH]);
});

test("native video: a failed chunk read hands on an unreadable file and still discards the copy", async () => {
  const { driver, discarded } = fakeDriver(BUILD_25, () => Promise.resolve({ kind: "video", path: VIDEO_PATH, mimeType: "video/mp4", size: 10 }));
  const h = harness();
  assert.equal(await createMediaPicker(driver).pickMedia({ ...h.options, kinds: ["video"] }), "failed");
  assert.equal(h.picked.length, 1);
  assert.equal(h.picked[0].size, 0);
  assert.deepEqual(discarded, [VIDEO_PATH]);
  assert.deepEqual(h.loading, [true, false]);
});

test("readNativeVideo: a short read (size mismatch) is rejected; unknown size reads to the end", async () => {
  const data = Buffer.from("0123456789");
  const { driver } = fakeDriver(BUILD_25, undefined, { [VIDEO_PATH]: data });
  assert.equal(await readNativeVideo(driver, { kind: "video", path: VIDEO_PATH, mimeType: "video/mp4", size: 20 }, 4), null);
  const file = await readNativeVideo(driver, { kind: "video", path: VIDEO_PATH, mimeType: "video/mp4" }, 4);
  assert.equal(file?.size, 10);
  assert.equal(Buffer.from(await file!.arrayBuffer()).toString(), "0123456789");
  // An exact multiple of the chunk size ends on the empty read.
  const exact = await readNativeVideo(driver, { kind: "video", path: VIDEO_PATH, mimeType: "video/mp4" }, 5);
  assert.equal(exact?.size, 10);
});

test("videoFileInfo: type from the plugin or the extension; safe names", () => {
  assert.deepEqual(videoFileInfo({ kind: "video", path: "/x/pick-a.MOV" }), { type: "video/quicktime", name: "video.mov" });
  assert.deepEqual(videoFileInfo({ kind: "video", path: "/x/pick-a.mp4", name: "../evil<name>.png" }), { type: "video/mp4", name: "evilname.mp4" });
  assert.equal(videoFileInfo({ kind: "video", path: "/x/pick-a.avi" }), null);
  assert.equal(videoFileInfo({ kind: "video", path: "/x/pick-a.avi", mimeType: "video/x-msvideo" })?.type, "video/x-msvideo");
  assert.equal(videoFileInfo({ kind: "image", path: "/x/a.mov" }), null);
  assert.equal(videoFileInfo({ kind: "video" }), null);
});

// ---- several at once ------------------------------------------------------

test("multi: mixed photos and videos come back as File[] in selection order", async () => {
  const v1 = "/c/GolfMeMediaPicks/pick-1.mov";
  const v2 = "/c/GolfMeMediaPicks/pick-2.mp4";
  const { driver, calls, discarded } = fakeDriver(
    BUILD_25,
    () =>
      Promise.resolve({
        items: [
          { kind: "video", path: v1, mimeType: "video/quicktime", size: 3 },
          { kind: "image", mimeType: "image/jpeg", base64: BYTES_B64 },
          { kind: "video", path: v2, mimeType: "video/mp4", size: 2 },
        ],
      }),
    { [v1]: Buffer.from("abc"), [v2]: Buffer.from("de") },
  );
  const h = harness();
  const got: File[][] = [];
  const out = await createMediaPicker(driver).pickMediaFiles({ ...h.options, kinds: ["image", "video"], limit: 10, onPicked: (f) => got.push(f) });
  assert.equal(out, "native");
  assert.equal(got.length, 1);
  assert.deepEqual(
    got[0].map((f) => f.type),
    ["video/quicktime", "image/jpeg", "video/mp4"],
  );
  assert.equal(Buffer.from(await got[0][0].arrayBuffer()).toString(), "abc");
  assert.equal(Buffer.from(await got[0][2].arrayBuffer()).toString(), "de");
  assert.deepEqual(calls, [{ kinds: ["image", "video"], limit: 10 }]);
  assert.deepEqual(discarded.sort(), [v1, v2]);
  // One loading span for the whole pick.
  assert.deepEqual(h.loading, [true, false]);
});

test("multi: an unreadable item stays in place as an empty file; a too-large video is left out", async () => {
  const { driver } = fakeDriver(BUILD_25, () =>
    Promise.resolve({
      items: [
        { kind: "image", mimeType: "image/jpeg", base64: BYTES_B64 },
        { kind: "unreadable" },
        { kind: "video", path: VIDEO_PATH, mimeType: "video/quicktime", size: 999 },
      ],
    }),
  );
  const h = harness();
  const got: File[][] = [];
  const out = await createMediaPicker(driver).pickMediaFiles({
    ...h.options,
    kinds: ["image", "video"],
    limit: 3,
    maxVideoBytes: 100,
    onPicked: (f) => got.push(f),
  });
  assert.equal(out, "native");
  assert.equal(got[0].length, 2);
  assert.equal(got[0][0].size, 6);
  assert.equal(got[0][1].size, 0);
  assert.equal(h.tooLarge(), 1);
});

test("multi: never more files than the limit, even if the plugin sends more", async () => {
  const img = { kind: "image" as const, mimeType: "image/jpeg", base64: BYTES_B64 };
  const { driver } = fakeDriver(BUILD_25, () => Promise.resolve({ items: [img, img, img] }));
  const got: File[][] = [];
  const h = harness();
  await createMediaPicker(driver).pickMediaFiles({ ...h.options, limit: 2, onPicked: (f) => got.push(f) });
  assert.equal(got[0].length, 2);
});

// ---- helpers --------------------------------------------------------------

test("fileFromNativeResult: only images with a real image type and bytes", () => {
  assert.equal(fileFromNativeResult({ kind: "video", mimeType: "video/mp4", base64: BYTES_B64 }), null);
  assert.equal(fileFromNativeResult({ kind: "image", mimeType: "text/html", base64: BYTES_B64 }), null);
  assert.equal(fileFromNativeResult({ kind: "image", base64: BYTES_B64 }), null);
  assert.equal(fileFromNativeResult({ kind: "image", mimeType: "image/jpeg", base64: "%%%not base64%%%" }), null);
  assert.equal(fileFromNativeResult({ kind: "image", mimeType: "image/png", base64: BYTES_B64 })?.name, "photo.png");
});

test("unreadablePickFile: an empty JPEG for photos, an empty non-video file for videos", () => {
  const f = unreadablePickFile();
  assert.equal(f.size, 0);
  assert.equal(f.type, "image/jpeg");
  const v = unreadablePickFile(["video"]);
  assert.equal(v.size, 0);
  assert.equal(v.type, "application/octet-stream");
});
