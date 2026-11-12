import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { markRoundCompleted } from "../src/lib/completeRound.ts";

function fixture(body: unknown, status = 200) {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const client = createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      requests.push({ url: new URL(String(url)), init: init ?? {} });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    } },
  });
  return { client, requests };
}

test("completion acknowledges only a matching returned completed row", async () => {
  const { client, requests } = fixture([{ id: "round-1", status: "completed" }]);
  assert.equal(await markRoundCompleted(client, "round-1", "host-1"), true);
  assert.equal(requests.length, 1);
  const { url, init } = requests[0]!;
  assert.equal(init.method, "PATCH");
  assert.equal(url.pathname, "/rest/v1/golf_calls");
  assert.equal(url.searchParams.get("id"), "eq.round-1");
  assert.equal(url.searchParams.get("host_user_id"), "eq.host-1");
  assert.equal(url.searchParams.get("status"), "in.(open,full)");
  assert.equal(url.searchParams.get("select"), "id,status");
  assert.match(new Headers(init.headers).get("Prefer") ?? "", /return=representation/);
  assert.deepEqual(JSON.parse(String(init.body)), { status: "completed" });
});

test("zero matched rows (duplicate, cancelled, deleted or RLS-hidden) never acknowledges success", async () => {
  const { client } = fixture([]);
  assert.equal(await markRoundCompleted(client, "round-1", "host-1"), false);
});

test("unexpected returned row or status never acknowledges success", async () => {
  for (const body of [[{ id: "other", status: "completed" }], [{ id: "round-1", status: "open" }], null]) {
    const { client } = fixture(body);
    assert.equal(await markRoundCompleted(client, "round-1", "host-1"), false);
  }
});

test("server rejection remains a failure", async () => {
  const { client } = fixture({ code: "42501", message: "Synthetic permission denied" }, 403);
  await assert.rejects(markRoundCompleted(client, "round-1", "host-1"), /Synthetic permission denied/);
});

test("completion waits for the server response", async () => {
  let reply!: (response: Response) => void;
  const client = createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: () => new Promise<Response>((resolve) => { reply = resolve; }) },
  });
  let settled = false;
  const result = markRoundCompleted(client, "round-1", "host-1").then(v => { settled = true; return v; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(settled, false);
  reply(new Response(JSON.stringify([{ id: "round-1", status: "completed" }]), { headers: { "Content-Type": "application/json" } }));
  assert.equal(await result, true);
});
