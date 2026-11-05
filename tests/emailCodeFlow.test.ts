// Run: npm run test:onboarding  (node --test, built-in type stripping)
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  RESEND_COOLDOWN_SECONDS,
  SESSION_EXPIRED,
  classifyAuthNotice,
  sanitizeCode,
  shouldAutoSubmit,
  createRequestGate,
  gatedRequest,
  isFailedLinkError,
  msUntilNextSecond,
  resendSecondsLeft,
  watchResendCountdown,
} from "../src/lib/emailCodeFlow.ts";
import { loadEmailDraft, saveEmailDraft, normalizeEmail } from "../src/lib/authInput.ts";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

// A stand-in for the sign-in screen's email flow, using the same calls the
// Auth page makes: the address is captured at submit, sends and verifies go
// through gates, "Change email" cancels.
function screen(send: (address: string) => Promise<void>, verify: (address: string, code: string) => Promise<void>) {
  const sendGate = createRequestGate();
  const verifyGate = createRequestGate();
  const s = { field: "", sentTo: null as string | null, sends: [] as string[], verifies: [] as string[], error: null as string | null, resent: 0 };
  return {
    s,
    async submit() {
      if (sendGate.inFlight) return "busy";
      const address = normalizeEmail(s.field);
      const r = await gatedRequest(sendGate, () => {
        s.sends.push(address);
        return send(address);
      });
      if (r.status === "ok") s.sentTo = address;
      if (r.status === "error") s.error = "send failed";
      return r.status;
    },
    async resend() {
      if (!s.sentTo || sendGate.inFlight) return "busy";
      const address = s.sentTo;
      const r = await gatedRequest(sendGate, () => {
        s.sends.push(address);
        return send(address);
      });
      if (r.status === "ok") s.resent += 1;
      return r.status;
    },
    async verify(code: string) {
      if (!s.sentTo || verifyGate.inFlight) return "busy";
      const address = s.sentTo;
      const r = await gatedRequest(verifyGate, () => {
        s.verifies.push(`${address}:${code}`);
        return verify(address, code);
      });
      if (r.status === "error") s.error = "wrong code";
      return r.status;
    },
    changeEmail() {
      sendGate.cancel();
      verifyGate.cancel();
      s.field = s.sentTo ?? s.field;
      s.sentTo = null;
    },
    get sending() {
      return sendGate.inFlight;
    },
  };
}

test("gate: one request at a time, cancelled ones come back stale", async () => {
  const gate = createRequestGate();
  const a = gate.begin();
  assert.equal(typeof a, "number");
  assert.equal(gate.begin(), null); // double tap
  assert.equal(gate.inFlight, true);
  gate.cancel();
  assert.equal(gate.isCurrent(a!), false);
  const b = gate.begin();
  assert.notEqual(b, a);
  assert.equal(gate.end(a!), false); // the old answer
  assert.equal(gate.inFlight, true);
  assert.equal(gate.end(b!), true);
  assert.equal(gate.inFlight, false);
});

test("delayed send with an edit in between: the code screen is bound to the submitted address", async () => {
  const d = deferred();
  const ui = screen(() => d.promise, async () => {});
  ui.s.field = "a@example.com";
  const pending = ui.submit();
  assert.equal(ui.sending, true);
  // The real field is disabled while sending; even if text changed anyway:
  ui.s.field = "b@example.com";
  assert.equal(await ui.submit(), "busy"); // Enter again / double tap
  d.resolve();
  assert.equal(await pending, "ok");
  assert.equal(ui.s.sentTo, "a@example.com");
  assert.deepEqual(ui.s.sends, ["a@example.com"]);
  await ui.verify("123456");
  assert.deepEqual(ui.s.verifies, ["a@example.com:123456"]);
});

test("Change email: a resend still in flight is ignored, the new address wins", async () => {
  const sends = new Map<string, ReturnType<typeof deferred>>();
  const ui = screen(
    (address) => {
      const d = deferred();
      sends.set(address + sends.size, d);
      return d.promise;
    },
    async () => {},
  );
  ui.s.field = "a@example.com";
  const first = ui.submit();
  [...sends.values()][0].resolve();
  await first;
  const resend = ui.resend(); // to A, slow
  ui.changeEmail();
  assert.equal(ui.s.field, "a@example.com"); // address kept for editing
  assert.equal(ui.sending, false);
  ui.s.field = "b@example.com";
  const second = ui.submit();
  [...sends.values()][2].resolve(); // B answers first
  assert.equal(await second, "ok");
  [...sends.values()][1].resolve(); // A's late answer
  assert.equal(await resend, "stale");
  assert.equal(ui.s.sentTo, "b@example.com");
  assert.equal(ui.s.resent, 0); // no "New email sent" toast for the stale one
  await ui.verify("654321");
  assert.deepEqual(ui.s.verifies, ["b@example.com:654321"]);
});

test("resend uses the bound address and a double tap sends once", async () => {
  let calls = 0;
  const ui = screen(
    async () => {
      calls += 1;
    },
    async () => {},
  );
  ui.s.field = "a@example.com";
  await ui.submit();
  ui.s.field = "typo@example.com"; // not used by resend
  const [r1, r2] = await Promise.all([ui.resend(), ui.resend()]);
  assert.deepEqual([r1, r2].sort(), ["busy", "ok"]);
  assert.equal(calls, 2);
  assert.deepEqual(ui.s.sends, ["a@example.com", "a@example.com"]);
});

test("failed send keeps the email step; a failure after Change email is ignored", async () => {
  const ui = screen(
    async () => {
      throw Object.assign(new Error("Load failed"), { status: 0 });
    },
    async () => {},
  );
  ui.s.field = "a@example.com";
  assert.equal(await ui.submit(), "error");
  assert.equal(ui.s.sentTo, null);
  assert.equal(ui.sending, false); // field usable again

  let n = 0;
  const slow = deferred();
  const ui2 = screen(() => (n++ === 0 ? Promise.resolve() : slow.promise), async () => {});
  ui2.s.field = "a@example.com";
  await ui2.submit();
  const r = ui2.resend();
  ui2.changeEmail();
  slow.reject({ status: 429, code: "over_email_send_rate_limit" });
  assert.equal(await r, "stale");
  assert.equal(ui2.s.error, null); // no toast for a screen that's gone
});

test("verification goes to the bound address; a wrong code is reported, a stale verify is not", async () => {
  const d = deferred();
  const ui = screen(async () => {}, () => d.promise);
  ui.s.field = " a@example.com ";
  await ui.submit();
  assert.equal(ui.s.sentTo, "a@example.com");
  const v = ui.verify("111111");
  assert.equal(await ui.verify("111111"), "busy");
  ui.changeEmail();
  d.reject({ status: 403 });
  assert.equal(await v, "stale");
  assert.equal(ui.s.error, null);
  assert.deepEqual(ui.s.verifies, ["a@example.com:111111"]);
});

test("draft keeps the bound address across a reload; old drafts fall back to their email", () => {
  const s = memoryStore();
  const now = 1_800_000_000_000;
  saveEmailDraft({ email: "b@example.com", open: true, sentAt: now, sentTo: "a@example.com" }, s);
  const d = loadEmailDraft(now + 1000, s);
  assert.equal(d?.sentTo, "a@example.com");
  assert.equal(d?.email, "b@example.com");
  s.setItem("golfme.auth.emailDraft", JSON.stringify({ email: "old@example.com", open: true, sentAt: now }));
  assert.equal(loadEmailDraft(now + 1000, s)?.sentTo, "old@example.com");
  s.setItem("golfme.auth.emailDraft", JSON.stringify({ email: "x@example.com", open: true, sentAt: now, sentTo: "nope" }));
  const bad = loadEmailDraft(now + 1000, s);
  assert.equal(bad?.sentAt, null);
  assert.equal(bad?.sentTo, null);
});

test("failed-link errors: expired and already-used links, not other errors", () => {
  assert.equal(isFailedLinkError("otp_expired"), true);
  assert.equal(isFailedLinkError("Email link is invalid or has expired"), true);
  assert.equal(isFailedLinkError("Email+link+is+invalid+or+has+expired".replace(/\+/g, " ")), true);
  assert.equal(isFailedLinkError("access_denied"), false);
  assert.equal(isFailedLinkError("server_error"), false);
  assert.equal(isFailedLinkError(null), false);
  assert.equal(isFailedLinkError(""), false);
});

test("code boxes: paste and autofill keep digits only, never more than six", () => {
  assert.equal(sanitizeCode("123456", 6), "123456");
  assert.equal(sanitizeCode("123 456", 6), "123456");
  assert.equal(sanitizeCode("123-456", 6), "123456");
  assert.equal(sanitizeCode(" Your code: 987654 ", 6), "987654");
  assert.equal(sanitizeCode("1234567890", 6), "123456");
  assert.equal(sanitizeCode("１２３４５６", 6), "123456"); // full-width digits from a CJK keyboard
  assert.equal(sanitizeCode("", 6), "");
});

test("auto-submit: once all six are in, once per code", () => {
  assert.equal(shouldAutoSubmit("12345", 6, null), false);
  assert.equal(shouldAutoSubmit("123456", 6, null), true);
  assert.equal(shouldAutoSubmit("123456", 6, "123456"), false); // same wrong code again, or a re-render
  assert.equal(shouldAutoSubmit("654321", 6, "123456"), true); // a corrected code
});

test("auth notices: expired/used link, lapsed session, cancelled Apple, anything else", () => {
  assert.equal(classifyAuthNotice(null), null);
  assert.equal(classifyAuthNotice("otp_expired"), "linkExpired");
  assert.equal(classifyAuthNotice("Email link is invalid or has expired"), "linkExpired");
  assert.equal(classifyAuthNotice(SESSION_EXPIRED), "sessionExpired");
  assert.equal(classifyAuthNotice("user_cancelled_authorize"), "canceled");
  assert.equal(classifyAuthNotice("The user canceled the sign-in"), "canceled");
  assert.equal(classifyAuthNotice("server_error"), "other");
  assert.equal(classifyAuthNotice("bad_oauth_state"), "other");
});

test("countdown from the send time and the clock, skew ends it", () => {
  const t0 = 1_800_000_000_000;
  assert.equal(resendSecondsLeft(null, t0), 0);
  assert.equal(resendSecondsLeft(t0, t0), RESEND_COOLDOWN_SECONDS);
  assert.equal(resendSecondsLeft(t0, t0 + 999), 60);
  assert.equal(resendSecondsLeft(t0, t0 + 1000), 59);
  assert.equal(resendSecondsLeft(t0, t0 + 59_999), 1);
  assert.equal(resendSecondsLeft(t0, t0 + 60_000), 0);
  assert.equal(resendSecondsLeft(t0, t0 + 10 * 60_000), 0); // back from Mail later
  assert.equal(resendSecondsLeft(t0, t0 - 5_000), 0); // clock moved back: ends
  assert.equal(resendSecondsLeft(t0, t0 - 365 * 86_400_000), 0); // huge skew
  assert.equal(resendSecondsLeft(Number.NaN, t0), 0);
  assert.equal(resendSecondsLeft(t0, Number.POSITIVE_INFINITY), 0);
  assert.equal(msUntilNextSecond(t0, t0 + 250), 750);
  assert.equal(msUntilNextSecond(t0, t0 + 60_000), null);
  assert.equal(msUntilNextSecond(null, t0), null);
});

function fakeEnv() {
  const resume = new Set<() => void>();
  return {
    resume,
    env: {
      now: () => Date.now(),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
      onResume: (fn: () => void) => {
        resume.add(fn);
        return () => resume.delete(fn);
      },
    },
  };
}

test("fake timers: counts down second by second, then stops scheduling", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_800_000_000_000 });
  try {
    const sentAt = Date.now();
    const shown: number[] = [];
    const { env, resume } = fakeEnv();
    const stop = watchResendCountdown(sentAt, (now) => shown.push(resendSecondsLeft(sentAt, now)), env);
    assert.deepEqual(shown, [60]);
    for (let i = 0; i < 3; i++) mock.timers.tick(1000);
    assert.deepEqual(shown, [60, 59, 58, 57]);
    for (let i = 0; i < 57; i++) mock.timers.tick(1000);
    assert.equal(shown.at(-1), 0);
    assert.equal(shown.length, 61); // one update per second, no repeats
    const ticks = shown.length;
    for (let i = 0; i < 10; i++) mock.timers.tick(1000);
    assert.equal(shown.length, ticks); // no timer once it's over
    stop();
    assert.equal(resume.size, 0);
  } finally {
    mock.timers.reset();
  }
});

test("fake timers: background then resume recomputes from the clock, no extra wait", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_800_000_000_000 });
  try {
    const sentAt = Date.now();
    let left = -1;
    const { env, resume } = fakeEnv();
    const stop = watchResendCountdown(sentAt, (now) => (left = resendSecondsLeft(sentAt, now)), env);
    for (let i = 0; i < 5; i++) mock.timers.tick(1000);
    assert.equal(left, 55);
    // Backgrounded for 40 s (going to Mail): the clock moves, timers don't fire.
    mock.timers.setTime(sentAt + 45_000);
    assert.equal(left, 55); // stale until the app shows again
    resume.forEach((fn) => fn());
    assert.equal(left, 15);
    mock.timers.tick(1000);
    assert.equal(left, 14);
    // Gone longer than the cooldown: resume ends it at once.
    mock.timers.setTime(sentAt + 5 * 60_000);
    resume.forEach((fn) => fn());
    assert.equal(left, 0);
    // Several resume signals together (visibilitychange + focus) are harmless.
    resume.forEach((fn) => fn());
    resume.forEach((fn) => fn());
    assert.equal(left, 0);
    stop();
  } finally {
    mock.timers.reset();
  }
});

test("fake timers: clock set backwards during the wait ends the countdown", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_800_000_000_000 });
  try {
    const sentAt = Date.now();
    let left = -1;
    const { env, resume } = fakeEnv();
    const stop = watchResendCountdown(sentAt, (now) => (left = resendSecondsLeft(sentAt, now)), env);
    mock.timers.setTime(sentAt - 3_600_000);
    resume.forEach((fn) => fn());
    assert.equal(left, 0);
    stop();
  } finally {
    mock.timers.reset();
  }
});

test("no countdown, no listeners: a null start ticks once and subscribes to nothing", () => {
  const { env, resume } = fakeEnv();
  let calls = 0;
  const stop = watchResendCountdown(null, () => (calls += 1), env);
  assert.equal(calls, 1);
  assert.equal(resume.size, 0);
  stop();
});

test("stopped watcher ignores a late resume", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_800_000_000_000 });
  try {
    const sentAt = Date.now();
    let calls = 0;
    const { env, resume } = fakeEnv();
    const fns: Array<() => void> = [];
    const stop = watchResendCountdown(sentAt, () => (calls += 1), {
      ...env,
      onResume: (fn) => {
        fns.push(fn);
        return env.onResume(fn);
      },
    });
    stop();
    fns.forEach((fn) => fn());
    mock.timers.tick(5000);
    assert.equal(calls, 1);
    assert.equal(resume.size, 0);
  } finally {
    mock.timers.reset();
  }
});
