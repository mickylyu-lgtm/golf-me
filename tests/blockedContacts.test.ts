// Run: npm run test:trust  (node --test, built-in type stripping)
// Settings unblock list (src/lib/blockedContacts.ts, migration
// 20261106130000). Database rules (who can read/modify blocks, which names
// my_blocked_profiles returns) are checked by
// scripts/staging/directory-followups-authz.sql. Synthetic ids only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockedContactRows, runUnblock, withPending } from "../src/lib/blockedContacts.ts";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const none = () => undefined;

test("a blocked contact whose profile lookup returns no row is still listed and unblockable", () => {
  const rows = blockedContactRows(["gone"], new Set(), [none, none]);
  assert.deepEqual(rows, [{ id: "gone", golfer: null }]);
});

test("cold reload: no cached profiles at all, every block row is still there", () => {
  const ids = ["a", "b", "c"];
  const rows = blockedContactRows(ids, new Set(), []);
  assert.deepEqual(rows.map((r) => r.id), ids);
  assert.ok(rows.every((r) => r.golfer === null));
});

test("named from the server's blocked-names first, then the cache; never for someone who blocked back", () => {
  const server = new Map([["a", { name: "Alex (server)" }]]);
  const cache = new Map([
    ["a", { name: "Alex (cache)" }],
    ["b", { name: "Bo (cache)" }],
    ["m", { name: "Mutual (cache)" }],
  ]);
  const rows = blockedContactRows(["a", "b", "m", "x", "a"], new Set(["m"]), [(id) => server.get(id), (id) => cache.get(id)]);
  assert.deepEqual(rows, [
    { id: "a", golfer: { name: "Alex (server)" } },
    { id: "b", golfer: { name: "Bo (cache)" } },
    { id: "m", golfer: null },
    { id: "x", golfer: null },
  ]);
});

test("unblock success: the pending flag clears and the row goes once the block row is gone", async () => {
  let pending = new Set<string>();
  const setPending = (u: (p: Set<string>) => Set<string>) => {
    pending = u(pending);
  };
  let blocked = ["a", "b"];
  const seen: boolean[] = [];
  const outcome = await runUnblock(
    "a",
    async (id) => {
      seen.push(pending.has(id));
      blocked = blocked.filter((b) => b !== id); // the persisted row is deleted, then refetched
    },
    setPending,
  );
  assert.equal(outcome, "unblocked");
  assert.deepEqual(seen, [true], "button disabled while the request runs");
  assert.equal(pending.size, 0);
  assert.deepEqual(blockedContactRows(blocked, new Set(), []).map((r) => r.id), ["b"]);
});

test("unblock failure is recoverable: the row stays, the button works again, a retry can succeed", async () => {
  let pending = new Set<string>();
  const setPending = (u: (p: Set<string>) => Set<string>) => {
    pending = u(pending);
  };
  const blocked = ["a"];
  let attempts = 0;
  const flaky = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
  };
  assert.equal(await runUnblock("a", flaky, setPending), "failed");
  assert.equal(pending.has("a"), false);
  assert.deepEqual(blockedContactRows(blocked, new Set(), []).map((r) => r.id), ["a"], "still listed after a failure");
  assert.equal(await runUnblock("a", flaky, setPending), "unblocked");
  assert.deepEqual([...withPending(new Set(["x"]), "x", false)], []);
});

test("Settings renders the block rows themselves, with the fallback label, and never shows an id", () => {
  const src = read("../src/pages/Settings.tsx");
  assert.match(src, /blockedContacts\.map\(\(row\)/);
  assert.match(src, /row\.golfer\?\.name \?\? t\("settings\.blockedContact"\)/);
  assert.match(src, /runUnblock\(id, unblockUser, setUnblocking\)/);
  // The old path that dropped unresolved ids is gone.
  assert.doesNotMatch(src, /blockedIds\.map\(\(id\) => getGolfer\(id\)\)/);
  // The id is only a key / argument, never text.
  assert.doesNotMatch(src, />\s*\{row\.id\}|\{`?\$?\{?row\.id\}?`?\}\s*</, "row.id rendered as text");
  assert.match(src, /key=\{row\.id\}/);
  // Toasts are translated, not hardcoded English.
  assert.doesNotMatch(src, /`Unblocked \$\{/);
  for (const [name, dict] of Object.entries({ en, es, ja, ko, zhCN, zhTW }) as [string, Record<string, string>][]) {
    for (const key of ["settings.blockedContact", "settings.unblocking", "settings.unblockedToast", "settings.unblockFailedToast"]) {
      assert.ok(dict[key]?.trim(), `${name} is missing ${key}`);
    }
    assert.ok(dict["settings.unblockedToast"].includes("{name}"), name);
  }
});

test("the server names only the caller's own blocks, never someone who blocked them", () => {
  const sql = read("../supabase/migrations/20261106130000_add_my_blocked_profiles.sql")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  assert.match(sql, /b\.blocker_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /back\.blocker_id = b\.blocked_id and back\.blocked_id = b\.blocker_id/);
  const cols = sql.slice(sql.indexOf("returns table"), sql.indexOf("language sql"));
  assert.doesNotMatch(cols, /bio|area|playing_area|handicap|gender|username/);
  assert.match(sql, /revoke execute on function public\.my_blocked_profiles\(\) from public, anon;/);
});
