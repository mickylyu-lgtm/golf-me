// Minimal protobuf wire-format decoder for AUDITING blocked requests (the
// MediaPipe usage logger's body, see docs/caddie-v2/MEDIAPIPE_TELEMETRY_AUDIT.md).
// Schema-less: it shows field numbers, wire types, and values. A
// length-delimited field is shown as a nested message when it parses cleanly
// as one, else as a short printable string, else only as its byte length.
// The input is a body that was intercepted and never sent. Pure, no I/O.

const MAX_DEPTH = 8;
const MAX_STRING = 64;

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) return null;
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: result, pos };
    shift += 7n;
  }
  return null;
}

function asNumber(big) {
  return big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big.toString();
}

function printable(bytes) {
  if (bytes.length === 0) return "";
  const s = Buffer.from(bytes).toString("utf8");
  // Reject replacement characters and control characters other than tab/newline.
  if (s.includes("�") || /[\u0000-\u0008\u000B-\u001F\u007F]/.test(s)) return null;
  return s;
}

/** Decodes one message. Returns an array of fields, or null when the bytes are not a well-formed message. */
export function decodeMessage(bytes, depth = 0) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const key = readVarint(buf, pos);
    if (!key) return null;
    pos = key.pos;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (field < 1) return null;
    if (wire === 0) {
      const v = readVarint(buf, pos);
      if (!v) return null;
      pos = v.pos;
      fields.push({ field, wire: "varint", value: asNumber(v.value) });
    } else if (wire === 1 || wire === 5) {
      const n = wire === 1 ? 8 : 4;
      if (pos + n > buf.length) return null;
      const view = new DataView(buf.buffer, buf.byteOffset + pos, n);
      const value = wire === 1 ? view.getFloat64(0, true) : view.getFloat32(0, true);
      pos += n;
      fields.push({ field, wire: wire === 1 ? "fixed64" : "fixed32", value: Number.isFinite(value) ? Math.round(value * 1000) / 1000 : String(value) });
    } else if (wire === 2) {
      const len = readVarint(buf, pos);
      if (!len) return null;
      pos = len.pos;
      const n = Number(len.value);
      if (pos + n > buf.length) return null;
      const sub = buf.subarray(pos, pos + n);
      pos += n;
      const nested = depth < MAX_DEPTH && n > 0 ? decodeMessage(sub, depth + 1) : null;
      const text = printable(sub);
      if (nested && nested.length && (text === null || text.length < 2)) fields.push({ field, wire: "message", fields: nested });
      else if (text !== null) fields.push({ field, wire: "string", value: text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}... (${text.length} chars)` : text });
      else if (nested && nested.length) fields.push({ field, wire: "message", fields: nested });
      else fields.push({ field, wire: "bytes", length: n });
    } else {
      return null; // groups (3, 4) and invalid wire types are not used by this logger
    }
  }
  return fields;
}

/**
 * Summary of one intercepted request for the run file and the audit: no
 * header values (the logger's x-goog-api-key is recorded only as present),
 * no query values, and the body only as decoded field structure.
 */
export function summarizeBlockedRequest({ url, method, headers = {}, body = null }) {
  let host = "unparseable";
  let pathname = null;
  let queryKeys = [];
  try {
    const u = new URL(url);
    host = u.host || u.protocol;
    pathname = u.pathname;
    queryKeys = [...new Set(u.searchParams.keys())];
  } catch {
    // keep defaults
  }
  const bytes = body ? new Uint8Array(body) : null;
  const contentType = headers["content-type"] ?? null;
  const decoded = bytes && contentType && contentType.includes("protobuf") ? decodeMessage(bytes) : null;
  return {
    method,
    host,
    path: pathname,
    queryKeys,
    headerNames: Object.keys(headers).map((h) => h.toLowerCase()).sort(),
    apiKeyHeaderPresent: Object.keys(headers).some((h) => h.toLowerCase() === "x-goog-api-key"),
    contentType,
    bodyBytes: bytes ? bytes.length : 0,
    bodyProtobuf: decoded,
  };
}
