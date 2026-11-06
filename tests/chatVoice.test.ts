// Run: npm run test:chat  (node --test, built-in type stripping)
// Voice messages (lib/chatVoice.ts, migration 20261107180000): the
// hold / slide-cancel / max-length state machine, the recording format,
// paths, rows, previews, and the round chat merge of a voice send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VOICE_CANCEL_DY,
  VOICE_MAX_MS,
  VOICE_MIN_MS,
  canRecordVoice,
  clampDuration,
  dmVoicePath,
  formatVoiceDuration,
  isMissingVoiceSupportError,
  parseVoicePath,
  pickVoiceMime,
  roundVoicePath,
  rowsHaveVoiceColumn,
  voiceBubbleWidth,
  voiceContentTypeForPath,
  voiceFileType,
  voiceFromRow,
  voiceRowColumns,
  voiceSecondsLeft,
  voiceStep,
  type VoiceEvent,
  type VoiceState,
} from "../src/lib/chatVoice.ts";
import { messagePreviewText } from "../src/lib/chatImages.ts";
import { createPendingRoundMessage, markRoundMessageSent, mergeRoundMessages } from "../src/lib/roundChat.ts";

const CONV = "0f8fad5b-d9cb-469f-a165-70867728950e";
const MSG = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ROUND = "16fd2706-8baf-433b-82eb-8c7fada847da";

function run(events: VoiceEvent[], start: VoiceState = { kind: "idle" }) {
  let state = start;
  const effects: string[] = [];
  for (const e of events) {
    const r = voiceStep(state, e);
    state = r.state;
    if (r.effect.type !== "none") effects.push(r.effect.type === "stop" ? `stop:${r.effect.durationMs}` : r.effect.type === "discard" ? `discard:${r.effect.reason}` : r.effect.type);
  }
  return { state, effects };
}

// ---------------------------------------------------------------- hold to talk

test("hold: press starts, release after recording sends with the held duration", () => {
  const r = run([{ type: "press", y: 500 }, { type: "started", at: 1000 }, { type: "tick", at: 2000 }, { type: "release", at: 4200 }]);
  assert.deepEqual(r.effects, ["start", "stop:3200"]);
  assert.equal(r.state.kind, "idle");
});

test("hold: a tap (shorter than the minimum) is thrown away as too short", () => {
  const r = run([{ type: "press", y: 500 }, { type: "started", at: 1000 }, { type: "release", at: 1000 + VOICE_MIN_MS - 1 }]);
  assert.deepEqual(r.effects, ["start", "discard:tooShort"]);
});

test("hold: releasing before the microphone answered sends nothing (abort)", () => {
  const r = run([{ type: "press", y: 500 }, { type: "release", at: 900 }]);
  assert.deepEqual(r.effects, ["start", "abort"]);
  // The late "started" is ignored: still idle, no recording.
  const late = voiceStep(r.state, { type: "started", at: 950 });
  assert.equal(late.state.kind, "idle");
  assert.equal(late.effect.type, "none");
});

test("slide up: past the threshold arms cancel; release then discards; sliding back disarms", () => {
  const armed = run([{ type: "press", y: 500 }, { type: "started", at: 0 }, { type: "move", y: 500 - VOICE_CANCEL_DY }]);
  assert.equal(armed.state.kind === "recording" && armed.state.cancelArmed, true);
  assert.deepEqual(run([{ type: "release", at: 5000 }], armed.state).effects, ["discard:cancelled"]);
  const back = run([{ type: "move", y: 500 - VOICE_CANCEL_DY + 1 }], armed.state);
  assert.equal(back.state.kind === "recording" && back.state.cancelArmed, false);
  assert.deepEqual(run([{ type: "release", at: 5000 }], back.state).effects, ["stop:5000"]);
  // Sideways / downward never cancels.
  const down = run([{ type: "press", y: 500 }, { type: "started", at: 0 }, { type: "move", y: 700 }, { type: "release", at: 3000 }]);
  assert.deepEqual(down.effects, ["start", "stop:3000"]);
});

test("max length: at 60 s it's sent automatically (once), unless the finger is on cancel", () => {
  const r = run([{ type: "press", y: 500 }, { type: "started", at: 0 }, { type: "tick", at: VOICE_MAX_MS - 1 }, { type: "tick", at: VOICE_MAX_MS }, { type: "release", at: VOICE_MAX_MS + 500 }]);
  assert.deepEqual(r.effects, ["start", `stop:${VOICE_MAX_MS}`], "the later release does nothing");
  const c = run([{ type: "press", y: 500 }, { type: "started", at: 0 }, { type: "move", y: 300 }, { type: "tick", at: VOICE_MAX_MS }]);
  assert.deepEqual(c.effects, ["start", "discard:cancelled"]);
  // A release reported late is capped at the max.
  assert.deepEqual(run([{ type: "press", y: 1 }, { type: "started", at: 0 }, { type: "release", at: VOICE_MAX_MS + 3000 }]).effects, ["start", `stop:${VOICE_MAX_MS}`]);
});

test("interrupt (touchcancel, app hidden, leaving the thread) never sends", () => {
  assert.deepEqual(run([{ type: "press", y: 1 }, { type: "started", at: 0 }, { type: "interrupt" }]).effects, ["start", "discard:interrupted"]);
  assert.deepEqual(run([{ type: "press", y: 1 }, { type: "interrupt" }]).effects, ["start", "abort"]);
  assert.deepEqual(run([{ type: "interrupt" }]).effects, []);
});

test("hold: a second press while busy is ignored; a failed start returns to idle", () => {
  assert.deepEqual(run([{ type: "press", y: 1 }, { type: "press", y: 2 }]).effects, ["start"]);
  const f = run([{ type: "press", y: 1 }, { type: "failed" }]);
  assert.equal(f.state.kind, "idle");
  // A failure report never resets a recording (a stale attempt's failure).
  const r = run([{ type: "press", y: 1 }, { type: "started", at: 0 }, { type: "failed" }]);
  assert.equal(r.state.kind, "recording");
});

test("countdown: the last 10 seconds are counted down", () => {
  assert.equal(voiceSecondsLeft(0), null);
  assert.equal(voiceSecondsLeft(49_999), null);
  assert.equal(voiceSecondsLeft(50_000), 10);
  assert.equal(voiceSecondsLeft(59_100), 1);
  assert.equal(voiceSecondsLeft(61_000), 0);
});

// ---------------------------------------------------------------- format

test("format: AAC/MP4 first (plays on every iPhone), then WebM/Opus, null when nothing", () => {
  const safari = (t: string) => t.startsWith("audio/mp4");
  const chrome = (t: string) => t.startsWith("audio/webm");
  const both = () => true;
  assert.equal(pickVoiceMime(safari), "audio/mp4;codecs=mp4a.40.2");
  assert.equal(pickVoiceMime(chrome), "audio/webm;codecs=opus");
  assert.equal(pickVoiceMime(both), "audio/mp4;codecs=mp4a.40.2");
  assert.equal(pickVoiceMime(() => false), null);
  assert.equal(pickVoiceMime(null), null);
  assert.equal(pickVoiceMime(() => {
    throw new Error("x");
  }), null);
  // Plain audio/mp4 only (some Safari builds): still mp4.
  assert.equal(pickVoiceMime((t) => t === "audio/mp4"), "audio/mp4");
});

test("format: extension and stored Content-Type (no codec parameters)", () => {
  assert.deepEqual(voiceFileType("audio/mp4;codecs=mp4a.40.2"), { ext: "m4a", contentType: "audio/mp4" });
  assert.deepEqual(voiceFileType("audio/mp4"), { ext: "m4a", contentType: "audio/mp4" });
  assert.deepEqual(voiceFileType("audio/webm;codecs=opus"), { ext: "webm", contentType: "audio/webm" });
  assert.equal(voiceContentTypeForPath(`dm/${CONV}/${MSG}.webm`), "audio/webm");
  assert.equal(voiceContentTypeForPath(`dm/${CONV}/${MSG}.m4a`), "audio/mp4");
});

test("feature detection: mic button only with getUserMedia + MediaRecorder + a type", () => {
  const yes = (t: string) => t === "audio/webm";
  assert.equal(canRecordVoice({ getUserMedia: true, mediaRecorder: true, isTypeSupported: yes }), true);
  assert.equal(canRecordVoice({ getUserMedia: false, mediaRecorder: true, isTypeSupported: yes }), false);
  assert.equal(canRecordVoice({ getUserMedia: true, mediaRecorder: false, isTypeSupported: yes }), false);
  assert.equal(canRecordVoice({ getUserMedia: true, mediaRecorder: true, isTypeSupported: () => false }), false);
});

// ---------------------------------------------------------------- paths + rows

test("paths: dm/round + uuid + uuid + .m4a/.webm, the database's rule", () => {
  assert.equal(dmVoicePath(CONV, MSG, "m4a"), `dm/${CONV}/${MSG}.m4a`);
  assert.equal(roundVoicePath(ROUND.toUpperCase(), MSG, "webm"), `round/${ROUND}/${MSG}.webm`);
  assert.deepEqual(parseVoicePath(`dm/${CONV}/${MSG}.m4a`), { scope: "dm", scopeId: CONV, messageId: MSG, ext: "m4a" });
  for (const bad of [`dm/${CONV}/${MSG}.mp3`, `dm/${CONV}/${MSG}.jpg`, `dm/${CONV}/../${MSG}.m4a`]) assert.equal(parseVoicePath(bad), null, bad);
  assert.throws(() => dmVoicePath("x", MSG, "m4a"));
  const migration = readFileSync(join(import.meta.dirname, "..", "supabase", "migrations", "20261107180000_chat_voice.sql"), "utf8");
  assert.ok(migration.includes("\\.(jpg|m4a|webm)$'"));
  assert.ok(migration.includes("'dm/' || conversation_id::text || '/' || id::text || '.m4a'"));
  assert.ok(migration.includes("audio_duration_ms between 1 and 61000"));
});

test("rows: audio columns <-> ChatVoiceRef; duration clamped to the database's range", () => {
  assert.equal(voiceFromRow({}), null);
  assert.equal(voiceFromRow({ audio_path: "p", audio_duration_ms: null }), null);
  assert.deepEqual(voiceFromRow({ audio_path: "p", audio_duration_ms: 4200 }), { path: "p", durationMs: 4200 });
  assert.deepEqual(voiceRowColumns({ path: "p", durationMs: 70_000.4 }), { audio_path: "p", audio_duration_ms: 61_000 });
  assert.equal(clampDuration(0), 1);
  assert.equal(clampDuration(Number.NaN), 1);
  assert.equal(rowsHaveVoiceColumn([{ id: 1 }]), false);
  assert.equal(rowsHaveVoiceColumn([{ id: 1, audio_path: null }]), true);
  assert.equal(isMissingVoiceSupportError({ code: "42703", message: "column messages.audio_path does not exist" }), true);
  assert.equal(isMissingVoiceSupportError({ code: "PGRST204", message: "Could not find the 'image_path' column" }), false);
});

test("display: m:ss rounded up while > 0; bubble width grows with the length", () => {
  assert.deepEqual([0, 300, 1000, 4200, 59_600, 60_000].map(formatVoiceDuration), ["0:00", "0:01", "0:01", "0:04", "1:00", "1:00"]);
  assert.ok(voiceBubbleWidth(1000) < voiceBubbleWidth(10_000) && voiceBubbleWidth(10_000) < voiceBubbleWidth(60_000));
  assert.equal(voiceBubbleWidth(60_000), 232);
  assert.equal(voiceBubbleWidth(120_000), 232);
});

test("preview: '[Voice message]' (Inbox, quotes, reply bar; no emoji in UI strings)", () => {
  assert.equal(messagePreviewText({ text: "", voice: { path: "p", durationMs: 1000 } }, "[Photo]", "[Voice message]"), "[Voice message]");
  assert.equal(messagePreviewText({ text: "", voice: { path: "p", durationMs: 1000 } }, "[Photo]"), "[Voice message]");
  assert.equal(messagePreviewText({ text: "x" }, "[Photo]", "[Voice message]"), "x");
  assert.doesNotMatch(messagePreviewText({ text: "", voice: { path: "p", durationMs: 1 } }, "[Photo]"), /\p{Extended_Pictographic}/u);
});

test("round merge: a sending voice message, then sent with its real path", () => {
  const path = roundVoicePath(ROUND, MSG, "m4a");
  const pending = [
    createPendingRoundMessage({
      clientId: `temp-${MSG}`,
      roundId: ROUND,
      senderId: "me",
      text: "",
      photo: { messageId: MSG, localUrl: "blob:v", width: 0, height: 0, thumb: null, progress: 0.4, audio: { durationMs: 3000, mime: "audio/mp4" } },
    }),
  ];
  const [m] = mergeRoundMessages([], pending, ROUND);
  assert.equal(m.delivery, "sending");
  assert.deepEqual(m.voice, { path: `pending/${MSG}`, durationMs: 3000 });
  assert.equal("image" in m, false);
  assert.equal(m.outgoingPhoto?.progress, 0.4);
  const sent = markRoundMessageSent(
    pending.map((p) => ({ ...p, photo: { ...p.photo!, path } })),
    `temp-${MSG}`,
    { id: MSG, created_at: "2026-11-06T10:00:00Z" },
  );
  const [s] = mergeRoundMessages([], sent, ROUND);
  assert.equal(s.delivery, undefined);
  assert.deepEqual(s.voice, { path, durationMs: 3000 });
  const row = { id: MSG, round_id: ROUND, sender_id: "me", text: "", created_at: "2026-11-06T10:00:00Z", audio_path: path, audio_duration_ms: 3000 };
  const merged = mergeRoundMessages([row], sent, ROUND);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].voice, { path, durationMs: 3000 });
});
