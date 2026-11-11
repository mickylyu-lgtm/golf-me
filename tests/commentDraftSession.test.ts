import { test } from "node:test";
import assert from "node:assert/strict";
import { chatDraftVersion, clearChatDrafts, loadChatDraft, observeChatDrafts, saveChatDraft } from "../src/lib/chatDraft.ts";
import { createCommentDraftSession } from "../src/lib/commentDraftSession.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const saved = new Map<string, string>();
  const writes: [string, string][] = [];
  let generation = 0;
  const versions = new Map<string, number>();
  const draft = createCommentDraftSession({ load: (key) => saved.get(key) ?? "", save: (key, text) => { saved.set(key, text); writes.push([key, text]); versions.set(key, (versions.get(key) ?? 0) + 1); }, changed: () => {}, version: (key) => `${generation}:${versions.get(key) ?? 0}` });
  draft.open("account-a", "post-a");
  draft.update("First draft");
  return { draft, saved, writes, clear: () => { generation++; saved.clear(); } };
}

for (const result of ["success", "failure"] as const) {
  test(`${result}: later comment edits survive the pending request`, async () => {
    const { draft, saved } = setup();
    const request = deferred();
    const pending = draft.submit((text) => { assert.equal(text, "First draft"); return request.promise; });
    assert.equal(draft.snapshot().text, "First draft", "pending text remains visible");
    draft.update("Newer unsent draft");
    if (result === "success") request.resolve(); else request.reject(new Error("offline"));
    assert.equal((await pending).status, result === "success" ? "edited" : "failed");
    assert.equal(draft.snapshot().text, "Newer unsent draft");
    assert.equal(saved.get("post-a"), "Newer unsent draft");
    assert.equal(draft.snapshot().submitting, false);
  });
}

test("successful unchanged submission clears its persisted draft; failed submission does not", async () => {
  const { draft, saved } = setup();
  assert.equal((await draft.submit(async () => { throw new Error("rejected"); })).status, "failed");
  assert.equal(draft.snapshot().text, "First draft");
  assert.equal((await draft.submit(async () => {})).status, "sent");
  assert.equal(draft.snapshot().text, "");
  assert.equal(saved.get("post-a"), "");
});

test("clear and retype of the identical text is a newer draft", async () => {
  const { draft } = setup(); const request = deferred();
  const pending = draft.submit(() => request.promise);
  draft.update(""); draft.update("First draft"); request.resolve();
  assert.equal((await pending).status, "edited");
  assert.equal(draft.snapshot().text, "First draft");
});

test("rapid duplicate sends and blank sends are ignored", async () => {
  const { draft } = setup(); const request = deferred(); let calls = 0;
  const send = () => { calls += 1; return request.promise; };
  const pending = draft.submit(send);
  assert.equal((await draft.submit(send)).status, "ignored");
  assert.equal(calls, 1); request.resolve(); await pending;
  assert.equal((await draft.submit(send)).status, "ignored");
});

for (const result of ["success", "failure"] as const) {
  for (const change of ["post", "account", "unmount", "leave-and-return"] as const) {
    test(`${result} after ${change} cannot change drafts or release a newer request`, async () => {
      const { draft, saved, writes, clear } = setup(); const request = deferred();
      const pending = draft.submit(() => request.promise);
      draft.close();
      if (change === "account") { clear(); draft.open("account-b", "post-a"); }
      if (change === "post") draft.open("account-a", "post-b");
      if (change === "leave-and-return") draft.open("account-a", "post-a");
      let newer: ReturnType<typeof deferred> | undefined;
      let newerPending: ReturnType<typeof draft.submit> | undefined;
      if (change !== "unmount") {
        draft.update("New scope draft"); newer = deferred(); newerPending = draft.submit(() => newer!.promise);
      }
      const before = writes.length;
      if (result === "success") request.resolve(); else request.reject(new Error("late failure"));
      assert.equal((await pending).status, "stale");
      const clearsOrigin = result === "success" && (change === "post" || change === "unmount");
      assert.equal(writes.length, before + (clearsOrigin ? 1 : 0));
      if (clearsOrigin) assert.equal(saved.get("post-a"), "", "successful old submission is no longer an unsent draft");
      if (newer) {
        assert.equal(draft.snapshot().text, "New scope draft");
        assert.equal(draft.snapshot().submitting, true);
        newer.resolve(); assert.equal((await newerPending!).status, "sent");
      }
    });
  }
}

test("blocked storage does not break typing or submission", async () => {
  const draft = createCommentDraftSession({ load: () => { throw Error("blocked"); }, save: () => { throw Error("full"); }, changed: () => {}, version: () => "blocked" });
  draft.open("a", "b"); draft.update("Text");
  assert.equal(draft.snapshot().text, "Text");
  assert.equal((await draft.submit(async () => {})).status, "sent");
});


test("successful unmounted submission clears only unchanged origin; reopening starts empty", async () => {
  const { draft, saved } = setup(); const request = deferred();
  const pending = draft.submit(() => request.promise);
  draft.close(); request.resolve();
  assert.equal((await pending).status, "stale");
  assert.equal(saved.get("post-a"), "");
  draft.open("account-a", "post-a");
  assert.equal(draft.snapshot().text, "");
});

test("a remounted composer observes confirmed cleanup from an older instance", async () => {
  const saved = new Map<string, string>(); const versions = new Map<string, number>();
  let current: ReturnType<typeof createCommentDraftSession> | undefined;
  const io = { load: (key: string) => saved.get(key) ?? "", save: (key: string, text: string) => {
    saved.set(key, text); versions.set(key, (versions.get(key) ?? 0) + 1); current?.refresh(key);
  }, version: (key: string) => String(versions.get(key) ?? 0), changed: () => {} };
  const old = createCommentDraftSession(io); old.open("a", "post"); old.update("First draft");
  const request = deferred(); const pending = old.submit(() => request.promise); old.close();
  current = createCommentDraftSession(io); current.open("a", "post");
  assert.equal(current.snapshot().text, "First draft");
  request.resolve(); await pending;
  assert.equal(current.snapshot().text, "");
});


test("real draft storage tokens invalidate late account completions and notify mounted composers", async () => {
  const original = globalThis.window;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } } });
  try {
    clearChatDrafts();
    const draft = createCommentDraftSession({ load: loadChatDraft, save: saveChatDraft, version: chatDraftVersion, changed: () => {} });
    const stop = observeChatDrafts(draft.refresh);
    draft.open("account-a", "post"); draft.update("Identical text");
    const version = chatDraftVersion("post");
    draft.update("Identical text");
    assert.notEqual(chatDraftVersion("post"), version, "same-text edits still get a new token");
    const request = deferred(); const pending = draft.submit(() => request.promise);
    draft.close(); clearChatDrafts(); draft.open("account-b", "post"); draft.update("Identical text");
    request.resolve(); assert.equal((await pending).status, "stale");
    assert.equal(loadChatDraft("post"), "Identical text", "same text on another account is not cleared");
    saveChatDraft("post", "Externally changed draft");
    assert.equal(draft.snapshot().text, "Externally changed draft");
    stop(); draft.close();
  } finally {
    if (original === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: original });
  }
});


test("a quota-rejected newer draft survives an old unmounted submission succeeding", async () => {
  const original = globalThis.window;
  const values = new Map<string, string>();
  let rejectLargerWrite = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (rejectLargerWrite && value.includes("Newer draft")) throw new Error("QuotaExceededError");
      values.set(key, value);
    },
    removeItem: (key: string) => { values.delete(key); },
  } } });
  const stops: (() => void)[] = [];
  try {
    clearChatDrafts();
    const io = { load: loadChatDraft, save: saveChatDraft, version: chatDraftVersion, changed: () => {} };
    const old = createCommentDraftSession(io);
    old.open("account-a", "post"); old.update("First");
    const request = deferred(); const pending = old.submit(() => request.promise);
    old.close();
    const current = createCommentDraftSession(io);
    stops.push(observeChatDrafts(current.refresh));
    current.open("account-a", "post");
    const versionBefore = chatDraftVersion("post");
    rejectLargerWrite = true;
    current.update("Newer draft that exceeds the storage quota");
    assert.notEqual(chatDraftVersion("post"), versionBefore, "failed persistence still invalidates the old request");
    assert.equal(loadChatDraft("post"), "First", "storage retains the smaller old draft");
    assert.equal(current.snapshot().text, "Newer draft that exceeds the storage quota", "no stale-read notification on failed save");
    request.resolve(); assert.equal((await pending).status, "stale");
    assert.equal(current.snapshot().text, "Newer draft that exceeds the storage quota", "old completion cannot clear the in-memory edit");
    assert.equal(loadChatDraft("post"), "First", "old completion did not clear the persisted slot");
    current.close();
  } finally {
    for (const stop of stops) stop();
    if (original === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: original });
  }
});


for (const leave of [false, true]) {
  test(`external-tab draft mutation survives ${leave ? "unmounted" : "active"} submission success`, async () => {
    const original = globalThis.window;
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } } });
    try {
      clearChatDrafts();
      const draft = createCommentDraftSession({ load: loadChatDraft, save: saveChatDraft, version: chatDraftVersion, changed: () => {} });
      draft.open("account-a", "post"); draft.update("First");
      const request = deferred(); const pending = draft.submit(() => request.promise);
      if (leave) draft.close();
      const token = chatDraftVersion("post");
      // A second tab changes shared storage without saveChatDraft in this realm.
      values.set("golfme:chatDrafts", JSON.stringify({ post: "External newer draft" }));
      assert.equal(chatDraftVersion("post"), token);
      request.resolve(); assert.equal((await pending).status, leave ? "stale" : "edited");
      assert.equal(loadChatDraft("post"), "External newer draft");
      if (!leave) assert.equal(draft.snapshot().text, "External newer draft");
      draft.close();
    } finally {
      if (original === undefined) delete (globalThis as { window?: Window }).window;
      else Object.defineProperty(globalThis, "window", { configurable: true, value: original });
    }
  });
}
