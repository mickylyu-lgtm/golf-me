// Run: npm run test:chat  (node --test, built-in type stripping)
// Voice-message privacy: a clip recorded in conversation A is only ever sent
// to A, never to B because a notification / deep link reused the thread
// (lib/voiceSession.ts origin binding, claimVoiceSend, voiceSendPlan).
//
// The real session, plan and send-boundary functions, wired exactly as
// HoldToTalk (originRef, cbRef, originChanged on a new origin, dispose on
// unmount), useVoiceComposerProps (one stable callback that calls the
// latest onClip) and DirectMessageThread / GroupChat (voiceClipRef
// reassigned on every render, reply bar reset when the thread changes)
// wire them. The backend is a fake of RealSocialContext / RealRoundsContext
// sendDirectVoice / sendRoundVoice: the destination is fixed in the job at
// entry, upload then insert, Not sent keeps the job, retry reuses it.
// Every async stage is a deferred promise the test settles by hand; no
// timers, no randomness.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimVoiceSend,
  createVoiceSession,
  voiceNotSentText,
  voiceSendPlan,
  type SentVoiceClip,
  type VoiceOrigin,
  type VoiceSession,
} from "../src/lib/voiceSession.ts";
import type { ActiveRecording, VoiceClip } from "../src/lib/voiceRecorder.ts";
import { makeTranslator } from "../src/i18n/translate.ts";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";

const flush = () => new Promise<void>((r) => setImmediate(r));

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
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

type Kind = VoiceOrigin["kind"];

// ---------------------------------------------------------------- fake backend

interface Job {
  tempId: string;
  kind: Kind;
  to: string;
  recordingId: string;
  replyTo: string | null;
  state: "sending" | "sent" | "failed";
  attempts: number;
  inFlight: boolean;
}

function fakeBackend() {
  const jobs: Job[] = [];
  const uploads: Deferred<void>[] = [];
  const inserts: Deferred<void>[] = [];
  /** The rows the server stored: what a recipient would see. */
  const rows: { kind: Kind; to: string; recordingId: string; replyTo: string | null }[] = [];
  const refused: string[] = [];
  let seq = 0;

  const attempt = async (job: Job): Promise<"sent" | "failed"> => {
    if (job.inFlight || job.state === "sent") return job.state === "sent" ? "sent" : "failed";
    job.inFlight = true;
    job.state = "sending";
    job.attempts++;
    try {
      const up = deferred<void>();
      uploads.push(up);
      await up.promise;
      const ins = deferred<void>();
      inserts.push(ins);
      await ins.promise;
      rows.push({ kind: job.kind, to: job.to, recordingId: job.recordingId, replyTo: job.replyTo });
      job.state = "sent";
      return "sent";
    } catch {
      job.state = "failed";
      return "failed";
    } finally {
      job.inFlight = false;
    }
  };

  // DataContext sendDirectVoice / sendRoundVoice: claimVoiceSend, then the
  // real context's job (destination fixed here, never re-read).
  const send = (kind: Kind, clip: SentVoiceClip, replyTo: string | null): Promise<"sent" | "failed"> => {
    const claim = claimVoiceSend(clip, kind);
    if (!claim.ok) {
      refused.push(claim.reason);
      return Promise.resolve(claim.reason === "duplicate" ? "sent" : "failed");
    }
    const job: Job = { tempId: `temp-${++seq}`, kind, to: claim.to, recordingId: clip.recordingId, replyTo, state: "sending", attempts: 0, inFlight: false };
    jobs.push(job);
    return attempt(job);
  };
  // retryDirectImage(tempId) / retryRoundMessage({clientId}): by the job's id only.
  const retry = (tempId: string) => {
    const job = jobs.find((j) => j.tempId === tempId);
    return job ? attempt(job) : Promise.resolve("failed" as const);
  };
  /** Bubbles (pending or failed) shown in a conversation. */
  const bubblesIn = (kind: Kind, id: string) => jobs.filter((j) => j.kind === kind && j.to === id && j.state !== "sent");
  const rowsIn = (kind: Kind, id: string) => rows.filter((r) => r.kind === kind && r.to === id);
  return { jobs, uploads, inserts, rows, refused, send, retry, bubblesIn, rowsIn };
}

// ---------------------------------------------------------------- fake microphone

interface Mic {
  answer: Deferred<ActiveRecording>;
  stop: Deferred<VoiceClip | null>;
  discarded: number;
  stopCalls: number;
}

function fakeMic() {
  const mics: Mic[] = [];
  let n = 0;
  const start = (signal: AbortSignal): Promise<ActiveRecording> => {
    const mic: Mic = { answer: deferred(), stop: deferred(), discarded: 0, stopCalls: 0 };
    mics.push(mic);
    void signal;
    return mic.answer.promise;
  };
  const grant = (i: number) => {
    const mic = mics[i];
    mic.answer.resolve({
      level: () => 0.5,
      stop: () => {
        mic.stopCalls++;
        return mic.stop.promise;
      },
      discard: () => {
        mic.discarded++;
      },
    });
  };
  const clip = (): VoiceClip => ({ blob: new Blob([`audio-${++n}`]), durationMs: 3000, mime: "audio/mp4", localUrl: `blob:${n}` });
  return { mics, start, grant, clip };
}

// ---------------------------------------------------------------- the UI wiring

/**
 * One thread page (DirectMessageThread or GroupChat) with its composer's
 * HoldToTalk, reused across conversations like react-router reuses the
 * element for /messages/:id. `remountComposer` models the composer being
 * unmounted and mounted again for the new thread instead.
 */
function threadPage(kind: Kind, first: string) {
  const backend = fakeBackend();
  const mic = fakeMic();
  const notices: string[] = [];
  const page = { id: first as string | null, replyToId: null as string | null, mounted: true };

  // Page: voiceClipRef.current reassigned on every render (DM / GroupChat).
  const voiceClipRef = { current: (_c: SentVoiceClip) => {} };
  const renderPage = () => {
    const id = page.id;
    const replyToId = page.replyToId;
    voiceClipRef.current = (clip) => {
      const plan = voiceSendPlan(clip, kind, { id, replyToId });
      if (!plan) return;
      if (plan.here && page.id === id) page.replyToId = null;
      void backend.send(kind, clip, plan.replyToId);
    };
  };
  // useVoiceComposerProps: one stable callback calling the latest onClip.
  const onClipRef = { current: (c: SentVoiceClip) => voiceClipRef.current(c) };
  const stable = (c: SentVoiceClip) => onClipRef.current(c);

  // HoldToTalk: originRef + cbRef updated on render; the session per mount.
  const originRef = { current: { kind, id: first } as VoiceOrigin };
  const noticeOrigins: (VoiceOrigin | null | undefined)[] = [];
  const cbRef = {
    current: {
      onClip: stable,
      onNotice: (n: string, o?: VoiceOrigin | null) => {
        notices.push(n);
        noticeOrigins.push(o);
      },
    },
  };
  let lastOrigin = `${kind}:${first}`;
  let session: VoiceSession;
  const mountComposer = () => {
    session = createVoiceSession({
      start: mic.start,
      origin: () => originRef.current,
      onState() {},
      onClip: (clip) => cbRef.current.onClip(clip),
      onNotice: (n, o) => cbRef.current.onNotice(n, o),
      now: () => 0,
    });
  };
  const renderComposer = () => {
    if (page.id) originRef.current = { kind, id: page.id };
    // useEffect(() => session.originChanged(), [origin.kind, origin.id])
    const key = `${kind}:${page.id}`;
    if (key !== lastOrigin) {
      lastOrigin = key;
      session.originChanged();
    }
  };
  mountComposer();
  renderPage();

  return {
    backend,
    mic,
    notices,
    noticeOrigins,
    page,
    get session() {
      return session;
    },
    press: () => session.dispatch({ type: "press", y: 500 }),
    release: () => session.dispatch({ type: "release", at: 3000 }),
    /** Background / touchcancel / pagehide. */
    interrupt: () => session.dispatch({ type: "interrupt" }),
    pickReply: (m: string) => {
      page.replyToId = m;
      renderPage();
    },
    /** A notification / deep link: the same page element now shows `id`. */
    navigate(id: string, opts: { remountComposer?: boolean } = {}) {
      page.id = id;
      page.replyToId = null; // useEffect(() => setReplyToId(null), [id])
      renderPage();
      if (opts.remountComposer) {
        session.dispose();
        lastOrigin = `${kind}:${id}`;
        originRef.current = { kind, id };
        mountComposer();
      } else {
        renderComposer();
      }
    },
    /** The page (and its composer) unmounted: the user left chat entirely. */
    unmount() {
      page.mounted = false;
      session.dispose();
    },
  };
}

/** Press, get the microphone, release: A's clip is now waiting for stop(). */
async function recordAndRelease(t: ReturnType<typeof threadPage>, micIndex: number) {
  t.press();
  t.mic.grant(micIndex);
  await flush();
  t.release();
  await flush();
}

/** Settle every pending upload and insert in order, so a delivered clip finishes. */
async function settleAll(b: ReturnType<typeof fakeBackend>) {
  for (let i = 0; i < 10; i++) {
    for (const u of b.uploads.splice(0)) u.resolve();
    await flush();
    for (const s of b.inserts.splice(0)) s.resolve();
    await flush();
  }
}

function assertOnlyIn(t: ReturnType<typeof threadPage>, kind: Kind, id: string, count: number, other = "B") {
  assert.equal(t.backend.rowsIn(kind, other).length, 0, `no message from A's clip stored in ${other}`);
  assert.equal(t.backend.bubblesIn(kind, other).length, 0, `no pending / Not sent bubble in ${other}`);
  assert.equal(t.backend.jobs.filter((j) => j.to === other).length, 0, `no job (upload / attachment) addressed to ${other}`);
  assert.equal(t.backend.rowsIn(kind, id).length, count, `${count} message(s) in ${id}`);
}

for (const kind of ["dm", "round"] as const) {
  // 1 ------------------------------------------------------------------
  test(`${kind} 1: released in A, stop pending, thread reused for B, stop resolves -> sent to A only`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.navigate("B");
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    assert.equal(t.backend.jobs.length, 1);
    assert.equal(t.backend.jobs[0].to, "A", "destination at the send boundary");
    assert.equal(t.backend.jobs[0].kind, kind);
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
  });

  test(`${kind} 1b: same, with the composer remounted for B -> sent to A only`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.navigate("B", { remountComposer: true });
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
  });

  test(`${kind} 1c: a reply picked in B is never attached to A's clip`, async () => {
    const t = threadPage(kind, "A");
    t.pickReply("msg-in-A");
    await recordAndRelease(t, 0);
    t.navigate("B");
    t.pickReply("msg-in-B");
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    assert.equal(t.backend.jobs[0].to, "A");
    assert.equal(t.backend.jobs[0].replyTo, null, "no quote taken from B's page");
    assert.equal(t.page.replyToId, "msg-in-B", "B's reply bar untouched");
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
  });

  // 2 ------------------------------------------------------------------
  test(`${kind} 2: switched A -> B while still recording: cancelled, nothing sent anywhere`, async () => {
    const t = threadPage(kind, "A");
    t.press();
    t.mic.grant(0);
    await flush();
    assert.equal(t.session.state().kind, "recording");
    t.navigate("B");
    assert.equal(t.session.state().kind, "idle", "the hold is over");
    assert.equal(t.mic.mics[0].discarded, 1, "A's recording thrown away");
    t.release(); // the finger lifts on B
    await flush();
    assert.equal(t.mic.mics[0].stopCalls, 0, "never stopped-to-send");
    await settleAll(t.backend);
    assert.equal(t.backend.jobs.length, 0);
    assert.equal(t.backend.rows.length, 0);
  });

  test(`${kind} 2b: switched while the microphone is still being acquired: the late answer is discarded`, async () => {
    const t = threadPage(kind, "A");
    t.press();
    t.navigate("B");
    t.mic.grant(0);
    await flush();
    assert.equal(t.mic.mics[0].discarded, 1);
    t.release();
    await flush();
    assert.equal(t.backend.jobs.length, 0);
  });

  // 3 ------------------------------------------------------------------
  test(`${kind} 3a: switched after stop, before the upload completes -> finishes in A`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    assert.equal(t.backend.uploads.length, 1, "upload pending");
    t.navigate("B");
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
  });

  test(`${kind} 3b: switched after the upload, before the insert completes -> finishes in A`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    t.backend.uploads.splice(0)[0].resolve();
    await flush();
    assert.equal(t.backend.inserts.length, 1, "insert pending");
    t.navigate("B");
    t.backend.inserts.splice(0)[0].resolve();
    await flush();
    assertOnlyIn(t, kind, "A", 1);
  });

  // 4 ------------------------------------------------------------------
  test(`${kind} 4a: unmounted while stop is pending -> still sent, to A (approved policy)`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.unmount();
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
  });

  test(`${kind} 4b: unmounted while recording -> nothing sent`, async () => {
    const t = threadPage(kind, "A");
    t.press();
    t.mic.grant(0);
    await flush();
    t.unmount();
    assert.equal(t.mic.mics[0].discarded, 1);
    await settleAll(t.backend);
    assert.equal(t.backend.jobs.length, 0);
  });

  test(`${kind} 4c: unmounted while upload / insert is pending -> finishes in A`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    t.navigate("B");
    t.unmount();
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
  });

  // 5 ------------------------------------------------------------------
  test(`${kind} 5a: backgrounded while recording, resumed on B -> nothing sent`, async () => {
    const t = threadPage(kind, "A");
    t.press();
    t.mic.grant(0);
    await flush();
    t.interrupt(); // pause / pagehide
    t.navigate("B"); // resume through a notification for B
    t.release();
    await flush();
    await settleAll(t.backend);
    assert.equal(t.backend.jobs.length, 0);
  });

  test(`${kind} 5b: released, backgrounded with stop pending, resumed on B, stop resolves -> A`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.interrupt();
    t.navigate("B");
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
  });

  // 6 ------------------------------------------------------------------
  test(`${kind} 6a: stop rejects after navigating to B -> a notice, nothing sent anywhere`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.navigate("B");
    t.mic.mics[0].stop.reject(new Error("recorder failed"));
    await flush();
    assert.deepEqual(t.notices, ["failed"]);
    assert.deepEqual(t.noticeOrigins, [{ kind, id: "A" }], "the toast is named for A, not the thread on screen");
    assert.equal(t.backend.jobs.length, 0);
  });

  test(`${kind} 6b: stop yields nothing (watchdog) after navigating -> nothing sent`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.navigate("B");
    t.mic.mics[0].stop.resolve(null);
    await flush();
    assert.deepEqual(t.notices, ["failed"]);
    assert.equal(t.backend.jobs.length, 0);
  });

  test(`${kind} 6c: upload fails after navigating to B -> Not sent stays in A; retry from B goes to A`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    t.navigate("B");
    t.backend.uploads.splice(0)[0].reject(new Error("offline"));
    await flush();
    assert.equal(t.backend.bubblesIn(kind, "A").length, 1, "Not sent bubble in A");
    assert.equal(t.backend.bubblesIn(kind, "A")[0].state, "failed");
    assert.equal(t.backend.bubblesIn(kind, "B").length, 0);
    const job = t.backend.jobs[0];
    void t.backend.retry(job.tempId); // tapped while B is on screen
    await settleAll(t.backend);
    assert.equal(job.attempts, 2);
    assertOnlyIn(t, kind, "A", 1);
  });

  test(`${kind} 6d: insert fails after navigating to B -> retry still goes to A`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    t.backend.uploads.splice(0)[0].resolve();
    await flush();
    t.navigate("B");
    t.backend.inserts.splice(0)[0].reject(new Error("500"));
    await flush();
    assert.equal(t.backend.bubblesIn(kind, "A")[0].state, "failed");
    void t.backend.retry(t.backend.jobs[0].tempId);
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
  });

  // 7 ------------------------------------------------------------------
  test(`${kind} 7a: A's stop resolves after a new recording in B was sent -> each to its own`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.navigate("B");
    await recordAndRelease(t, 1);
    t.mic.mics[1].stop.resolve(t.mic.clip()); // B first
    await flush();
    t.mic.mics[0].stop.resolve(t.mic.clip()); // then A, out of order
    await flush();
    assert.deepEqual(
      t.backend.jobs.map((j) => j.to),
      ["B", "A"],
    );
    assert.notEqual(t.backend.jobs[0].recordingId, t.backend.jobs[1].recordingId, "distinct recording ids");
    await settleAll(t.backend);
    assert.equal(t.backend.rowsIn(kind, "A").length, 1);
    assert.equal(t.backend.rowsIn(kind, "B").length, 1);
    assert.equal(t.backend.rows.find((r) => r.to === "B")!.recordingId, t.backend.jobs[0].recordingId, "B holds only B's recording");
  });

  test(`${kind} 7b: A's stop resolves while B is still recording -> A gets it, B's hold untouched`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.navigate("B");
    t.press();
    t.mic.grant(1);
    await flush();
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    assert.equal(t.session.state().kind, "recording", "B still recording");
    assert.equal(t.mic.mics[1].discarded, 0);
    t.release();
    t.mic.mics[1].stop.resolve(t.mic.clip());
    await flush();
    await settleAll(t.backend);
    assert.equal(t.backend.rowsIn(kind, "A").length, 1);
    assert.equal(t.backend.rowsIn(kind, "B").length, 1);
    assert.equal(t.backend.rowsIn(kind, "A")[0].recordingId, t.backend.jobs.find((j) => j.to === "A")!.recordingId);
  });

  test(`${kind} 7c: A fails, B succeeds (out of order) -> A's failure stays in A`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.navigate("B");
    await recordAndRelease(t, 1);
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    t.mic.mics[1].stop.resolve(t.mic.clip());
    await flush();
    const [upA, upB] = t.backend.uploads.splice(0);
    upB.resolve();
    upA.reject(new Error("offline"));
    await flush();
    await settleAll(t.backend);
    assert.equal(t.backend.rowsIn(kind, "B").length, 1);
    assert.equal(t.backend.rowsIn(kind, "A").length, 0);
    assert.equal(t.backend.bubblesIn(kind, "A").length, 1, "A's Not sent bubble");
    assert.equal(t.backend.bubblesIn(kind, "B").length, 0);
  });

  // 8 ------------------------------------------------------------------
  test(`${kind} 8a: repeated completion, repeated hand-over and double retry -> one message`, async () => {
    const t = threadPage(kind, "A");
    await recordAndRelease(t, 0);
    t.release(); // a second release event
    t.navigate("B");
    t.mic.mics[0].stop.resolve(t.mic.clip());
    t.mic.mics[0].stop.resolve(t.mic.clip()); // a second settle is a no-op
    await flush();
    assert.equal(t.mic.mics[0].stopCalls, 1, "stopped once");
    assert.equal(t.backend.jobs.length, 1, "handed to the send path once");
    const job = t.backend.jobs[0];
    t.backend.uploads.splice(0)[0].reject(new Error("offline"));
    await flush();
    void t.backend.retry(job.tempId);
    void t.backend.retry(job.tempId); // double tap
    await flush();
    assert.equal(t.backend.uploads.length, 1, "one in-flight attempt");
    await settleAll(t.backend);
    void t.backend.retry(job.tempId); // retry after it was sent
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
  });

  test(`${kind} 8b: the same delivered clip sent twice is claimed once`, async () => {
    const t = threadPage(kind, "A");
    const captured: SentVoiceClip[] = [];
    const s = createVoiceSession({
      start: t.mic.start,
      origin: () => ({ kind, id: "A" }),
      onState() {},
      onClip: (c) => captured.push(c),
      onNotice() {},
      now: () => 0,
    });
    s.dispatch({ type: "press", y: 1 });
    t.mic.grant(0);
    await flush();
    s.dispatch({ type: "release", at: 3000 });
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    assert.equal(captured.length, 1);
    void t.backend.send(kind, captured[0], null);
    assert.equal(await t.backend.send(kind, captured[0], null), "sent", "a repeat reports sent and does nothing");
    await settleAll(t.backend);
    assert.equal(t.backend.jobs.length, 1);
    assert.deepEqual(t.backend.refused, ["duplicate"]);
    assert.equal(t.backend.rowsIn(kind, "A").length, 1);
  });

  test(`${kind} 8c: rapid A -> B -> A with stop pending -> one message in A, none in B`, async () => {
    const t = threadPage(kind, "A");
    t.pickReply("msg-in-A");
    await recordAndRelease(t, 0);
    t.navigate("B");
    t.navigate("A");
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
    assert.equal(t.backend.jobs[0].replyTo, null, "the reply bar was reset by the thread change; nothing from B");
  });

  test(`${kind} 8d: rapid A -> B -> A while still recording -> cancelled, nothing sent`, async () => {
    const t = threadPage(kind, "A");
    t.press();
    t.mic.grant(0);
    await flush();
    t.navigate("B");
    t.navigate("A");
    t.release();
    await flush();
    await settleAll(t.backend);
    assert.equal(t.backend.jobs.length, 0);
  });

  // 9 ------------------------------------------------------------------
  test(`${kind} 9: normal record and send in one conversation, with a quote`, async () => {
    const t = threadPage(kind, "A");
    t.pickReply("msg-in-A");
    await recordAndRelease(t, 0);
    t.mic.mics[0].stop.resolve(t.mic.clip());
    await flush();
    assert.equal(t.backend.jobs[0].to, "A");
    assert.equal(t.backend.jobs[0].replyTo, "msg-in-A");
    assert.equal(t.page.replyToId, null, "the reply bar clears after sending");
    await settleAll(t.backend);
    assertOnlyIn(t, kind, "A", 1);
    assert.deepEqual(t.notices, []);
  });
}

// ---------------------------------------------------------------- the boundary itself

const clipWith = (origin: VoiceOrigin | null): SentVoiceClip => ({
  blob: new Blob(["x"]),
  durationMs: 1000,
  mime: "audio/mp4",
  localUrl: "blob:x",
  origin,
  recordingId: "r",
});

test("boundary: a clip without an origin is refused (never guessed) and not claimed", () => {
  const c = clipWith(null);
  assert.deepEqual(claimVoiceSend(c, "dm"), { ok: false, reason: "noOrigin" });
  assert.deepEqual(claimVoiceSend(c, "round"), { ok: false, reason: "noOrigin" });
});

test("boundary: a DM clip is refused by the round path and vice versa", () => {
  assert.deepEqual(claimVoiceSend(clipWith({ kind: "dm", id: "A" }), "round"), { ok: false, reason: "noOrigin" });
  assert.deepEqual(claimVoiceSend(clipWith({ kind: "round", id: "A" }), "dm"), { ok: false, reason: "noOrigin" });
  assert.equal(voiceSendPlan(clipWith({ kind: "dm", id: "A" }), "round", { id: "A", replyToId: "m" }), null);
});

test("boundary: the destination is the origin, once", () => {
  const c = clipWith({ kind: "dm", id: "A" });
  assert.deepEqual(claimVoiceSend(c, "dm"), { ok: true, to: "A" });
  assert.deepEqual(claimVoiceSend(c, "dm"), { ok: false, reason: "duplicate" });
});

test("plan: the quote is the page's only when the page shows the origin", () => {
  const c = clipWith({ kind: "round", id: "A" });
  assert.deepEqual(voiceSendPlan(c, "round", { id: "A", replyToId: "m1" }), { to: "A", here: true, replyToId: "m1" });
  assert.deepEqual(voiceSendPlan(c, "round", { id: "B", replyToId: "m2" }), { to: "A", here: false, replyToId: null });
  assert.deepEqual(voiceSendPlan(c, "round", { id: undefined, replyToId: "m2" }), { to: "A", here: false, replyToId: null });
});

test("session: the origin is captured at press and frozen on the clip; the getter is not re-read", async () => {
  const mic = fakeMic();
  let origin: VoiceOrigin = { kind: "dm", id: "A" };
  let reads = 0;
  const clips: SentVoiceClip[] = [];
  const s = createVoiceSession({
    start: mic.start,
    origin: () => {
      reads++;
      return origin;
    },
    onState() {},
    onClip: (c) => clips.push(c),
    onNotice() {},
    now: () => 0,
  });
  s.dispatch({ type: "press", y: 1 });
  mic.grant(0);
  await flush();
  s.dispatch({ type: "release", at: 3000 });
  origin = { kind: "dm", id: "B" }; // mutable page state moves on
  const readsAtRelease = reads;
  mic.mics[0].stop.resolve(mic.clip());
  await flush();
  assert.equal(reads, readsAtRelease, "no origin read after release");
  assert.deepEqual(clips[0].origin, { kind: "dm", id: "A" });
  assert.ok(Object.isFrozen(clips[0]) && Object.isFrozen(clips[0].origin), "frozen");
  assert.ok(clips[0].recordingId);
});

// ---------------------------------------------------------------- the named "not sent" toast

const LOCALES = { en, es, ja, ko, zhCN, zhTW } as const;

test("toast: every locale names the chat, keeps {name} once, no emoji", () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    const line = (dict as Record<string, string>)["chat.voiceNotSentTo"];
    assert.ok(line, `${code} has chat.voiceNotSentTo`);
    assert.equal(line.split("{name}").length, 2, `${code}: {name} exactly once`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(line), `${code}: no emoji`);
    const t = makeTranslator(dict as Record<string, string>, en as Record<string, string>);
    assert.ok(voiceNotSentText(t, "Pebble Beach").includes("Pebble Beach"), `${code}: the name is shown`);
  }
});

test("toast: named for a golfer or a course; generic when the name is unknown", () => {
  const t = makeTranslator(en as Record<string, string>, en as Record<string, string>);
  assert.equal(voiceNotSentText(t, "Alex Kim"), "Voice message to Alex Kim wasn't sent.");
  assert.equal(voiceNotSentText(t, "Pebble Beach Golf Links"), "Voice message to Pebble Beach Golf Links wasn't sent.");
  assert.equal(voiceNotSentText(t, undefined), en["chat.voiceNotSent"]);
  assert.equal(voiceNotSentText(t, "   "), en["chat.voiceNotSent"]);
});
