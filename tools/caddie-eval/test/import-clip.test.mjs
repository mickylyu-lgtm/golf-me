// node --test tools/caddie-eval/test/*.test.mjs
// Uses throwaway temp folders and fake video bytes only. No network, no real clips.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_COACH_AGREEMENT_VERSION,
  EvalError,
  SCREEN_SHARE_PLATFORM_REVIEW,
  addCoach,
  assertCoachSessionAllowed,
  revokeCoach,
  validateCoachRecord,
  validateLabelRecord,
  MAX_RETENTION_DAYS,
  VENDOR_TERMS_VERIFIED,
  addConsent,
  assertSafeDataDir,
  assertThirdPartyAllowed,
  coachEligible,
  enforceRetention,
  importClip,
  initDataDir,
  protocolSlot,
  statusSummary,
  thirdPartyEligible,
  validateConsentRecord,
  verifyDataDir,
  withdrawContributor,
} from "../import-clip.mjs";

const TODAY = "2026-10-21";
const NO_FFMPEG = { GOLFME_EVAL_FFMPEG: "/nonexistent/ffmpeg", GOLFME_EVAL_FFPROBE: "/nonexistent/ffprobe" };

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function setup() {
  const root = tmp("caddie-eval-test-");
  const dataDir = path.join(root, "data");
  initDataDir(dataDir);
  const srcDir = path.join(root, "phone");
  fs.mkdirSync(srcDir);
  return { root, dataDir, srcDir };
}

let counter = 0;
/** Minimal bytes that pass the MP4 box sniff. Unique per call so hashes differ. */
function fakeVideo(dir, name = "IMG_0001.MOV") {
  const file = path.join(dir, name);
  const body = Buffer.from(`fake video payload ${counter++} ${Math.random()}`);
  const header = Buffer.from([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70]); // ....ftyp
  fs.writeFileSync(file, Buffer.concat([header, body]));
  return file;
}

function consent(dataDir, overrides = {}) {
  return addConsent(
    dataDir,
    {
      contributor: "C001",
      formVersion: "1.1",
      consentDate: "2026-10-20",
      retentionUntil: "2027-01-18",
      adult: true,
      affirmativeConsent: true,
      coachViewing: true,
      remoteCoachViewing: false,
      thirdPartyRoboflow: false,
      thirdPartyGemini: false,
      ...overrides,
    },
    TODAY,
  );
}

const CAPTURE = { angle: "face_on", club: "driver", mount: "tripod", handedness: "right", lighting: "daylight", skill: "mid" };

function importOpts(file, overrides = {}) {
  return { contributor: "C001", file, ...CAPTURE, conditions: [], ...overrides };
}

test("refuses a data directory inside the GolfMe repo or any git work tree", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  assert.throws(() => assertSafeDataDir(path.join(here, "eval-data")), EvalError);
  const root = tmp("caddie-eval-git-");
  fs.mkdirSync(path.join(root, ".git"));
  assert.throws(() => assertSafeDataDir(path.join(root, "nested", "data")), /git work tree/);
});

test("refuses a cloud-sync folder and a relative path", () => {
  const root = tmp("caddie-eval-cloud-");
  assert.throws(() => assertSafeDataDir(path.join(root, "Dropbox", "eval")), /cloud-sync/);
  assert.throws(() => assertSafeDataDir(path.join(root, "OneDrive - Personal", "eval")), /cloud-sync/);
  assert.throws(() => assertSafeDataDir("relative/dir"), /absolute/);
});

test("refuses a symlink that points into a git work tree", (t) => {
  const root = tmp("caddie-eval-link-");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  try {
    fs.symlinkSync(repo, path.join(root, "innocent"), "dir");
  } catch {
    t.skip("symlinks unavailable");
    return;
  }
  assert.throws(() => assertSafeDataDir(path.join(root, "innocent", "data")), /git work tree/);
});

test("refuses a clip with no consent record", async () => {
  const { dataDir, srcDir } = setup();
  await assert.rejects(importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, TODAY), /no consent record/);
});

test("consent record rejects extra fields (no names or emails), minors, non-affirmative consent, and retention over 90 days", () => {
  const good = {
    schema: 2,
    contributorId: "C001",
    status: "active",
    formVersion: "1.1",
    consentDate: "2026-10-20",
    retentionUntil: "2027-01-18",
    adult: true,
    affirmativeConsent: true,
    permittedUses: ["caddie_eval"],
    coachViewing: true,
    remoteCoachViewing: false,
    thirdPartyRoboflow: false,
    thirdPartyGemini: false,
    withdrawnAt: null,
    expiredAt: null,
  };
  assert.equal(MAX_RETENTION_DAYS, 90);
  assert.deepEqual(validateConsentRecord(good), []);
  assert.ok(validateConsentRecord({ ...good, name: "Jane" }).some((p) => p.includes('"name"')));
  assert.ok(validateConsentRecord({ ...good, email: "a@b.c" }).length > 0);
  assert.ok(validateConsentRecord({ ...good, adult: false }).length > 0);
  assert.ok(validateConsentRecord({ ...good, affirmativeConsent: false }).some((p) => p.includes("affirmativeConsent")));
  assert.ok(validateConsentRecord({ ...good, affirmativeConsent: undefined }).length > 0);
  // 2026-10-20 + 90 days = 2027-01-18: allowed; one day more is refused.
  assert.ok(validateConsentRecord({ ...good, retentionUntil: "2027-01-19" }).some((p) => p.includes("90 days")));
  assert.ok(validateConsentRecord({ ...good, retentionUntil: "2027-10-20" }).length > 0);
  assert.ok(validateConsentRecord({ ...good, remoteCoachViewing: true, coachViewing: false }).length > 0);
  assert.ok(validateConsentRecord({ ...good, thirdPartyGemini: "yes" }).length > 0);
  assert.ok(validateConsentRecord({ ...good, schema: 1 }).length > 0);
  assert.ok(validateConsentRecord({ ...good, permittedUses: ["caddie_eval", "marketing"] }).length > 0);
  assert.ok(validateConsentRecord({ ...good, contributorId: "jane" }).length > 0);
});

test("consent-add refuses an old form version, a duplicate ID, and an already-passed retention date", () => {
  const { dataDir } = setup();
  assert.throws(() => consent(dataDir, { formVersion: "1.0" }), /not the current form/);
  assert.throws(() => consent(dataDir, { consentDate: "2026-07-01", retentionUntil: "2026-09-01" }), /already passed/);
  consent(dataDir);
  assert.throws(() => consent(dataDir), /NEW ID/);
});

test("imports with consent: pseudonymous ID, sha256, manifest entry, no original name kept", async () => {
  const { dataDir, srcDir } = setup();
  consent(dataDir);
  const src = fakeVideo(srcDir, "Jane_Smith_swing.MOV");
  const entry = await importClip(dataDir, importOpts(src), NO_FFMPEG, TODAY);
  assert.equal(entry.clipId, "C001-0001");
  assert.equal(entry.storedFile, "C001-0001.mov");
  assert.equal(entry.protocolSlot, "FO-DR-TRI-RH-DAY");
  assert.match(entry.storedSha256, /^[0-9a-f]{64}$/);
  assert.equal(entry.sourceSha256, entry.storedSha256); // plain copy without ffmpeg
  assert.equal(entry.metadataStripped, false);
  assert.equal(entry.metadataVerified, null);
  assert.ok(fs.existsSync(src), "original is left untouched");
  const everything = ["manifest.json", "audit-log.jsonl"].map((f) => fs.readFileSync(path.join(dataDir, f), "utf8")).join("");
  assert.ok(!everything.includes("Jane"), "original file name never recorded");
  assert.ok(!everything.includes(srcDir), "source path never recorded");
  const second = await importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, TODAY);
  assert.equal(second.clipId, "C001-0002");
  assert.deepEqual(await verifyDataDir(dataDir, TODAY), [
    "C001-0001: metadata not stripped (manual step pending)",
    "C001-0002: metadata not stripped (manual step pending)",
  ]);
});

test("refuses duplicates, non-videos, wrong extensions, symlinks, and bad capture labels", async (t) => {
  const { dataDir, srcDir } = setup();
  consent(dataDir);
  const src = fakeVideo(srcDir);
  await importClip(dataDir, importOpts(src), NO_FFMPEG, TODAY);
  await assert.rejects(importClip(dataDir, importOpts(src), NO_FFMPEG, TODAY), /already imported as C001-0001/);

  const txt = path.join(srcDir, "notes.mov");
  fs.writeFileSync(txt, "not a video at all");
  await assert.rejects(importClip(dataDir, importOpts(txt), NO_FFMPEG, TODAY), /does not look like/);

  const avi = fakeVideo(srcDir, "clip.avi");
  await assert.rejects(importClip(dataDir, importOpts(avi), NO_FFMPEG, TODAY), /only \.mp4/);

  await assert.rejects(importClip(dataDir, importOpts(fakeVideo(srcDir), { angle: "45_degrees" }), NO_FFMPEG, TODAY), /--angle/);
  await assert.rejects(importClip(dataDir, importOpts(fakeVideo(srcDir), { conditions: ["Jane"] }), NO_FFMPEG, TODAY), /unknown --condition/);

  const link = path.join(srcDir, "link.mov");
  try {
    fs.symlinkSync(fakeVideo(srcDir), link);
  } catch {
    t.diagnostic("symlinks unavailable; skipped symlink case");
    return;
  }
  await assert.rejects(importClip(dataDir, importOpts(link), NO_FFMPEG, TODAY), /regular file/);
});

test("--require-strip refuses when ffmpeg is missing", async () => {
  const { dataDir, srcDir } = setup();
  consent(dataDir);
  await assert.rejects(importClip(dataDir, importOpts(fakeVideo(srcDir), { requireStrip: true }), NO_FFMPEG, TODAY), /ffmpeg not found/);
  assert.equal(statusSummary(dataDir, TODAY).clips, 0);
});

test("--stripped-manually records an attested manual strip that verify accepts", async () => {
  const { dataDir, srcDir } = setup();
  consent(dataDir);
  const entry = await importClip(dataDir, importOpts(fakeVideo(srcDir), { strippedManually: true }), NO_FFMPEG, TODAY);
  assert.equal(entry.metadataStripped, true);
  assert.equal(entry.stripMethod, "manual_attested");
  assert.deepEqual(await verifyDataDir(dataDir, TODAY), []);
  await assert.rejects(
    importClip(dataDir, importOpts(fakeVideo(srcDir), { strippedManually: true, requireStrip: true }), NO_FFMPEG, TODAY),
    /ffmpeg not found/,
  );
});

test("uses ffmpeg when available and records the stripped file's hash", async (t) => {
  if (process.platform === "win32") {
    t.skip("fake ffmpeg is a shell script");
    return;
  }
  const { root, dataDir, srcDir } = setup();
  consent(dataDir);
  // Fake ffmpeg: answers -version, otherwise writes ftyp + "stripped" to its last argument.
  const fake = path.join(root, "fake-ffmpeg.sh");
  fs.writeFileSync(
    fake,
    '#!/bin/sh\nif [ "$1" = "-version" ]; then exit 0; fi\nfor last; do :; done\nprintf \'\\000\\000\\000\\024ftypstripped\' > "$last"\n',
    { mode: 0o755 },
  );
  const entry = await importClip(
    dataDir,
    importOpts(fakeVideo(srcDir)),
    { GOLFME_EVAL_FFMPEG: fake, GOLFME_EVAL_FFPROBE: "/nonexistent/ffprobe" },
    TODAY,
  );
  assert.equal(entry.metadataStripped, true);
  assert.equal(entry.metadataVerified, null);
  assert.notEqual(entry.storedSha256, entry.sourceSha256);
  assert.equal(fs.readFileSync(path.join(dataDir, "clips", entry.storedFile), "latin1").slice(4), "ftypstripped");
  assert.deepEqual(await verifyDataDir(dataDir, TODAY), []);
});

test("withdraw: dry run deletes nothing; confirm deletes clips, derived and label data, and blocks new imports", async () => {
  const { dataDir, srcDir } = setup();
  consent(dataDir);
  consent(dataDir, { contributor: "C002" });
  const a = await importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, TODAY);
  const b = await importClip(dataDir, importOpts(fakeVideo(srcDir), { contributor: "C002" }), NO_FFMPEG, TODAY);
  fs.mkdirSync(path.join(dataDir, "derived", a.clipId));
  fs.writeFileSync(path.join(dataDir, "derived", a.clipId, "pose-roboflow.json"), "{}");
  fs.writeFileSync(path.join(dataDir, "labels", `${a.clipId}-K01.json`), "{}");
  fs.mkdirSync(path.join(dataDir, "derived", b.clipId));

  const dry = withdrawContributor(dataDir, "C001", {}, TODAY);
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.clipIds, ["C001-0001"]);
  assert.ok(fs.existsSync(path.join(dataDir, "clips", a.storedFile)));

  const done = withdrawContributor(dataDir, "C001", { confirm: true }, TODAY);
  assert.equal(done.dryRun, false);
  assert.ok(!fs.existsSync(path.join(dataDir, "clips", a.storedFile)));
  assert.ok(!fs.existsSync(path.join(dataDir, "derived", a.clipId)));
  assert.ok(!fs.existsSync(path.join(dataDir, "labels", `${a.clipId}-K01.json`)));
  // Other contributor untouched.
  assert.ok(fs.existsSync(path.join(dataDir, "clips", b.storedFile)));
  assert.ok(fs.existsSync(path.join(dataDir, "derived", b.clipId)));

  const status = statusSummary(dataDir, TODAY);
  assert.equal(status.clips, 1);
  assert.equal(status.contributors.find((c) => c.contributorId === "C001").status, "withdrawn");
  await assert.rejects(importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, TODAY), /withdrawn/);
});

test("retention: past-date contributors are refused, listed, and purged only with apply", async () => {
  const { dataDir, srcDir } = setup();
  consent(dataDir, { retentionUntil: "2026-12-01" });
  const entry = await importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, TODAY);
  const later = "2026-12-02";
  await assert.rejects(importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, later), /retention date/);
  assert.deepEqual((await verifyDataDir(dataDir, later)).filter((p) => p.includes("retention")).length, 1);

  const dry = enforceRetention(dataDir, {}, later);
  assert.deepEqual(dry.due, ["C001"]);
  assert.ok(fs.existsSync(path.join(dataDir, "clips", entry.storedFile)));

  enforceRetention(dataDir, { apply: true }, later);
  assert.ok(!fs.existsSync(path.join(dataDir, "clips", entry.storedFile)));
  assert.equal(statusSummary(dataDir, later).contributors[0].status, "expired");
});

test("import refuses without an affirmative consent record, even if the file was edited by hand", async () => {
  const { dataDir, srcDir } = setup();
  assert.throws(() => consent(dataDir, { affirmativeConsent: false }), /affirmativeConsent/);
  assert.throws(() => consent(dataDir, { adult: false }), /adult/);
  await assert.rejects(importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, TODAY), /no consent record/);
  consent(dataDir);
  const file = path.join(dataDir, "consent", "C001.json");
  const rec = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...rec, affirmativeConsent: false }));
  await assert.rejects(importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, TODAY), /affirmativeConsent/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "manifest.json"), "utf8")).clips.length, 0);
});

test("import requires a self-reported skill level from the fixed list", async () => {
  const { dataDir, srcDir } = setup();
  consent(dataDir);
  await assert.rejects(importClip(dataDir, importOpts(fakeVideo(srcDir), { skill: undefined }), NO_FFMPEG, TODAY), /--skill/);
  await assert.rejects(importClip(dataDir, importOpts(fakeVideo(srcDir), { skill: "scratch" }), NO_FFMPEG, TODAY), /--skill/);
});

test("third-party gate: refused while vendor terms are unverified, and per-contributor opt-in is required", async () => {
  const { dataDir, srcDir } = setup();
  consent(dataDir, { contributor: "C001", thirdPartyRoboflow: true, thirdPartyGemini: false });
  consent(dataDir, { contributor: "C002" });
  const a = await importClip(dataDir, importOpts(fakeVideo(srcDir), { strippedManually: true }), NO_FFMPEG, TODAY);
  const b = await importClip(dataDir, importOpts(fakeVideo(srcDir), { contributor: "C002", strippedManually: true }), NO_FFMPEG, TODAY);
  const c = await importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, TODAY); // C001, not stripped

  // Shipped state: no vendor is verified, so nothing may be sent at all.
  assert.equal(VENDOR_TERMS_VERIFIED.roboflow, null);
  assert.equal(VENDOR_TERMS_VERIFIED.gemini, null);
  assert.ok(Object.isFrozen(VENDOR_TERMS_VERIFIED));
  assert.throws(() => assertThirdPartyAllowed(dataDir, a.clipId, "roboflow", { today: TODAY }), /not verified/);
  const shipped = thirdPartyEligible(dataDir, "roboflow", { today: TODAY });
  assert.equal(shipped.vendorVerified, false);
  assert.deepEqual(shipped.eligible, []);

  // Hypothetical: once a vendor is verified, the per-contributor flag decides.
  // Checklist done but no written no-training commitment: still refused.
  const noWritten = { roboflow: { verifiedOn: "2026-10-21" }, gemini: { verifiedOn: "2026-10-21" } };
  assert.throws(() => assertThirdPartyAllowed(dataDir, a.clipId, "roboflow", { vendorStatus: noWritten, today: TODAY }), /no-training/);
  assert.equal(thirdPartyEligible(dataDir, "roboflow", { vendorStatus: noWritten, today: TODAY }).vendorVerified, false);
  const approved = { verifiedOn: "2026-10-21", noTrainingConfirmedOn: "2026-10-21" };
  const verified = { roboflow: approved, gemini: approved };
  const opts = { vendorStatus: verified, today: TODAY };
  assert.deepEqual(assertThirdPartyAllowed(dataDir, a.clipId, "roboflow", opts), { clipId: a.clipId, contributorId: "C001", processor: "roboflow" });
  assert.throws(() => assertThirdPartyAllowed(dataDir, a.clipId, "gemini", opts), /did not opt in to gemini/);
  assert.throws(() => assertThirdPartyAllowed(dataDir, b.clipId, "roboflow", opts), /C002 did not opt in to roboflow/);
  assert.throws(() => assertThirdPartyAllowed(dataDir, c.clipId, "roboflow", opts), /strip/);
  assert.throws(() => assertThirdPartyAllowed(dataDir, a.clipId, "openai", opts), /unknown processor/);
  assert.throws(() => assertThirdPartyAllowed(dataDir, "C009-0001", "roboflow", opts), /not in the manifest/);
  assert.deepEqual(thirdPartyEligible(dataDir, "roboflow", opts).eligible, [a.clipId]);

  // Withdrawal removes eligibility immediately.
  withdrawContributor(dataDir, "C001", { confirm: true }, TODAY);
  assert.throws(() => assertThirdPartyAllowed(dataDir, a.clipId, "roboflow", opts), /not in the manifest/);
});

test("coach gate: in-person needs coach viewing; remote also needs remote coach viewing; unstripped never shared", async () => {
  const { dataDir, srcDir } = setup();
  consent(dataDir, { contributor: "C001", coachViewing: true, remoteCoachViewing: true });
  consent(dataDir, { contributor: "C002", coachViewing: true, remoteCoachViewing: false });
  consent(dataDir, { contributor: "C003", coachViewing: false });
  const a = await importClip(dataDir, importOpts(fakeVideo(srcDir), { strippedManually: true }), NO_FFMPEG, TODAY);
  const b = await importClip(dataDir, importOpts(fakeVideo(srcDir), { contributor: "C002", strippedManually: true }), NO_FFMPEG, TODAY);
  await importClip(dataDir, importOpts(fakeVideo(srcDir), { contributor: "C003", strippedManually: true }), NO_FFMPEG, TODAY);
  await importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, TODAY); // C001, not stripped
  assert.deepEqual(coachEligible(dataDir, {}, TODAY).eligible, [a.clipId, b.clipId]);
  assert.deepEqual(coachEligible(dataDir, { remote: true }, TODAY).eligible, [a.clipId]);
});

test("status reports coverage, including the left-handed share", async () => {
  const { dataDir, srcDir } = setup();
  consent(dataDir);
  await importClip(dataDir, importOpts(fakeVideo(srcDir), { handedness: "left", skill: "beginner" }), NO_FFMPEG, TODAY);
  for (let i = 0; i < 4; i++) await importClip(dataDir, importOpts(fakeVideo(srcDir)), NO_FFMPEG, TODAY);
  const s = statusSummary(dataDir, TODAY);
  assert.equal(s.leftHandedShare, 20);
  assert.deepEqual(s.coverage.skill, { beginner: 1, mid: 4 });
  assert.equal(s.contributors[0].thirdPartyGemini, false);
});

test("protocol slot codes", () => {
  assert.equal(
    protocolSlot({ angle: "down_the_line", club: "iron", mount: "handheld", handedness: "left", lighting: "backlit" }),
    "DTL-IR-HND-LH-BKL",
  );
});

// ---------------------------------------------------------------------------
// Coach agreements, session gate, and label files
// ---------------------------------------------------------------------------

function coach(dataDir, overrides = {}) {
  return addCoach(
    dataDir,
    { coach: "K01", agreementVersion: "1.0", agreementDate: "2026-10-20", agreementSigned: true, inPerson: true, remote: false, ...overrides },
    TODAY,
  );
}

const PLATFORM_OK = { platform: "google_meet", reviewedOn: "2026-10-15", by: "Micky" };

async function coachFixture() {
  const fx = setup();
  consent(fx.dataDir, { contributor: "C001", coachViewing: true, remoteCoachViewing: true });
  consent(fx.dataDir, { contributor: "C002", coachViewing: true, remoteCoachViewing: false });
  fx.a = await importClip(fx.dataDir, importOpts(fakeVideo(fx.srcDir), { strippedManually: true }), NO_FFMPEG, TODAY);
  fx.b = await importClip(fx.dataDir, importOpts(fakeVideo(fx.srcDir), { contributor: "C002", strippedManually: true }), NO_FFMPEG, TODAY);
  return fx;
}

test("coach records: signed agreement required, current version, pseudonymous only, IDs never reused", () => {
  const { dataDir } = setup();
  assert.equal(CURRENT_COACH_AGREEMENT_VERSION, "1.0");
  assert.throws(() => coach(dataDir, { agreementSigned: false }), /agreementSigned/);
  assert.throws(() => coach(dataDir, { agreementVersion: "0.9" }), /not the current agreement/);
  assert.throws(() => coach(dataDir, { coach: "Coach Bob" }), /K01/);
  assert.throws(() => coach(dataDir, { agreementDate: "2026-12-01" }), /future/);
  assert.throws(() => coach(dataDir, { inPerson: false, remote: false }), /at least one/);
  const rec = coach(dataDir);
  assert.deepEqual(validateCoachRecord(rec), []);
  assert.ok(validateCoachRecord({ ...rec, name: "Bob" }).some((p) => p.includes('"name"')));
  assert.ok(validateCoachRecord({ ...rec, email: "b@c.d" }).length > 0);
  assert.throws(() => coach(dataDir), /never reused/);
});

test("coach-session-check: refused without a coach record, with a revoked coach, or for an uncleared session type", async () => {
  const { dataDir } = await coachFixture();
  assert.throws(() => assertCoachSessionAllowed(dataDir, "K01", { today: TODAY }), /no coach record/);
  coach(dataDir);
  const ok = assertCoachSessionAllowed(dataDir, "K01", { today: TODAY });
  assert.equal(ok.remote, false);
  assert.equal(ok.eligible.length, 2);
  assert.throws(() => assertCoachSessionAllowed(dataDir, "K01", { remote: true, platformReview: PLATFORM_OK, today: TODAY }), /not cleared for remote/);
  revokeCoach(dataDir, "K01", TODAY);
  assert.throws(() => assertCoachSessionAllowed(dataDir, "K01", { today: TODAY }), /revoked/);
});

test("coach-session-check remote: needs a reviewed, in-date platform and remote consent; shipped state refuses", async () => {
  const { dataDir, a } = await coachFixture();
  coach(dataDir, { coach: "K02", inPerson: false, remote: true });
  // Shipped state: no platform reviewed, so no remote session at all.
  assert.equal(SCREEN_SHARE_PLATFORM_REVIEW, null);
  assert.throws(() => assertCoachSessionAllowed(dataDir, "K02", { remote: true, today: TODAY }), /not reviewed/);
  assert.throws(() => assertCoachSessionAllowed(dataDir, "K02", { remote: true, platformReview: { platform: "skype", reviewedOn: "2026-10-15" }, today: TODAY }), /not reviewed/);
  assert.throws(() => assertCoachSessionAllowed(dataDir, "K02", { remote: true, platformReview: { platform: "google_meet", reviewedOn: "2026-09-01" }, today: TODAY }), /older than 30 days/);
  const ok = assertCoachSessionAllowed(dataDir, "K02", { remote: true, platformReview: PLATFORM_OK, today: TODAY });
  // Only C001 ticked remote coach viewing.
  assert.deepEqual(ok.eligible, [a.clipId]);
  assert.equal(ok.platform, "google_meet");
  assert.throws(() => assertCoachSessionAllowed(dataDir, "K02", { remote: true, platformReview: { ...PLATFORM_OK, platform: "zoom" }, today: TODAY }), /not reviewed/, "Zoom was not chosen");
  assert.throws(() => assertCoachSessionAllowed(dataDir, "K02", { remote: false, today: TODAY }), /not cleared for in-person/);
  withdrawContributor(dataDir, "C001", { confirm: true }, TODAY);
  assert.throws(() => assertCoachSessionAllowed(dataDir, "K02", { remote: true, platformReview: PLATFORM_OK, today: TODAY }), /no clip is eligible/);
});

test("labels: stored by clip ID and coach ID only, apart from identity; verify flags extra fields, unknown coaches, bad names", async () => {
  const { dataDir, a } = await coachFixture();
  coach(dataDir);
  const good = { clip_id: a.clipId, coach_id: "K01", camera_angle: "face_on", analyzable: "yes", t_impact: 1.234, fault_sway: "no", main_improvement: "none" };
  assert.deepEqual(validateLabelRecord(good, { clipId: a.clipId, coachId: "K01" }), []);
  const labels = path.join(dataDir, "labels");
  fs.writeFileSync(path.join(labels, `${a.clipId}-K01.json`), JSON.stringify(good));
  assert.deepEqual(await verifyDataDir(dataDir, TODAY), []);

  // Identity never belongs in a label file.
  fs.writeFileSync(path.join(labels, `${a.clipId}-K01.json`), JSON.stringify({ ...good, participant_name: "Jane", coach_email: "x@y.z" }));
  const p1 = await verifyDataDir(dataDir, TODAY);
  assert.ok(p1.some((p) => p.includes('"participant_name"')));
  assert.ok(p1.some((p) => p.includes('"coach_email"')));
  fs.writeFileSync(path.join(labels, `${a.clipId}-K01.json`), JSON.stringify({ ...good, coach_id: "K02" }));
  assert.ok((await verifyDataDir(dataDir, TODAY)).some((p) => p.includes("coach_id does not match")));
  fs.writeFileSync(path.join(labels, `${a.clipId}-K01.json`), JSON.stringify(good));

  fs.writeFileSync(path.join(labels, `${a.clipId}-K09.json`), JSON.stringify({ ...good, coach_id: "K09" }));
  assert.ok((await verifyDataDir(dataDir, TODAY)).some((p) => p.includes("no coach record for K09")));
  fs.rmSync(path.join(labels, `${a.clipId}-K09.json`));
  fs.writeFileSync(path.join(labels, "Jane-labels.csv"), "x");
  assert.ok((await verifyDataDir(dataDir, TODAY)).some((p) => p.includes("<clip ID>-<coach ID>.json")));
  fs.rmSync(path.join(labels, "Jane-labels.csv"));

  // Coach records carry no participant data; labels go with the clip on withdrawal, the coach record stays.
  const coachFile = fs.readFileSync(path.join(dataDir, "coaches", "K01.json"), "utf8");
  assert.ok(!coachFile.includes("C001"));
  withdrawContributor(dataDir, "C001", { confirm: true }, TODAY);
  assert.ok(!fs.existsSync(path.join(labels, `${a.clipId}-K01.json`)));
  assert.ok(fs.existsSync(path.join(dataDir, "coaches", "K01.json")));
  assert.deepEqual(await verifyDataDir(dataDir, TODAY), []);
});
