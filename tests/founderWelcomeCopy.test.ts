import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const before = read("20261104140000_update_founder_welcome_copy_host_caddie.sql");
const after = read("20261119052955_founder_welcome_golf_not_dating.sql");
const added = "GolfMe is for finding people to golf with. It is not a dating app. Keep Community posts appropriate and respectful. We’d love to see more golf content, like round invites, swing clips, and course photos.";
test("founder welcome adds explicit purpose and encouraging Community guidance after greeting", () => {
  assert.equal(after.split(added).length - 1, 1);
  assert.ok(after.includes(`Glad you’re here. ${added} Best way to start:`));
});
test("only message copy changes; trigger guards, English-only strategy and privileges unchanged", () => {
  const definition = (sql: string) => sql.slice(sql.indexOf("create or replace function"));
  assert.equal(definition(after).replace(added + " ", "").replace("GolfMe’s founder. Glad", "GolfMe’s founder 👋 Glad").replace("Message me here anytime.'", "Message me here anytime. ⛳'"), definition(before));
  assert.ok(after.includes("kept English-only"));
  assert.ok(after.includes("revoke execute on function public.notify_founder_welcome() from public, anon, authenticated"));
});
test("candidate defines future trigger behavior only, with no backfill or direct invocation", () => {
  const outsideBody = after.replace(/as \$function\$[\s\S]*?\$function\$;/, "");
  assert.doesNotMatch(outsideBody, /(?:insert into|update public|delete from|select public\.notify_founder_welcome)/i);
});

test("approved welcome contains no emoji", () => { assert.doesNotMatch(after, /[\p{Extended_Pictographic}]/u); });
