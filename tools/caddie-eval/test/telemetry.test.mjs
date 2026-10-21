// node --test tools/caddie-eval/test/*.test.mjs
// Blocked-request summaries (MediaPipe usage logger audit) and OS network
// isolation evidence. Synthetic bytes only; no browser, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeMessage, summarizeBlockedRequest } from "../lib/protowire.mjs";
import { EXPECTED_BLOCKED_HOSTS, osNetworkIsolation } from "../pose-local.mjs";

// Tiny protobuf encoder for synthetic test bodies.
const varint = (n) => {
  const out = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
};
const vField = (f, n) => [...varint((f << 3) | 0), ...varint(n)];
const lField = (f, bytes) => [...varint((f << 3) | 2), ...varint(bytes.length), ...bytes];
const str = (s) => [...Buffer.from(s, "utf8")];

test("protobuf decoder: nested messages, varints, strings, empty strings; rejects garbage", () => {
  const clientInfo = [...vField(1, 3), ...lField(2, []), ...lField(4, str("1.1.0")), ...vField(6, 4)];
  const event = [...vField(1, 23), ...vField(2, 0), ...lField(3, [...vField(1, 12), ...vField(3, 198)])];
  const body = Uint8Array.from([...vField(2, 1786), ...lField(3, lField(6, [...lField(1, clientInfo), ...lField(2, event)]))]);
  const d = decodeMessage(body);
  assert.deepEqual(d[0], { field: 2, wire: "varint", value: 1786 });
  const inner = d[1].fields[0].fields;
  assert.equal(inner[0].fields[0].value, 3);
  assert.deepEqual(inner[0].fields[1], { field: 2, wire: "string", value: "" });
  assert.deepEqual(inner[0].fields[2], { field: 4, wire: "string", value: "1.1.0" });
  assert.equal(inner[1].fields[0].value, 23);
  assert.equal(inner[1].fields[2].fields[1].value, 198);
  assert.equal(decodeMessage(Uint8Array.from([0xff, 0xff, 0xff])), null);
  assert.equal(decodeMessage(Uint8Array.from([0x0a, 0x05, 0x01])), null, "length past the end");
  const long = decodeMessage(Uint8Array.from(lField(1, str("x".repeat(100)))));
  assert.match(long[0].value, /\(100 chars\)$/);
});

test("blocked-request summary: header NAMES only, API key value never recorded, query values dropped", () => {
  const secret = "SYNTHETIC-KEY-VALUE-123";
  const s = summarizeBlockedRequest({
    url: "https://odml.pa.googleapis.com/v1/log?key=abc&x=1",
    method: "POST",
    headers: { "content-type": "application/x-protobuf", "x-goog-api-key": secret, "user-agent": "UA" },
    body: Buffer.from(vField(2, 1786)),
  });
  const json = JSON.stringify(s);
  assert.ok(!json.includes(secret));
  assert.ok(!json.includes("abc"));
  assert.ok(!json.includes('"UA"'));
  assert.equal(s.host, "odml.pa.googleapis.com");
  assert.equal(s.path, "/v1/log");
  assert.deepEqual(s.queryKeys, ["key", "x"]);
  assert.equal(s.apiKeyHeaderPresent, true);
  assert.deepEqual(s.headerNames, ["content-type", "user-agent", "x-goog-api-key"]);
  assert.equal(s.bodyBytes, 3);
  assert.deepEqual(s.bodyProtobuf, [{ field: 2, wire: "varint", value: 1786 }]);
  const plain = summarizeBlockedRequest({ url: "not a url", method: "GET" });
  assert.equal(plain.host, "unparseable");
  assert.equal(plain.bodyProtobuf, null);
});

test("OS isolation evidence: counts non-loopback interfaces, records no names or addresses", () => {
  const isolated = osNetworkIsolation({ GOLFME_EVAL_IN_NETNS: "1" }, {});
  assert.deepEqual(isolated, { netns: true, nonLoopbackInterfaces: 0, isolated: true });
  const loOnly = osNetworkIsolation({}, { lo: [{ address: "127.0.0.1", internal: true }] });
  assert.equal(loOnly.isolated, true);
  const online = osNetworkIsolation({}, { lo: [{ internal: true }], eth0: [{ address: "10.0.0.2", internal: false }] });
  assert.deepEqual(online, { netns: false, nonLoopbackInterfaces: 1, isolated: false });
  assert.ok(!JSON.stringify(online).includes("10.0.0.2"));
  assert.deepEqual(EXPECTED_BLOCKED_HOSTS, ["odml.pa.googleapis.com"]);
});
