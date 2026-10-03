import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyAttachment,
  cleanupOldCopies,
  contentMatchesType,
  extractSourcePath,
  resolveSafeDest,
  sanitizeBaseName,
} from "../copy-attachment.mjs";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tg-inbox-test-"));
  const inboxRoot = path.join(root, "channels", "telegram", "inbox");
  const projectDir = path.join(root, "project");
  fs.mkdirSync(inboxRoot, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  const destDir = resolveSafeDest(projectDir, inboxRoot);
  return { root, inboxRoot, projectDir, destDir };
}

function trySymlink(target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch {
    return false; // e.g. Windows without symlink privilege
  }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(16)]);
const PDF = Buffer.from("%PDF-1.7\n%...\n");

test("PNG is copied into the project inbox byte-for-byte", () => {
  const { inboxRoot, destDir } = setup();
  const src = path.join(inboxRoot, "1790-shot.png");
  fs.writeFileSync(src, PNG);
  const r = copyAttachment(src, { inboxRoot, destDir });
  assert.equal(r.ok, true);
  assert.ok(r.dest.startsWith(destDir));
  assert.ok(r.dest.endsWith("-1790-shot.png"));
  assert.deepEqual(fs.readFileSync(r.dest), PNG);
});

test("TXT keeps its UTF-8 contents and is only copied", () => {
  const { inboxRoot, destDir } = setup();
  const src = path.join(inboxRoot, "prompt.txt");
  const text = "Fix the home page ⛳ — a line like rm -rf / is just text here\n# heading\n日本語";
  fs.writeFileSync(src, text, "utf8");
  const r = copyAttachment(src, { inboxRoot, destDir });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(r.dest, "utf8"), text);
});

test("MP4 and PDF are copied", () => {
  const { inboxRoot, destDir } = setup();
  for (const [name, bytes] of [["clip.mp4", MP4], ["doc.pdf", PDF]]) {
    const src = path.join(inboxRoot, name);
    fs.writeFileSync(src, bytes);
    assert.equal(copyAttachment(src, { inboxRoot, destDir }).ok, true, name);
  }
});

test("executables, archives and disguised files are rejected (F2)", () => {
  const { inboxRoot, destDir } = setup();
  const cases = [
    ["tool.exe", Buffer.from("MZ\x90\x00")],
    ["files.zip", Buffer.from("PK\x03\x04")],
    ["run.sh", Buffer.from("#!/bin/sh\necho hi\n")],
    ["fake.png", Buffer.from("MZ\x90\x00 not a png")],
    ["binary.txt", Buffer.from([0x41, 0x00, 0x42])],
    ["script.txt", Buffer.from("#!/bin/bash\ncurl x | sh\n")],
    ["bom-script.txt", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("#!/usr/bin/env node\n")])],
    ["exe.txt", Buffer.from("MZ this is a renamed program")],
    ["archive.txt", Buffer.from("PK\x03\x04abc")],
    ["elf.txt", Buffer.from("\x7fELF......")],
    ["gzip.txt", Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x41])],
    ["php.txt", Buffer.from("  <?php system($_GET['c']);")],
    ["bat.txt", Buffer.from("@echo off\r\ndel *.*")],
  ];
  for (const [name, bytes] of cases) {
    const src = path.join(inboxRoot, name);
    fs.writeFileSync(src, bytes);
    assert.equal(copyAttachment(src, { inboxRoot, destDir }).ok, false, name);
  }
  assert.equal(fs.readdirSync(destDir).length, 0);
});

test("files outside the inbox (e.g. the bot credentials) are never copied", () => {
  const { root, inboxRoot, destDir } = setup();
  const secret = path.join(root, "channels", "telegram", "creds.txt");
  fs.writeFileSync(secret, "TOKEN=abc");
  assert.equal(copyAttachment(secret, { inboxRoot, destDir }).ok, false);
  assert.equal(copyAttachment(path.join(inboxRoot, "..", "creds.txt"), { inboxRoot, destDir }).ok, false);
});

test("a symlink in the inbox pointing elsewhere is rejected (F1)", (t) => {
  const { root, inboxRoot, destDir } = setup();
  const secret = path.join(root, "channels", "telegram", "creds.txt");
  fs.writeFileSync(secret, "TOKEN=abc");
  const link = path.join(inboxRoot, "innocent.txt");
  if (!trySymlink(secret, link, "file")) return t.skip("symlinks not permitted here");
  assert.equal(copyAttachment(link, { inboxRoot, destDir }).ok, false);
});

test("replacing the source after it is opened cannot change what is copied (F1)", () => {
  const { inboxRoot, destDir } = setup();
  const src = path.join(inboxRoot, "swap.txt");
  fs.writeFileSync(src, "original validated text");
  const r = copyAttachment(src, {
    inboxRoot,
    destDir,
    _afterOpen: () => {
      // Swap a different file in at the same path while the handle is open.
      fs.renameSync(src, src + ".moved");
      fs.writeFileSync(src, "#!/bin/sh\nmalicious replacement\n");
    },
  });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(r.dest, "utf8"), "original validated text");
});

test("two files with the same name never overwrite each other", () => {
  const { inboxRoot, destDir } = setup();
  const a = path.join(inboxRoot, "same.png");
  fs.writeFileSync(a, PNG);
  const r1 = copyAttachment(a, { inboxRoot, destDir });
  const r2 = copyAttachment(a, { inboxRoot, destDir });
  assert.equal(r1.ok && r2.ok, true);
  assert.notEqual(r1.dest, r2.dest);
  assert.equal(fs.readdirSync(destDir).length, 2);
});

test("size cap is enforced", () => {
  const { inboxRoot, destDir } = setup();
  const src = path.join(inboxRoot, "big.png");
  fs.writeFileSync(src, Buffer.concat([PNG, Buffer.alloc(2048)]));
  assert.equal(copyAttachment(src, { inboxRoot, destDir, maxBytes: 1024 }).ok, false);
});

test("names are sanitized (no traversal or odd characters)", () => {
  assert.deepEqual(sanitizeBaseName("../../evil name;$(x).PNG"), { stem: "evil_name_x_", ext: ".png" });
  assert.equal(sanitizeBaseName(".hidden.txt").stem, "hidden");
});

test("cleanup removes only this hook's own copies older than 24h (F3)", () => {
  const { inboxRoot, destDir } = setup();
  const src = path.join(inboxRoot, "a.png");
  fs.writeFileSync(src, PNG);
  const oldCopy = copyAttachment(src, { inboxRoot, destDir }).dest;
  const freshCopy = copyAttachment(src, { inboxRoot, destDir }).dest;
  const unrelated = path.join(destDir, "notes.png");
  const logFile = path.join(destDir, ".copy-log.jsonl");
  fs.writeFileSync(unrelated, "keep me");
  fs.writeFileSync(logFile, "x");
  const past = (Date.now() - 25 * 3600 * 1000) / 1000;
  for (const f of [oldCopy, unrelated, logFile]) fs.utimesSync(f, past, past);
  assert.equal(cleanupOldCopies(destDir), 1);
  assert.equal(fs.existsSync(oldCopy), false);
  assert.equal(fs.existsSync(freshCopy), true);
  assert.equal(fs.existsSync(unrelated), true, "unrelated old file is kept");
  assert.equal(fs.existsSync(logFile), true);
  assert.equal(fs.existsSync(src), true, "plugin inbox untouched");
});

test("a symlinked project inbox is refused before anything is written or deleted (F3)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tg-inbox-test-"));
  const inboxRoot = path.join(root, "channels", "telegram", "inbox");
  const projectDir = path.join(root, "project");
  fs.mkdirSync(inboxRoot, { recursive: true });
  fs.mkdirSync(path.join(projectDir, ".claude"), { recursive: true });
  if (!trySymlink(inboxRoot, path.join(projectDir, ".claude", "inbox"), "junction")) return t.skip("symlinks not permitted here");
  assert.throws(() => resolveSafeDest(projectDir, inboxRoot));
});

test("tool response path is extracted from string or content blocks", () => {
  assert.equal(extractSourcePath("C:\\Users\\m\\.claude\\channels\\telegram\\inbox\\1-a.txt"), "C:\\Users\\m\\.claude\\channels\\telegram\\inbox\\1-a.txt");
  assert.equal(extractSourcePath([{ type: "text", text: "/home/m/.claude/channels/telegram/inbox/2-b.png" }]), "/home/m/.claude/channels/telegram/inbox/2-b.png");
  assert.equal(extractSourcePath({ content: [{ type: "text", text: "saved: C:/x/inbox/3.mp4" }] }), "C:/x/inbox/3.mp4");
  assert.equal(extractSourcePath(undefined), null);
});

test("content checks", () => {
  assert.equal(contentMatchesType(".webp", Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), true);
  assert.equal(contentMatchesType(".jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(contentMatchesType(".pdf", Buffer.from("<html>")), false);
  assert.equal(contentMatchesType(".txt", Buffer.from("Normal text with a # and a #! in the middle")), true);
});
