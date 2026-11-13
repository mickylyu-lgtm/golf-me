// Run: npm run test  (node --test, built-in type stripping)
// 20261113120000 re-creates six live push functions to pass sender_id. This
// proves each copy is the current source definition verbatim except for its
// push call, so the migration cannot silently change recipients, block rules,
// copy, links or cooldowns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const DIR = new URL("../supabase/migrations/", import.meta.url);
const NEW = "20261113120000_push_sender_for_communication_notifications.sql";
const read = (f: string) => readFileSync(new URL(f, DIR), "utf8");
const newSql = read(NEW);

// Text from "function <name>(" through the end of its dollar-quoted body.
function definition(sql: string, name: string): string | null {
  const re = new RegExp(`create (?:or replace )?function ${name.replace(".", "\\.")}\\(`, "g");
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(sql); m; m = re.exec(sql)) last = m;
  if (!last) return null;
  const start = last.index + last[0].indexOf("function");
  const open = /\bas (\$[a-z_]*\$)/.exec(sql.slice(start));
  if (!open) return null;
  const bodyStart = start + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(start, close + open[1].length);
}

// The newest migration before NEW that defines `name`.
function latestSource(name: string): { file: string; def: string } {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < NEW).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const def = definition(read(files[i]), name);
    if (def) return { file: files[i], def };
  }
  throw new Error(`no earlier definition of ${name}`);
}

const CASES: { name: string; from: string; edits: [string, string][] }[] = [
  {
    name: "public.notify_new_message",
    from: "20261107220000_chat_video_albums.sql",
    edits: [["'link_to', '/messages/' || new.sender_id\n", "'link_to', '/messages/' || new.sender_id,\n          'sender_id', new.sender_id\n"]],
  },
  {
    name: "public.notify_round_joined",
    from: "20261105130000_add_round_update_pushes.sql",
    edits: [["private.send_round_push(v_push_secret, v_host, v_title, v_text, v_link, null)", "private.send_person_push(v_push_secret, v_host, v_title, v_text, v_link, null, new.user_id)"]],
  },
  {
    name: "public.notify_community_comment",
    from: "20261107200000_post_like_and_comment_pushes.sql",
    edits: [["private.send_round_push(v_push_secret, v_recipient, v_name, v_line, v_link, null)", "private.send_person_push(v_push_secret, v_recipient, v_name, v_line, v_link, null, new.author_id)"]],
  },
  {
    name: "public.notify_post_liked",
    from: "20261107200000_post_like_and_comment_pushes.sql",
    edits: [
      ["private.send_round_push(", "private.send_person_push("],
      ["v_link, 'post-like-' || new.post_id\n", "v_link, 'post-like-' || new.post_id, new.voter_id\n"],
    ],
  },
  {
    name: "public.notify_new_follower",
    from: "20261108150000_follow_notifications.sql",
    edits: [
      ["private.send_round_push(", "private.send_person_push("],
      ["      v_link, null\n", "      v_link, null, new.follower_id\n"],
    ],
  },
  {
    name: "private.social_request_notification",
    from: "20261111082608_private_social_controls.sql",
    edits: [["private.send_round_push(v_secret,p_recipient,v_name,v_text,v_link,null)", "private.send_person_push(v_secret,p_recipient,v_name,v_text,v_link,null,p_actor)"]],
  },
];

for (const c of CASES) {
  test(`${c.name} is the live definition plus sender_id only`, () => {
    const src = latestSource(c.name);
    assert.equal(src.file, c.from, "a newer migration redefines this function; re-copy it");
    const mine = definition(newSql, c.name);
    assert.ok(mine, "missing from the new migration");
    let expected = src.def;
    for (const [from, to] of c.edits) {
      assert.equal(expected.split(from).length, 2, `edit anchor must appear exactly once: ${from}`);
      expected = expected.replace(from, to);
    }
    assert.equal(mine, expected);
    assert.ok(!mine.includes("send_round_push"));
  });
}

test("send_person_push is send_round_push plus sender_id, locked down", () => {
  const round = definition(read("20261105130000_add_round_update_pushes.sql"), "private.send_round_push")!;
  const person = definition(newSql, "private.send_person_push")!;
  const expected = round
    .replace("private.send_round_push(p_secret text, p_user_id uuid, p_title text, p_body text, p_link_to text, p_collapse_id text)", "private.send_person_push(p_secret text, p_user_id uuid, p_title text, p_body text, p_link_to text, p_collapse_id text, p_sender_id uuid)")
    .replace("'collapse_id', p_collapse_id\n", "'collapse_id', p_collapse_id,\n        'sender_id', p_sender_id\n")
    .replace("failed for a round update", "failed for a person push");
  assert.equal(person, expected);
  assert.match(newSql, /revoke execute on function private\.send_person_push\(text, uuid, text, text, text, text, uuid\) from public, anon, authenticated;/);
});

test("system pushes are untouched", () => {
  for (const name of ["public.notify_tee_time_updated", "public.notify_round_cancelled", "public.notify_caddie_analysis_complete", "private.send_round_push"]) {
    assert.equal(definition(newSql, name), null, name);
  }
});
