import { test } from "node:test";
import assert from "node:assert/strict";
import { hostedFirst } from "../src/lib/hostedFirst.ts";

const r = (id: string, hostId: string, dateISO: string) => ({ id, hostId, dateISO });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test("my hosted rounds come first, soonest first; the rest keep their order", () => {
  const list = [r("a", "x", "2026-11-09T12:00:00Z"), r("b", "me", "2026-11-14T12:00:00Z"), r("c", "y", "2026-11-08T12:00:00Z"), r("d", "me", "2026-11-09T12:00:00Z")];
  assert.deepEqual(ids(hostedFirst(list, "me", (x) => x)), ["d", "b", "a", "c"]);
  assert.deepEqual(ids(list), ["a", "b", "c", "d"], "input untouched");
});

test("nothing hosted: unchanged; bad dates sort last among hosted", () => {
  const list = [r("a", "x", "2026-11-09"), r("b", "y", "2026-11-08")];
  assert.deepEqual(ids(hostedFirst(list, "me", (x) => x)), ["a", "b"]);
  const mine = [r("a", "me", "nope"), r("b", "me", "2026-11-08")];
  assert.deepEqual(ids(hostedFirst(mine, "me", (x) => x)), ["b", "a"]);
});
