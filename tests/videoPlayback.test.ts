// Run: node --test tests/videoPlayback.test.ts (built-in type stripping)
// Community video URL resolution (same permanent public URL for every
// viewer; stored signed links never trusted), signed-link expiry, the
// first-frame hint, and failure classification (Retry only for network).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_ERR_DECODE,
  MEDIA_ERR_NETWORK,
  MEDIA_ERR_SRC_NOT_SUPPORTED,
  canRetryVideo,
  classifyVideoFailure,
  isPrivateSignedUrl,
  parseStorageUrl,
  resolveCommunityMediaUrl,
  signedUrlExpiresAt,
  videoFailureMessageKey,
  withFirstFrameHint,
} from "../src/lib/videoPlayback.ts";

const ORIGIN = "https://proj.supabase.co";
const OWNER = "11111111-1111-4111-8111-111111111111";
const PUBLIC = `${ORIGIN}/storage/v1/object/public/community-media/${OWNER}/swing-abc.mov`;

function token(exp: number): string {
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64url({ alg: "HS256" })}.${b64url({ url: "x", exp })}.sig`;
}

test("a public community-media URL resolves to itself", () => {
  assert.equal(resolveCommunityMediaUrl(PUBLIC), PUBLIC);
});

test("a stored signed link into the public bucket becomes the permanent public URL (token dropped, fragment kept)", () => {
  const signed = `${ORIGIN}/storage/v1/object/sign/community-media/${OWNER}/swing-abc.mov?token=${token(1)}#t=1`;
  assert.equal(resolveCommunityMediaUrl(signed), `${PUBLIC}#t=1`);
  const authed = `${ORIGIN}/storage/v1/object/authenticated/community-media/${OWNER}/swing-abc.mov`;
  assert.equal(resolveCommunityMediaUrl(authed), PUBLIC);
});

test("a signed link into the private caddie-media bucket is never rewritten to public", () => {
  const signed = `${ORIGIN}/storage/v1/object/sign/caddie-media/${OWNER}/caddie-1.mp4?token=${token(1)}`;
  assert.equal(resolveCommunityMediaUrl(signed), signed);
  assert.equal(isPrivateSignedUrl(signed), true);
  assert.equal(isPrivateSignedUrl(PUBLIC), false);
});

test("non-storage URLs pass through untouched", () => {
  for (const u of ["blob:https://golfme.app/123", "data:video/mp4;base64,AAAA", "https://example.com/v.mp4", undefined, ""]) {
    assert.equal(resolveCommunityMediaUrl(u), u);
  }
  assert.equal(parseStorageUrl("https://example.com/v.mp4"), null);
});

test("signed URL expiry is read from the token's exp claim", () => {
  const signed = `${ORIGIN}/storage/v1/object/sign/caddie-media/${OWNER}/c.mp4?token=${token(1_900_000_000)}`;
  assert.equal(signedUrlExpiresAt(signed), 1_900_000_000_000);
  assert.equal(signedUrlExpiresAt(PUBLIC), null);
  assert.equal(signedUrlExpiresAt(`${ORIGIN}/x?token=not-a-jwt`), null);
});

test("first-frame hint only when there is no usable poster and no fragment", () => {
  assert.equal(withFirstFrameHint(PUBLIC, false), `${PUBLIC}#t=0.001`);
  assert.equal(withFirstFrameHint(PUBLIC, true), PUBLIC);
  assert.equal(withFirstFrameHint(`${PUBLIC}#t=1`, false), `${PUBLIC}#t=1`);
  assert.equal(withFirstFrameHint("blob:x", false), "blob:x");
  assert.equal(withFirstFrameHint(undefined, false), undefined);
});

test("HTTP 400/401/403/404/410 = unavailable, never retried", () => {
  for (const status of [400, 401, 403, 404, 410]) {
    const f = classifyVideoFailure({ mediaErrorCode: MEDIA_ERR_SRC_NOT_SUPPORTED, probe: { kind: "status", status } });
    assert.equal(f, "unavailable", String(status));
    assert.equal(canRetryVideo(f), false);
  }
});

test("an expired private signed link is unavailable without probing", () => {
  assert.equal(classifyVideoFailure({ expiredPrivateLink: true, probe: undefined }), "unavailable");
});

test("network trouble (fetch failed, 5xx, 429, 408, stall) = network, retryable", () => {
  const cases = [
    { probe: { kind: "network-error" as const } },
    { probe: { kind: "status" as const, status: 503 } },
    { probe: { kind: "status" as const, status: 429 } },
    { probe: { kind: "status" as const, status: 408 } },
    { stalled: true },
    { mediaErrorCode: MEDIA_ERR_NETWORK },
  ];
  for (const c of cases) {
    const f = classifyVideoFailure(c);
    assert.equal(f, "network", JSON.stringify(c));
    assert.equal(canRetryVideo(f), true);
  }
});

test("a reachable file the device can't decode = unsupported, not retried", () => {
  for (const status of [200, 206]) {
    for (const code of [MEDIA_ERR_DECODE, MEDIA_ERR_SRC_NOT_SUPPORTED]) {
      const f = classifyVideoFailure({ mediaErrorCode: code, probe: { kind: "status", status } });
      assert.equal(f, "unsupported");
      assert.equal(canRetryVideo(f), false);
    }
  }
  // Decode error with no probe (HEAD refused) is still a decode problem.
  assert.equal(classifyVideoFailure({ mediaErrorCode: MEDIA_ERR_DECODE }), "unsupported");
  // SRC_NOT_SUPPORTED with no probe is ambiguous -> the retryable answer.
  assert.equal(classifyVideoFailure({ mediaErrorCode: MEDIA_ERR_SRC_NOT_SUPPORTED }), "network");
});

test("each failure has its own message key", () => {
  assert.equal(videoFailureMessageKey("network"), "media.videoNetworkError");
  assert.equal(videoFailureMessageKey("unavailable"), "media.videoUnavailable");
  assert.equal(videoFailureMessageKey("unsupported"), "media.videoUnsupported");
});
