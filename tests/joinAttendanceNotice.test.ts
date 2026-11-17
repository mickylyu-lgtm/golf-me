import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("attendance reminder is present in shared confirmation without adding a gate", () => {
  const source = read("../src/components/golfcall/ConfirmJoinModal.tsx");
  assert.match(source, /t\("joinConfirm.attendanceTitle"\)/);
  assert.match(source, /t\("joinConfirm.attendanceReminder"\)/);
  assert.match(source, /onClick=\{onConfirm\}/);
  assert.match(source, /onClose=\{onClose\}/);
  assert.doesNotMatch(source, /checkbox|disabled=|required=/);
  assert.match(source, /t\("booking.joinDisclaimer"\)/);
});

test("both card and detail entry points retain the same confirmation sheet", () => {
  for (const path of ["../src/components/golfcall/GolfCallCard.tsx", "../src/pages/GolfCallDetail.tsx"]) {
    assert.match(read(path), /<ConfirmJoinModal/);
  }
});

test("attendance copy is available in every supported locale", () => {
  for (const locale of ["en", "es", "ja", "ko", "zh-CN", "zh-TW"]) {
    const source = read(`../src/i18n/locales/${locale}.ts`);
    for (const key of ["attendanceTitle", "attendanceReminder"]) {
      assert.match(source, new RegExp(`"joinConfirm\\.${key}": "[^"]+"`));
    }
  }
});
