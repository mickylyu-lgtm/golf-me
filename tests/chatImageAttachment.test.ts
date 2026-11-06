// Run: node --test tests/chatImageAttachment.test.ts  (also in npm run test:chat)
// The composer's photo attachment (lib/chatImageAttachment.ts, wrapped by
// lib/useChatImageAttachment.ts) against late answers: the native picker
// (lib/mediaPicker.ts with a controlled driver) resolving after the user
// moved to another chat, out-of-order processing, failures, unmount, and
// the send path taking only the current chat's photo.
//
// How the hook is modelled: each render of a chat page has a visit
// generation (bumped when the thread / round id changes); the composer's
// photo button hands that render's `pick` (bound to its generation) to the
// picker at tap time, exactly as ChatComposer passes `onPicked:
// onPickImage`. `visit()` below plays a render with a new scope and its
// `leave` effect. Native-device behaviour is not exercised here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatImageAttachment, type ChatImageFailure } from "../src/lib/chatImageAttachment.ts";
import { createMediaPicker, type MediaPickerDriver, type NativePickResult } from "../src/lib/mediaPicker.ts";
import type { ProcessedChatImage } from "../src/lib/chatImages.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

function image(name: string): ProcessedChatImage {
  return { blob: new Blob([name]), width: 10, height: 10, thumb: "", previewUrl: `blob:${name}` } as unknown as ProcessedChatImage;
}

// A chat page: scope -> generation, a controlled processChatImage, and a
// log of revoked URLs and error toasts.
function page() {
  const visit = { scope: "A" as string | null, generation: 1 };
  const processing: { file: File; d: Deferred<ProcessedChatImage> }[] = [];
  const revoked: string[] = [];
  const errors: ChatImageFailure[] = [];
  const att = createChatImageAttachment({
    process: (file) => {
      const d = deferred<ProcessedChatImage>();
      processing.push({ file, d });
      return d.promise;
    },
    revoke: (url) => revoked.push(url),
    generation: () => visit.generation,
    failureReason: (err) => (err === "tooLarge" ? "tooLarge" : "unreadable"),
    onError: (r) => errors.push(r),
  });
  att.mount();
  return {
    att,
    processing,
    revoked,
    errors,
    get generation() {
      return visit.generation;
    },
    /** Render with another thread/round id, then its leave effect. */
    go(scope: string) {
      if (scope !== visit.scope) visit.generation++;
      visit.scope = scope;
      att.leave(visit.generation);
    },
    /** The `pick` this render hands to the composer. */
    pickFn() {
      const g = visit.generation;
      return (file: File) => void att.pick(g, file);
    },
    shown() {
      return att.view(visit.generation);
    },
  };
}

// The real picker module with a native driver whose pick we resolve by hand.
function nativePicker() {
  const picks: Deferred<NativePickResult>[] = [];
  const driver: MediaPickerDriver = {
    capabilities: () => ({ kinds: ["image", "video"], multiple: true }),
    pickNative: () => {
      const d = deferred<NativePickResult>();
      picks.push(d);
      return d.promise;
    },
    readChunk: async () => ({ base64: "" }),
    discard: async () => undefined,
  };
  return { picker: createMediaPicker(driver), picks };
}
const nativeImage: NativePickResult = { kind: "image", mimeType: "image/jpeg", base64: btoa("jpegbytes") };

test("picker opened in A, user switches to B, A's picker resolves: nothing appears in B, no processing", async () => {
  const p = page();
  const { picker, picks } = nativePicker();
  const outcome = picker.pickMedia({ openFileInput: () => assert.fail("native path"), onPicked: p.pickFn() });
  p.go("B");
  picks[0].resolve(nativeImage);
  assert.equal(await outcome, "native");
  assert.equal(p.processing.length, 0, "the stale file is dropped before processing");
  assert.equal(p.shown().kind, "none");
});

test("A -> B -> A while A's picker is pending: the old visit's answer is still dropped", async () => {
  const p = page();
  const { picker, picks } = nativePicker();
  const outcome = picker.pickMedia({ openFileInput: () => undefined, onPicked: p.pickFn() });
  p.go("B");
  p.go("A");
  picks[0].resolve(nativeImage);
  await outcome;
  assert.equal(p.processing.length, 0);
  assert.equal(p.shown().kind, "none");
});

test("A -> B -> A while A's photo is still processing: its result never shows, its URL is revoked", async () => {
  const p = page();
  p.pickFn()(new File(["a"], "a.jpg"));
  assert.equal(p.shown().kind, "processing");
  p.go("B");
  assert.equal(p.shown().kind, "none", "B never sees A's spinner");
  p.go("A");
  p.processing[0].d.resolve(image("a1"));
  await flush();
  assert.equal(p.shown().kind, "none");
  assert.deepEqual(p.revoked, ["blob:a1"]);
});

test("a photo picked in B after leaving A is B's, and A's late result can't replace it", async () => {
  const p = page();
  p.pickFn()(new File(["a"], "a.jpg"));
  p.go("B");
  p.pickFn()(new File(["b"], "b.jpg"));
  p.processing[1].d.resolve(image("b"));
  p.processing[0].d.resolve(image("a"));
  await flush();
  const shown = p.shown();
  assert.equal(shown.kind, "ready");
  assert.equal(shown.kind === "ready" && shown.image.previewUrl, "blob:b");
  assert.deepEqual(p.revoked, ["blob:a"]);
});

test("two picks in one chat, finishing out of order: the newer one wins, the older is revoked", async () => {
  const p = page();
  const pick = p.pickFn();
  pick(new File(["1"], "1.jpg"));
  pick(new File(["2"], "2.jpg"));
  p.processing[1].d.resolve(image("2"));
  await flush();
  p.processing[0].d.resolve(image("1"));
  await flush();
  const shown = p.shown();
  assert.equal(shown.kind === "ready" && shown.image.previewUrl, "blob:2");
  assert.deepEqual(p.revoked, ["blob:1"]);
});

test("a ready photo replaced by a new pick is revoked once; the new one isn't", async () => {
  const p = page();
  const pick = p.pickFn();
  pick(new File(["1"], "1.jpg"));
  p.processing[0].d.resolve(image("1"));
  await flush();
  pick(new File(["2"], "2.jpg"));
  assert.deepEqual(p.revoked, ["blob:1"]);
  p.processing[1].d.resolve(image("2"));
  await flush();
  assert.equal(p.shown().kind, "ready");
  assert.deepEqual(p.revoked, ["blob:1"]);
});

test("an older pick failing while a newer one is pending: no toast, the newer one keeps loading", async () => {
  const p = page();
  const pick = p.pickFn();
  pick(new File(["1"], "1.jpg"));
  pick(new File(["2"], "2.jpg"));
  p.processing[0].d.reject("tooLarge");
  await flush();
  assert.deepEqual(p.errors, []);
  assert.equal(p.shown().kind, "processing");
  p.processing[1].d.resolve(image("2"));
  await flush();
  assert.equal(p.shown().kind, "ready");
});

test("the current pick failing shows its reason and clears the spinner", async () => {
  const p = page();
  p.pickFn()(new File(["1"], "1.jpg"));
  p.processing[0].d.reject("tooLarge");
  await flush();
  assert.deepEqual(p.errors, ["tooLarge"]);
  assert.equal(p.shown().kind, "none");
});

test("A's failure after the switch shows no toast in B and leaves B's photo alone", async () => {
  const p = page();
  p.pickFn()(new File(["a"], "a.jpg"));
  p.go("B");
  p.pickFn()(new File(["b"], "b.jpg"));
  p.processing[0].d.reject(new Error("decode"));
  await flush();
  assert.deepEqual(p.errors, []);
  assert.equal(p.shown().kind, "processing");
});

test("picker cancel or rejection in A after switching to B: B stays empty, no toast", async () => {
  const p = page();
  const { picker, picks } = nativePicker();
  const first = picker.pickMedia({ openFileInput: () => undefined, onPicked: p.pickFn() });
  p.go("B");
  picks[0].resolve({ cancelled: true });
  assert.equal(await first, "cancelled");
  const second = picker.pickMedia({ openFileInput: () => undefined, onPicked: p.pickFn() });
  p.go("C");
  picks[1].reject(new Error("bridge"));
  assert.equal(await second, "failed");
  assert.equal(p.processing.length, 0, "the 'unreadable' placeholder from the rejected pick is dropped too");
  assert.deepEqual(p.errors, []);
  assert.equal(p.shown().kind, "none");
});

test("remove while processing makes that result stale; remove of a ready photo revokes it", async () => {
  const p = page();
  const pick = p.pickFn();
  pick(new File(["1"], "1.jpg"));
  p.att.remove();
  p.processing[0].d.resolve(image("1"));
  await flush();
  assert.equal(p.shown().kind, "none");
  assert.deepEqual(p.revoked, ["blob:1"]);
  pick(new File(["2"], "2.jpg"));
  p.processing[1].d.resolve(image("2"));
  await flush();
  p.att.remove();
  assert.deepEqual(p.revoked, ["blob:1", "blob:2"]);
});

test("unmount: a ready photo is revoked; a pending one resolving later is revoked and dropped", async () => {
  const p = page();
  p.pickFn()(new File(["1"], "1.jpg"));
  p.processing[0].d.resolve(image("1"));
  await flush();
  const pick = p.pickFn();
  p.att.dispose();
  assert.deepEqual(p.revoked, ["blob:1"]);

  const q = page();
  q.pickFn()(new File(["2"], "2.jpg"));
  q.att.dispose();
  q.processing[0].d.resolve(image("2"));
  await flush();
  assert.equal(q.att.snapshot().kind, "none");
  assert.deepEqual(q.revoked, ["blob:2"]);
  // A picker answering after unmount does nothing.
  pick(new File(["3"], "3.jpg"));
  assert.equal(p.processing.length, 1);
});

test("StrictMode's mount -> unmount -> mount keeps the attachment usable", async () => {
  const p = page();
  p.att.dispose();
  p.att.mount();
  p.pickFn()(new File(["1"], "1.jpg"));
  p.processing[0].d.resolve(image("1"));
  await flush();
  assert.equal(p.shown().kind, "ready");
});

// The send path of both chat pages: if the composer shows a ready photo,
// take() it and send to the chat the page is showing *now*.
function send(p: ReturnType<typeof page>, currentRecipient: string, sent: { to: string; url: string }[]) {
  const shown = p.shown();
  if (shown.kind !== "ready") return "text";
  const picked = p.att.take(p.generation);
  if (!picked) return "none";
  sent.push({ to: currentRecipient, url: picked.previewUrl });
  return "photo";
}

test("explicit send uses only the current chat's ready photo and recipient; the photo is taken once, not revoked", async () => {
  const p = page();
  const sent: { to: string; url: string }[] = [];
  p.pickFn()(new File(["a"], "a.jpg"));
  p.processing[0].d.resolve(image("a"));
  await flush();
  assert.equal(send(p, "A", sent), "photo");
  assert.deepEqual(sent, [{ to: "A", url: "blob:a" }]);
  assert.equal(send(p, "A", sent), "text", "taken: a second send has no photo");
  assert.deepEqual(p.revoked, [], "the sending bubble owns the preview now");
});

test("a stale result never reaches a send or upload in another chat", async () => {
  const p = page();
  const sent: { to: string; url: string }[] = [];
  const { picker, picks } = nativePicker();
  // Photo ready in A, then a second picker opened in A; user goes to B.
  p.pickFn()(new File(["a"], "a.jpg"));
  p.processing[0].d.resolve(image("a"));
  await flush();
  const late = picker.pickMedia({ openFileInput: () => undefined, onPicked: p.pickFn() });
  p.go("B");
  assert.deepEqual(p.revoked, ["blob:a"], "leaving A drops its unsent photo");
  picks[0].resolve(nativeImage);
  await late;
  assert.equal(send(p, "B", sent), "text");
  // Even a take() bound to A's old visit gets nothing.
  assert.equal(p.att.take(p.generation - 1), null);
  assert.deepEqual(sent, []);
  assert.equal(p.processing.length, 1, "no upload work started for the stale pick");
});
