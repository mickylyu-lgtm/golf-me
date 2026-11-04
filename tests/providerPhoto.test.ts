// Run: npm run test:onboarding  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isGooglePhotoUrl, providerPhotoUrl, sizedGooglePhotoUrl } from "../src/lib/providerPhoto.ts";

const PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocJx1abc=s96-c";

test("a Google account's picture is used, at the stored size", () => {
  const user = { app_metadata: { provider: "google", providers: ["google"] }, user_metadata: { avatar_url: PHOTO } };
  assert.equal(providerPhotoUrl(user), "https://lh3.googleusercontent.com/a/ACg8ocJx1abc=s320-c");
});

test("falls back to the picture claim, and accepts google in providers", () => {
  const user = { app_metadata: { provider: "email", providers: ["email", "google"] }, user_metadata: { picture: PHOTO } };
  assert.equal(providerPhotoUrl(user), "https://lh3.googleusercontent.com/a/ACg8ocJx1abc=s320-c");
});

test("no photo for email, Apple or missing users", () => {
  assert.equal(providerPhotoUrl(null), undefined);
  assert.equal(providerPhotoUrl({ app_metadata: { provider: "email" }, user_metadata: { avatar_url: PHOTO } }), undefined);
  assert.equal(providerPhotoUrl({ app_metadata: { provider: "apple" }, user_metadata: {} }), undefined);
  assert.equal(providerPhotoUrl({ app_metadata: { provider: "google" }, user_metadata: { avatar_url: "  " } }), undefined);
});

test("a self-written avatar_url off Google's photo host is ignored", () => {
  for (const url of [
    "http://lh3.googleusercontent.com/a/x=s96-c",
    "https://evil.example/a.png",
    "https://googleusercontent.com.evil.example/a.png",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(isGooglePhotoUrl(url), false, url);
    assert.equal(providerPhotoUrl({ app_metadata: { provider: "google" }, user_metadata: { avatar_url: url } }), undefined, url);
  }
  assert.equal(isGooglePhotoUrl("https://googleusercontent.com/x"), true);
});

test("size option is replaced, added, or left alone", () => {
  assert.equal(sizedGooglePhotoUrl("https://lh3.googleusercontent.com/a/x=s96-c"), "https://lh3.googleusercontent.com/a/x=s320-c");
  assert.equal(sizedGooglePhotoUrl("https://lh3.googleusercontent.com/a/x=s96"), "https://lh3.googleusercontent.com/a/x=s320-c");
  assert.equal(sizedGooglePhotoUrl("https://lh3.googleusercontent.com/a/x"), "https://lh3.googleusercontent.com/a/x=s320-c");
  assert.equal(sizedGooglePhotoUrl("https://lh3.googleusercontent.com/a/x=w200-h200"), "https://lh3.googleusercontent.com/a/x=w200-h200");
});
