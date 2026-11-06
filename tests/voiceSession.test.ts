// Run: npm run test:chat  (node --test, built-in type stripping)
// Voice recording lifecycle (lib/voiceSession.ts + lib/voiceRecorder.ts):
// which hold owns the microphone, and that every acquired track /
// AudioContext is released on every way out. Deterministic: getUserMedia
// returns promises the test settles by hand, MediaRecorder callbacks fire
// only when the test fires them, and setImmediate drains microtasks (no
// sleeps).
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createVoiceSession, claimVoiceClip, type VoiceSession } from "../src/lib/voiceSession.ts";
import { startVoiceRecording, STOP_WATCHDOG_MS, type VoiceClip } from "../src/lib/voiceRecorder.ts";
import { VOICE_MAX_MS } from "../src/lib/chatVoice.ts";

// ---------------------------------------------------------------- fakes

class FakeTrack {
  stops = 0;
  throwOnStop = false;
  stop() {
    this.stops++;
    if (this.throwOnStop) throw new Error("track stop failed");
  }
}

class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(n = 1) {
    this.tracks = Array.from({ length: n }, () => new FakeTrack());
  }
  getTracks() {
    return this.tracks;
  }
  get allStopped() {
    return this.tracks.every((t) => t.stops >= 1);
  }
  get anyStopped() {
    return this.tracks.some((t) => t.stops >= 1);
  }
}

const env = {
  contexts: [] as FakeAudioContext[],
  recorders: [] as FakeMediaRecorder[],
  requests: [] as { stream: FakeStream; resolve: () => void; reject: (name: string) => void }[],
  audioContextThrows: false,
  meterThrows: false,
  recorderCtorThrows: false,
  recorderStartThrows: false,
  recorderStopThrows: false,
};

class FakeAudioContext {
  closes = 0;
  constructor() {
    if (env.audioContextThrows) throw new Error("no audio context");
    env.contexts.push(this);
  }
  close() {
    this.closes++;
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
  createMediaStreamSource() {
    if (env.meterThrows) throw new Error("no source");
    return { connect() {} };
  }
  createAnalyser() {
    return { fftSize: 0, getByteTimeDomainData: (b: Uint8Array) => b.fill(200) };
  }
}

class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t.startsWith("audio/mp4");
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  stopCalls = 0;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly stream: FakeStream;
  readonly index: number;
  constructor(stream: FakeStream, opts: { mimeType: string }) {
    if (env.recorderCtorThrows) throw new Error("NotSupportedError");
    this.stream = stream;
    this.mimeType = opts.mimeType.split(";")[0];
    this.index = env.recorders.length;
    env.recorders.push(this);
  }
  start() {
    if (env.recorderStartThrows) throw new Error("InvalidStateError");
    this.state = "recording";
  }
  stop() {
    this.stopCalls++;
    if (env.recorderStopThrows) throw new Error("stop failed");
    this.state = "inactive";
  }
  /** What the browser does after stop(): the last chunk, then onstop (looked up NOW, like a real event). */
  emitStop(payload = `audio-${this.index}`) {
    this.ondataavailable?.({ data: new Blob([payload]) });
    this.onstop?.();
  }
}

const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.MediaRecorder = FakeMediaRecorder;
g.AudioContext = FakeAudioContext;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve, reject) => {
          const stream = new FakeStream();
          env.requests.push({
            stream,
            resolve: () => resolve(stream),
            reject: (name) => reject(Object.assign(new Error(name), { name })),
          });
        }),
    },
  },
});

const flush = () => new Promise<void>((r) => setImmediate(r));

beforeEach(() => {
  env.contexts = [];
  env.recorders = [];
  env.requests = [];
  env.audioContextThrows = false;
  env.meterThrows = false;
  env.recorderCtorThrows = false;
  env.recorderStartThrows = false;
  env.recorderStopThrows = false;
});

// The same wiring HoldToTalk uses: the real recorder behind the real session.
function harness(start?: (signal: AbortSignal) => ReturnType<typeof startVoiceRecording>) {
  const log = { states: [] as string[], clips: [] as VoiceClip[], notices: [] as string[], haptics: [] as string[], revoked: [] as string[] };
  let clock = 0;
  const s: VoiceSession = createVoiceSession({
    start: start ?? ((signal) => startVoiceRecording({ signal })),
    onState: (st) => log.states.push(st.kind),
    onClip: (c) => log.clips.push(c),
    onNotice: (n) => log.notices.push(n),
    haptic: (k) => log.haptics.push(k),
    now: () => clock,
    revokeUrl: (u) => log.revoked.push(u),
  });
  return {
    s,
    log,
    at: (t: number) => {
      clock = t;
    },
    press: () => s.dispatch({ type: "press", y: 500 }),
    release: (t: number) => s.dispatch({ type: "release", at: t }),
  };
}

async function clipText(c: VoiceClip) {
  return c.blob.text();
}

// ---------------------------------------------------------------- normal use

test("normal: hold, record, release sends exactly once and releases the microphone", async () => {
  const h = harness();
  h.press();
  assert.equal(h.s.state().kind, "starting");
  assert.equal(env.contexts.length, 1, "AudioContext made inside the press");
  env.requests[0].resolve();
  await flush();
  assert.equal(h.s.state().kind, "recording");
  assert.deepEqual(h.log.haptics, ["medium"]);
  assert.ok(h.s.level() > 0, "the meter reads the live recording");
  const rec = env.recorders[0];
  h.release(3000);
  assert.equal(h.s.state().kind, "idle");
  assert.equal(rec.stopCalls, 1);
  assert.equal(h.log.clips.length, 0, "nothing until the recorder hands over the audio");
  rec.emitStop();
  await flush();
  assert.equal(h.log.clips.length, 1);
  assert.equal(h.log.clips[0].durationMs, 3000);
  assert.equal(await clipText(h.log.clips[0]), "audio-0");
  assert.ok(env.requests[0].stream.allStopped, "tracks stopped");
  assert.equal(env.contexts[0].closes, 1, "context closed");
  // A repeated onstop / dataavailable (a buggy engine) changes nothing.
  rec.emitStop("again");
  await flush();
  assert.equal(h.log.clips.length, 1, "sent once");
  assert.equal(env.contexts[0].closes, 1, "closed once");
  assert.deepEqual(h.log.notices, []);
  assert.deepEqual(h.log.haptics, ["medium", "success"]);
});

test("send-once guard: the same clip handed to a send path twice is claimed once", async () => {
  const clip: VoiceClip = { blob: new Blob(["x"]), durationMs: 1000, mime: "audio/mp4", localUrl: "blob:x" };
  assert.equal(claimVoiceClip(clip), true);
  assert.equal(claimVoiceClip(clip), false);
  assert.equal(claimVoiceClip({ ...clip }), true, "a different clip is its own message");
});

test("60 s: sent automatically once; the later release does nothing", async () => {
  const h = harness();
  h.press();
  env.requests[0].resolve();
  await flush();
  h.s.dispatch({ type: "tick", at: VOICE_MAX_MS });
  h.release(VOICE_MAX_MS + 400);
  h.s.dispatch({ type: "tick", at: VOICE_MAX_MS + 500 });
  assert.equal(env.recorders[0].stopCalls, 1);
  env.recorders[0].emitStop();
  await flush();
  assert.equal(h.log.clips.length, 1);
  assert.equal(h.log.clips[0].durationMs, VOICE_MAX_MS);
});

test("too short: thrown away, microphone released, nothing sent", async () => {
  const h = harness();
  h.press();
  env.requests[0].resolve();
  await flush();
  h.release(200);
  env.recorders[0].emitStop();
  await flush();
  assert.deepEqual(h.log.clips, []);
  assert.deepEqual(h.log.notices, ["tooShort"]);
  assert.ok(env.requests[0].stream.allStopped);
  assert.equal(env.contexts[0].closes, 1);
});

test("slide-cancel while recording: late recorder callbacks deliver nothing", async () => {
  const h = harness();
  h.press();
  env.requests[0].resolve();
  await flush();
  h.s.dispatch({ type: "move", y: 300 });
  h.release(5000);
  assert.ok(env.requests[0].stream.allStopped, "microphone off at once");
  assert.equal(env.contexts[0].closes, 1);
  env.recorders[0].emitStop();
  await flush();
  assert.deepEqual(h.log.clips, []);
  assert.deepEqual(h.log.notices, []);
});

// ---------------------------------------------------------------- the stale-request race

test("race: A starts, released, B starts, A answers first -> A released on its own, B records and is the one sent", async () => {
  const h = harness();
  h.press(); // A
  h.release(100);
  h.press(); // B
  const [a, b] = env.requests;
  const [ctxA, ctxB] = env.contexts;
  a.resolve();
  await flush();
  assert.ok(a.stream.allStopped, "A's tracks stopped");
  assert.equal(ctxA.closes, 1, "A's context closed");
  assert.equal(env.recorders.length, 0, "no recorder was ever made for A");
  assert.equal(h.s.state().kind, "starting", "B still waiting, not hijacked by A");
  assert.equal(b.stream.anyStopped, false);
  assert.equal(ctxB.closes, 0);
  b.resolve();
  await flush();
  assert.equal(h.s.state().kind, "recording");
  assert.equal(env.recorders.length, 1);
  assert.equal(env.recorders[0].stream, b.stream, "the recording is B's microphone");
  h.release(3000);
  env.recorders[0].emitStop("B");
  await flush();
  assert.equal(h.log.clips.length, 1);
  assert.equal(await clipText(h.log.clips[0]), "B");
  assert.ok(b.stream.allStopped);
  assert.equal(ctxB.closes, 1);
  assert.deepEqual(h.log.notices, []);
});

test("race: same, but B answers before A -> A's late answer leaves B's recording alone", async () => {
  const h = harness();
  h.press();
  h.release(100);
  h.press();
  const [a, b] = env.requests;
  const [ctxA, ctxB] = env.contexts;
  b.resolve();
  await flush();
  assert.equal(h.s.state().kind, "recording");
  a.resolve();
  await flush();
  assert.ok(a.stream.allStopped);
  assert.equal(ctxA.closes, 1);
  assert.equal(b.stream.anyStopped, false, "B's microphone untouched");
  assert.equal(ctxB.closes, 0, "B's context untouched");
  assert.equal(h.s.state().kind, "recording");
  assert.equal(env.recorders.length, 1);
  h.release(2000);
  env.recorders[0].emitStop("B");
  await flush();
  assert.equal(h.log.clips.length, 1);
  assert.equal(await clipText(h.log.clips[0]), "B");
});

test("race: A answers late and B is denied -> nothing left on, one denial, nothing sent", async () => {
  const h = harness();
  h.press();
  h.release(100);
  h.press();
  const [a, b] = env.requests;
  a.resolve();
  await flush();
  b.reject("NotAllowedError");
  await flush();
  assert.equal(h.s.state().kind, "idle");
  assert.deepEqual(h.log.notices, ["denied"]);
  assert.ok(a.stream.allStopped, "A's late microphone is off");
  assert.ok(env.contexts.every((c) => c.closes === 1), "both contexts closed once");
  assert.equal(env.recorders.length, 0);
  assert.deepEqual(h.log.clips, []);
});

test("race: B denied first, then A answers late -> A cleaned up, still idle, one denial", async () => {
  const h = harness();
  h.press();
  h.release(100);
  h.press();
  const [a, b] = env.requests;
  b.reject("NotAllowedError");
  await flush();
  a.resolve();
  await flush();
  assert.equal(h.s.state().kind, "idle");
  assert.deepEqual(h.log.notices, ["denied"]);
  assert.ok(a.stream.allStopped);
  assert.ok(env.contexts.every((c) => c.closes === 1));
  assert.deepEqual(h.log.clips, []);
});

test("race: A fails after B is active -> B keeps recording and is sent; A's failure is silent", async () => {
  const h = harness();
  h.press();
  h.release(100);
  h.press();
  const [a, b] = env.requests;
  const [ctxA, ctxB] = env.contexts;
  b.resolve();
  await flush();
  a.reject("NotAllowedError");
  await flush();
  assert.equal(h.s.state().kind, "recording", "a stale failure never resets the newer recording");
  assert.deepEqual(h.log.notices, []);
  assert.equal(ctxA.closes, 1);
  assert.equal(ctxB.closes, 0);
  assert.equal(b.stream.anyStopped, false);
  h.release(4000);
  env.recorders[0].emitStop("B");
  await flush();
  assert.equal(h.log.clips.length, 1);
  assert.equal(await clipText(h.log.clips[0]), "B");
});

test("race: A fails while B is still waiting -> B unaffected", async () => {
  const h = harness();
  h.press();
  h.release(100);
  h.press();
  const [a, b] = env.requests;
  a.reject("NotFoundError");
  await flush();
  assert.equal(h.s.state().kind, "starting");
  assert.deepEqual(h.log.notices, []);
  b.resolve();
  await flush();
  assert.equal(h.s.state().kind, "recording");
});

test("a start that ignores the abort signal and answers late is still discarded by the session", async () => {
  // Defence in depth: ownership is checked in the session as well as in the recorder.
  const discarded: number[] = [];
  const pending: ((v: never) => void)[] = [];
  const h = harness(
    () =>
      new Promise((resolve) => {
        const n = pending.length;
        pending.push(() => resolve({ level: () => 0, stop: async () => null, discard: () => discarded.push(n) } as never));
      }),
  );
  h.press();
  h.release(50);
  h.press();
  pending[0](undefined as never);
  await flush();
  assert.deepEqual(discarded, [0]);
  assert.equal(h.s.state().kind, "starting");
  pending[1](undefined as never);
  await flush();
  assert.equal(h.s.state().kind, "recording");
  assert.deepEqual(discarded, [0]);
});

// ---------------------------------------------------------------- release / unmount / background while pending

test("release while the permission prompt is up, then granted -> microphone released, nothing sent", async () => {
  const h = harness();
  h.press();
  h.release(100);
  env.requests[0].resolve();
  await flush();
  assert.ok(env.requests[0].stream.allStopped);
  assert.equal(env.contexts[0].closes, 1);
  assert.equal(env.recorders.length, 0);
  assert.equal(h.s.state().kind, "idle");
  assert.deepEqual(h.log.clips, []);
  assert.deepEqual(h.log.notices, []);
});

test("release while the permission prompt is up, then denied -> context closed, the denial is still reported", async () => {
  const h = harness();
  h.press();
  h.release(100);
  env.requests[0].reject("NotAllowedError");
  await flush();
  assert.equal(env.contexts[0].closes, 1);
  assert.deepEqual(h.log.notices, ["denied"]);
  assert.equal(h.s.state().kind, "idle");
});

test("unmount while the permission prompt is up -> late grant released, no state or notice after unmount", async () => {
  const h = harness();
  h.press();
  h.s.dispose();
  const states = h.log.states.length;
  env.requests[0].resolve();
  await flush();
  assert.ok(env.requests[0].stream.allStopped);
  assert.equal(env.contexts[0].closes, 1);
  assert.equal(env.recorders.length, 0);
  assert.equal(h.log.states.length, states);
  assert.deepEqual(h.log.notices, []);
  h.press();
  assert.equal(env.requests.length, 1, "a disposed bar never asks again");
});

test("unmount while recording -> stopped and released at once, never sent, late callbacks ignored", async () => {
  const h = harness();
  h.press();
  env.requests[0].resolve();
  await flush();
  const rec = env.recorders[0];
  h.s.dispose();
  assert.equal(rec.stopCalls, 1);
  assert.ok(env.requests[0].stream.allStopped);
  assert.equal(env.contexts[0].closes, 1);
  rec.emitStop();
  await flush();
  assert.deepEqual(h.log.clips, []);
  assert.deepEqual(h.log.notices, []);
});

test("backgrounding (visibilitychange / pagehide / app pause = interrupt) while pending and while recording", async () => {
  const h = harness();
  // Pending: the late grant is released; a fresh hold afterwards works normally.
  h.press();
  h.s.dispatch({ type: "interrupt" });
  env.requests[0].resolve();
  await flush();
  assert.ok(env.requests[0].stream.allStopped);
  assert.equal(env.contexts[0].closes, 1);
  assert.equal(h.s.state().kind, "idle");
  // Recording: thrown away, released, not sent.
  h.press();
  env.requests[1].resolve();
  await flush();
  assert.equal(h.s.state().kind, "recording");
  h.s.dispatch({ type: "interrupt" });
  assert.ok(env.requests[1].stream.allStopped);
  assert.equal(env.contexts[1].closes, 1);
  env.recorders[0].emitStop();
  await flush();
  assert.deepEqual(h.log.clips, []);
  assert.deepEqual(h.log.notices, []);
});

test("a released recording still delivers once if its onstop comes after a newer hold started; the newer one is untouched", async () => {
  const h = harness();
  h.press();
  env.requests[0].resolve();
  await flush();
  h.release(2000); // A released = sent
  h.press(); // B
  env.requests[1].resolve();
  await flush();
  assert.equal(h.s.state().kind, "recording");
  env.recorders[0].emitStop("A");
  await flush();
  assert.equal(h.log.clips.length, 1);
  assert.equal(await clipText(h.log.clips[0]), "A");
  assert.equal(env.requests[1].stream.anyStopped, false, "B's microphone untouched by A's cleanup");
  assert.equal(env.contexts[1].closes, 0);
  assert.equal(h.s.state().kind, "recording");
});

// ---------------------------------------------------------------- partial initialisation / shutdown failures

test("recorder.start() throws after the microphone was acquired -> tracks stopped, context closed, unavailable", async () => {
  env.recorderStartThrows = true;
  const h = harness();
  h.press();
  env.requests[0].resolve();
  await flush();
  assert.ok(env.requests[0].stream.allStopped);
  assert.equal(env.contexts[0].closes, 1);
  assert.equal(env.recorders[0].ondataavailable, null, "recorder callbacks cleared");
  assert.equal(h.s.state().kind, "idle");
  assert.deepEqual(h.log.notices, ["unavailable"]);
  assert.deepEqual(h.log.clips, []);
});

test("MediaRecorder constructor throws -> tracks stopped, context closed", async () => {
  env.recorderCtorThrows = true;
  const h = harness();
  h.press();
  env.requests[0].resolve();
  await flush();
  assert.ok(env.requests[0].stream.allStopped);
  assert.equal(env.contexts[0].closes, 1);
  assert.deepEqual(h.log.notices, ["unavailable"]);
});

test("getUserMedia fails (no microphone) -> context closed, unavailable while held", async () => {
  const h = harness();
  h.press();
  env.requests[0].reject("NotFoundError");
  await flush();
  assert.equal(env.contexts[0].closes, 1);
  assert.deepEqual(h.log.notices, ["unavailable"]);
  assert.equal(h.s.state().kind, "idle");
});

test("no AudioContext / meter setup throws -> still records; cleanup still complete", async () => {
  env.audioContextThrows = true;
  let h = harness();
  h.press();
  env.requests[0].resolve();
  await flush();
  assert.equal(h.s.state().kind, "recording");
  assert.equal(h.s.level(), 0);
  h.release(1500);
  env.recorders[0].emitStop();
  await flush();
  assert.equal(h.log.clips.length, 1);
  assert.ok(env.requests[0].stream.allStopped);

  env.audioContextThrows = false;
  env.meterThrows = true;
  h = harness();
  h.press();
  env.requests[1].resolve();
  await flush();
  assert.equal(h.s.state().kind, "recording");
  h.s.dispatch({ type: "interrupt" });
  assert.ok(env.requests[1].stream.allStopped);
  assert.equal(env.contexts[0].closes, 1);
});

test("a track whose stop() throws doesn't stop the rest of the cleanup", async () => {
  const h = harness();
  h.press();
  env.requests[0].stream.tracks.push(new FakeTrack());
  env.requests[0].stream.tracks[0].throwOnStop = true;
  env.requests[0].resolve();
  await flush();
  h.s.dispatch({ type: "interrupt" });
  assert.ok(env.requests[0].stream.allStopped, "every track was asked to stop");
  assert.equal(env.contexts[0].closes, 1);
});

test("recorder.stop() throws on release -> released, 'failed' notice, nothing sent", async () => {
  const h = harness();
  h.press();
  env.requests[0].resolve();
  await flush();
  env.recorderStopThrows = true;
  h.release(3000);
  await flush();
  assert.ok(env.requests[0].stream.allStopped);
  assert.equal(env.contexts[0].closes, 1);
  assert.deepEqual(h.log.notices, ["failed"]);
  assert.deepEqual(h.log.clips, []);
});

test("onstop never comes -> the watchdog releases the microphone and reports 'failed'; a very late onstop sends nothing", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const h = harness();
    h.press();
    env.requests[0].resolve();
    await flush();
    const rec = env.recorders[0];
    const lateStop = () => rec.emitStop();
    h.release(3000);
    await flush();
    assert.equal(env.requests[0].stream.anyStopped, false, "waiting for the recorder");
    mock.timers.tick(STOP_WATCHDOG_MS);
    await flush();
    assert.ok(env.requests[0].stream.allStopped);
    assert.equal(env.contexts[0].closes, 1);
    assert.deepEqual(h.log.notices, ["failed"]);
    lateStop();
    await flush();
    assert.deepEqual(h.log.clips, []);
  } finally {
    mock.timers.reset();
  }
});

test("a start() that throws synchronously is a failed start, not a stuck bar", async () => {
  const h = harness(() => {
    throw new Error("boom");
  });
  h.press();
  await flush();
  assert.equal(h.s.state().kind, "idle");
  assert.deepEqual(h.log.notices, ["unavailable"]);
});
