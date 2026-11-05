#!/usr/bin/env node
// Headless check of the sign-in screens (welcome -> email -> code) with the
// Supabase auth endpoints mocked (Playwright route interception).
//
// Starts its own Vite dev server for this checkout (--port, default 5314,
// strictPort) with VITE_SUPABASE_URL=http://127.0.0.1:9 and a dummy anon
// key, so nothing real is reached: every request to 127.0.0.1:9 is answered
// by the mock below (POST /auth/v1/otp and /auth/v1/verify with scripted
// delays / failures, GET /auth/v1/authorize for Google/Apple; anything else
// 404). English, headless Chromium.
//
// Flow scenarios (390x844): delayed send with an edit attempt, double
// submit, Change email, overlapping resend + Change email, resend after the
// countdown, double-tap resend, send failures, verification against the
// bound address, paste + auto-submit once, wrong code, expired and
// already-used links with and without a saved code screen, the resend
// countdown across a simulated background/resume (page.clock), Google's
// redirect URL, the demo account, the App Review password entry, and the
// offline cold start (a stored session with an expired access token while
// the refresh endpoint is unreachable: the loader holds, then the session
// returns on its own or via the loader's Try again; a revoked refresh token
// signs out instead). The cold-start cases wait on auth-js's real ~30 s
// refresh retries and 60 s failure cache, so a full run takes ~4-5 min.
// Layout scenarios at 375x667, 390x844 and 1280x800: every method button
// visible without scrolling, no horizontal overflow, no layout shift while
// the photo loads, the field + Send button / code boxes above a simulated
// 260px keyboard, reduced motion; screenshots of each step.
// --apple: also start a second server with VITE_APPLE_WEB_SIGN_IN=true and
// check Apple first in the order, its redirect, and a cancelled Apple
// return showing no error.
//
// Usage: node scripts/dev/signin-flow.mjs [--port 5314] [--apple]
//        SIGNIN_SHOTS=/some/dir to keep screenshots.
// Exit code 1 when any check fails. Real Supabase auth, the real email
// link, Apple's real pages, WKWebView and an iPhone (resume from Mail) are
// NOT covered.

import { chromium } from "playwright-core";
import { createServer } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 5314;
const withApple = process.argv.includes("--apple");
const SUPA = "http://127.0.0.1:9";
const shotDir = process.env.SIGNIN_SHOTS;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// After the 250ms step fade-in has finished.
async function shot(page, name) {
  if (!shotDir) return;
  await sleep(400);
  await page.screenshot({ path: path.join(shotDir, `${name}.png`) }).catch(() => {});
}

// Per-page scripted auth server.
async function mockAuth(page) {
  const log = { otp: [], verify: [], authorize: [], token: 0 };
  // otp/verify: queued {delay, status, body, abort}. token: how the refresh
  // endpoint answers right now ("offline" | "ok" | "revoked").
  const plan = { otp: [], verify: [], token: "offline" };
  await page.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      log.token += 1;
      if (plan.token === "offline") return route.abort("internetdisconnected");
      if (plan.token === "revoked")
        return route.fulfill({ status: 400, headers: cors(), contentType: "application/json", body: JSON.stringify({ code: "refresh_token_not_found", error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }) });
      const now = Math.floor(Date.now() / 1000);
      return route.fulfill({ status: 200, headers: cors(), contentType: "application/json", body: JSON.stringify({ ...TEST_SESSION, access_token: "fresh-access", refresh_token: "r2", expires_in: 3600, expires_at: now + 3600 }) });
    }
    if (url.pathname === "/rest/v1/profiles" && req.method() === "GET") {
      // A signed-up but not yet onboarded account: restored -> /profile-setup.
      return route.fulfill({ status: 200, headers: cors(), contentType: "application/json", body: JSON.stringify({ id: TEST_USER.id, has_onboarded: false, name: null }) });
    }
    if (url.pathname === "/auth/v1/authorize") {
      log.authorize.push(Object.fromEntries(url.searchParams));
      return route.fulfill({ status: 200, contentType: "text/html", body: "<title>provider</title><p>provider page</p>" });
    }
    const kind = url.pathname === "/auth/v1/otp" ? "otp" : url.pathname === "/auth/v1/verify" ? "verify" : null;
    if (!kind || req.method() !== "POST") return route.fulfill({ status: 404, headers: cors(), contentType: "application/json", body: "{}" });
    const body = JSON.parse(req.postData() || "{}");
    log[kind].push(body);
    const step = plan[kind].shift() ?? { delay: 0, status: 200, body: {} };
    if (step.delay) await sleep(step.delay);
    if (step.abort) return route.abort("failed");
    return route.fulfill({ status: step.status, headers: cors(), contentType: "application/json", body: JSON.stringify(step.body ?? {}) });
  });
  return { log, plan };
}
// A fake signed-in session for the offline cold-start checks; only the mock
// above ever sees it.
const TEST_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "restored@example.com",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-10-01T00:00:00Z",
};
const TEST_SESSION = { access_token: "expired-access", refresh_token: "r1", token_type: "bearer", expires_in: 3600, expires_at: 1_700_000_000, user: TEST_USER };

// Seeds the stored session once per tab (not again after a reload, so a
// rotated session isn't overwritten).
async function seedExpiredSession(page) {
  await page.addInitScript((session) => {
    if (sessionStorage.getItem("seeded")) return;
    localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    sessionStorage.setItem("seeded", "1");
  }, TEST_SESSION);
}

const signInVisible = (page) => page.getByRole("button", { name: "Continue with Email" }).isVisible();
const storedSession = (page) => page.evaluate(() => localStorage.getItem("sb-127-auth-token"));

function cors() {
  return { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
}

const CHECK_EMAIL = "Check your email";
const SEND = "Send code";
const CHANGE = "Change email";
const RESEND_NEW = "Send a new code"; // the failed-link notice's action
const RESEND = /^Resend code/;
const LINK_TITLE = "That sign-in link didn't work";
const WRONG = "That code is wrong or has expired";

async function openEmailBox(page, base) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Continue with Email" }).click();
  await page.locator("#auth-email").waitFor();
}

async function codeScreenShows(page, address) {
  await page.getByRole("heading", { name: CHECK_EMAIL }).waitFor({ timeout: 5000 });
  return (await page.locator("p", { hasText: "We've sent a" }).innerText()).includes(address);
}

async function draft(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem("golfme.auth.emailDraft") || "null"));
}

async function sendTo(page, address) {
  await page.fill("#auth-email", address);
  await page.getByRole("button", { name: SEND }).click();
  await codeScreenShows(page, address);
}

const resendLink = (page) => page.locator("button", { hasText: RESEND });

const flows = {
  async delayedSendWithEdit(page, base) {
    const { log, plan } = await mockAuth(page);
    plan.otp.push({ delay: 1500, status: 200, body: {} });
    await openEmailBox(page, base);
    await page.fill("#auth-email", "a@example.com");
    await page.getByRole("button", { name: SEND }).click();
    await sleep(100);
    check("email field is disabled while sending", await page.locator("#auth-email").isDisabled());
    // Force an edit anyway (as if the DOM let it through), then submit again.
    await page.evaluate(() => {
      const el = document.getElementById("auth-email");
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(el, "b@example.com");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.evaluate(() => document.querySelector("form")?.requestSubmit());
    check("code screen bound to the submitted address after a mid-flight edit", await codeScreenShows(page, "a@example.com"));
    check("only one email sent for submit + resubmit while in flight", log.otp.length === 1, `otp calls ${log.otp.length}`);
    check("the request went to the submitted address", log.otp[0]?.email === "a@example.com", log.otp[0]?.email);
    const d = await draft(page);
    check("saved draft binds sentTo to the submitted address", d?.sentTo === "a@example.com", JSON.stringify(d));
    // Typing all six digits auto-submits, to the bound address.
    plan.verify.push({ delay: 300, status: 403, body: { code: "otp_expired", msg: "Token has expired or is invalid" } });
    await page.locator("#email-otp").pressSequentially("123456");
    await page.getByText(WRONG).waitFor({ timeout: 5000 });
    check("six digits auto-submit, against the bound address", log.verify.length === 1 && log.verify[0]?.email === "a@example.com" && log.verify[0]?.token === "123456", JSON.stringify(log.verify));
    check("wrong code: alert shown, boxes cleared for the next try", (await page.locator("#email-otp-error").getAttribute("role")) === "alert" && (await page.locator("#email-otp").inputValue()) === "");
  },

  async pasteAutoSubmitOnce(page, base) {
    const { log, plan } = await mockAuth(page);
    await openEmailBox(page, base);
    await sendTo(page, "a@example.com");
    check("code field: one-time-code autofill + numeric keypad", (await page.locator("#email-otp").getAttribute("autocomplete")) === "one-time-code" && (await page.locator("#email-otp").getAttribute("inputmode")) === "numeric");
    check("code field focused on arrival", await page.locator("#email-otp").evaluate((el) => el === document.activeElement));
    plan.verify.push({ delay: 800, status: 403, body: { code: "otp_expired" } });
    // Paste "123 456" into the single field (what iOS autofill/paste does).
    await page.locator("#email-otp").evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(el, "123 456");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(100);
    const boxes = await page.locator("form [aria-hidden] > span").allInnerTexts();
    check("pasted code fills all six boxes", boxes.join("") === "123456", boxes.join("|"));
    check("verifying state shown", await page.getByText("Signing you in").isVisible());
    // Enter + button while the first verify is in flight: still one request.
    await page.evaluate(() => document.querySelectorAll("form")[0]?.requestSubmit());
    await page.getByText(WRONG).waitFor({ timeout: 5000 });
    check("auto-submit + Enter while verifying = one verify request", log.verify.length === 1, `verify calls ${log.verify.length}`);
    // Same wrong code pasted again: not auto-sent a second time by itself.
    plan.verify.push({ status: 403, body: { code: "otp_expired" } });
    await page.locator("#email-otp").fill("123456");
    await sleep(300);
    check("the same wrong code isn't auto-resent", log.verify.length === 1, `verify calls ${log.verify.length}`);
    // A corrected code is.
    plan.verify.unshift({ status: 403, body: { code: "otp_expired" } });
    await page.locator("#email-otp").fill("654321");
    await page.getByText(WRONG).waitFor({ timeout: 5000 });
    check("a corrected code auto-submits", log.verify.length === 2 && log.verify[1]?.token === "654321", JSON.stringify(log.verify.map((v) => v.token)));
    // Network failure keeps the code for a manual retry.
    plan.verify.length = 0;
    plan.verify.push({ abort: true });
    await page.locator("#email-otp").fill("111222");
    await page.getByText("Couldn't reach GolfMe").first().waitFor({ timeout: 8000 });
    check("network failure keeps the code; Sign in with code retries", (await page.locator("#email-otp").inputValue()) === "111222" && !(await page.getByRole("button", { name: "Sign in with code" }).isDisabled()));
  },

  async changeEmailAndOverlap(page, base) {
    await page.clock.install({ time: new Date("2026-11-05T12:00:00Z") });
    const { log, plan } = await mockAuth(page);
    await openEmailBox(page, base);
    await sendTo(page, "a@example.com");
    // Countdown over -> resend, slow; leave with Change email mid-flight.
    await page.clock.fastForward(61_000);
    plan.otp.push({ delay: 2000, status: 200, body: {} });
    await resendLink(page).click();
    await sleep(100);
    await page.getByRole("button", { name: CHANGE }).click();
    const field = page.locator("#auth-email");
    await field.waitFor();
    check("Change email returns to the email step with the address kept", (await field.inputValue()) === "a@example.com");
    check("Change email focuses the field", await field.evaluate((el) => el === document.activeElement));
    check("field editable after leaving a resend in flight", !(await field.isDisabled()));
    await field.fill("b@example.com");
    await page.getByRole("button", { name: SEND }).click();
    check("new address gets its own code screen", await codeScreenShows(page, "b@example.com"));
    await sleep(2200); // the stale resend to A answers now
    check("late answer for the old address is ignored", await codeScreenShows(page, "b@example.com"));
    const toasts = await page.getByText("New email sent").count();
    check("no 'New email sent' toast from the stale resend", toasts === 0, `toasts ${toasts}`);
    check("requests: A, resend A, B", JSON.stringify(log.otp.map((b) => b.email)) === JSON.stringify(["a@example.com", "a@example.com", "b@example.com"]), JSON.stringify(log.otp.map((b) => b.email)));
    plan.verify.push({ status: 403, body: { code: "otp_expired" } });
    await page.locator("#email-otp").fill("654321");
    await page.getByText(WRONG).waitFor({ timeout: 5000 });
    check("verify after changing goes to the new address", log.verify[0]?.email === "b@example.com", log.verify[0]?.email);
    // The header Back on the code step is Change email too.
    await page.getByRole("button", { name: "Back" }).click();
    check("Back on the code step = Change email", (await page.locator("#auth-email").inputValue()) === "b@example.com");
  },

  async resendDoubleTapAndCountdown(page, base) {
    await page.clock.install({ time: new Date("2026-11-05T12:00:00Z") });
    const { log, plan } = await mockAuth(page);
    await openEmailBox(page, base);
    await sendTo(page, "a@example.com");
    const resendBtn = resendLink(page);
    check("resend disabled during the countdown", await resendBtn.isDisabled(), await resendBtn.innerText());
    // Background for 45 s after the send: system time moves, timers don't fire.
    const { sentAt } = await draft(page);
    await page.clock.setSystemTime(sentAt + 45_000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await sleep(50);
    const label = await resendBtn.innerText();
    const secs = Number(label.match(/(\d+)s/)?.[1]);
    check("resume recomputes the countdown from the send time", secs === 15, label);
    // Back after the cooldown: focus alone ends it.
    await page.clock.setSystemTime(sentAt + 5 * 60_000);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await sleep(50);
    check("resume past the cooldown ends it", !(await resendBtn.isDisabled()), await resendBtn.innerText());
    // Double tap resend.
    plan.otp.push({ delay: 800, status: 200, body: {} });
    await resendBtn.evaluate((el) => {
      el.click();
      el.click();
    });
    await page.getByText("New email sent").first().waitFor({ timeout: 5000 });
    check("double-tap resend sends once", log.otp.length === 2, `otp calls ${log.otp.length}`);
    check("resend went to the bound address", log.otp[1]?.email === "a@example.com");
    check("countdown restarts after a resend", await resendBtn.isDisabled(), await resendBtn.innerText());
    // Clock moved far back: countdown ends instead of growing.
    await page.clock.setSystemTime(sentAt - 3_600_000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await sleep(50);
    check("clock moved backwards ends the countdown", !(await resendBtn.isDisabled()), await resendBtn.innerText());
    // 429 on resend: countdown restarts from the answer.
    plan.otp.push({ status: 429, body: { code: "over_email_send_rate_limit", msg: "rate" } });
    await resendBtn.click();
    await page.getByText("Too many tries").first().waitFor({ timeout: 5000 });
    check("rate-limited resend restarts the countdown", await resendBtn.isDisabled(), await resendBtn.innerText());
  },

  async sendFailure(page, base) {
    const { log, plan } = await mockAuth(page);
    plan.otp.push({ delay: 500, abort: true });
    await openEmailBox(page, base);
    await page.fill("#auth-email", "a@example.com");
    await page.getByRole("button", { name: SEND }).click();
    await page.getByText("Couldn't reach GolfMe").first().waitFor({ timeout: 8000 });
    check("network failure stays on the email step", (await page.getByRole("heading", { name: CHECK_EMAIL }).count()) === 0);
    check("field usable again with the address kept", !(await page.locator("#auth-email").isDisabled()) && (await page.locator("#auth-email").inputValue()) === "a@example.com");
    // 5xx from Supabase (supabase-js: AuthRetryableFetchError) = the email didn't go out.
    plan.otp.push({ status: 500, body: { code: "unexpected_failure", msg: "Error sending magic link email" } });
    await page.getByRole("button", { name: SEND }).click();
    await page.getByText("We couldn't send your code right now").first().waitFor({ timeout: 8000 });
    check("email delivery failure: its own friendly message", true);
    plan.otp.push({ status: 422, body: { code: "email_provider_disabled", msg: "Email logins are disabled" } });
    await page.getByRole("button", { name: SEND }).click();
    await page.getByText("Something went wrong signing you in").first().waitFor({ timeout: 5000 });
    const raw = await page.getByText(/Email logins are disabled|Error sending magic link|unexpected_failure/).count();
    check("no raw Supabase text shown", raw === 0, `raw ${raw}`);
    plan.otp.push({ status: 429, body: { code: "over_email_send_rate_limit", msg: "email rate limit exceeded" } });
    await page.getByRole("button", { name: SEND }).click();
    await page.getByText("Too many tries").first().waitFor({ timeout: 5000 });
    check("rate limit: friendly message, still on the email step", (await page.getByRole("heading", { name: CHECK_EMAIL }).count()) === 0, `otp calls ${log.otp.length}`);
    await page.getByRole("button", { name: SEND }).click();
    check("retry after failures works", await codeScreenShows(page, "a@example.com"));
  },

  async invalidEmail(page, base) {
    const { log } = await mockAuth(page);
    await openEmailBox(page, base);
    await page.fill("#auth-email", "name@gmail");
    await page.locator("#auth-email").blur();
    check("invalid email: inline alert, Send disabled, nothing sent", (await page.locator("#auth-email-error").isVisible()) && (await page.getByRole("button", { name: SEND }).isDisabled()) && log.otp.length === 0);
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Continue with Email" }).click();
    check("Back to welcome and in again keeps the typed address", (await page.locator("#auth-email").inputValue()) === "name@gmail");
  },

  async expiredLinkNoSavedState(page, base) {
    const { log } = await mockAuth(page);
    await page.goto(`${base}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`, { waitUntil: "domcontentloaded" });
    const alert = page.getByRole("alert").filter({ hasText: LINK_TITLE });
    await alert.waitFor({ timeout: 8000 });
    check("expired link: alert on the email step", true, new URL(page.url()).pathname);
    const btn = alert.getByRole("button", { name: RESEND_NEW });
    await btn.click();
    check("Send a new code with no email focuses the field", await page.locator("#auth-email").evaluate((el) => el === document.activeElement));
    await page.fill("#auth-email", "c@example.com");
    await btn.click();
    check("expired link -> fresh code screen", await codeScreenShows(page, "c@example.com"));
    check("fresh code went to the typed address", log.otp[0]?.email === "c@example.com");
    check("alert gone after a fresh code", (await page.getByText(LINK_TITLE).count()) === 0);
  },

  async usedLinkWithSavedCodeScreen(page, base) {
    const { log } = await mockAuth(page);
    // A saved code screen from 2 min ago (countdown over), then an
    // already-used link (description-only redirect).
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() =>
      sessionStorage.setItem("golfme.auth.emailDraft", JSON.stringify({ email: "a@example.com", open: true, sentAt: Date.now() - 120_000, sentTo: "a@example.com" })),
    );
    await page.goto(`${base}/#error=access_denied&error_description=Email+link+is+invalid+or+has+expired`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: CHECK_EMAIL }).waitFor({ timeout: 8000 });
    const alert = page.getByRole("alert").filter({ hasText: LINK_TITLE });
    await alert.waitFor({ timeout: 5000 });
    check("used link + saved code screen: alert on the code screen", (await alert.innerText()).includes("a@example.com"));
    await alert.getByRole("button", { name: RESEND_NEW }).click();
    await page.getByText("New email sent").first().waitFor({ timeout: 5000 });
    check("Send a new code resends to the bound address", log.otp[0]?.email === "a@example.com");
    check("alert cleared after the new code", (await page.getByText(LINK_TITLE).count()) === 0);
  },

  async expiredLinkWithFreshSavedCodeScreen(page, base) {
    await mockAuth(page);
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() =>
      sessionStorage.setItem("golfme.auth.emailDraft", JSON.stringify({ email: "a@example.com", open: true, sentAt: Date.now() - 10_000, sentTo: "a@example.com" })),
    );
    await page.goto(`${base}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`, { waitUntil: "domcontentloaded" });
    const alert = page.getByRole("alert").filter({ hasText: LINK_TITLE });
    await alert.waitFor({ timeout: 8000 });
    const btn = alert.locator("button");
    check("expired link + recent send: recovery waits for the countdown", await btn.isDisabled(), await btn.innerText());
    await page.getByRole("button", { name: CHANGE }).click();
    check("Change email from the alert screen keeps the address", (await page.locator("#auth-email").inputValue()) === "a@example.com");
  },

  async legacyDraftWithoutSentTo(page, base) {
    await mockAuth(page);
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => sessionStorage.setItem("golfme.auth.emailDraft", JSON.stringify({ email: "old@example.com", open: true, sentAt: Date.now() - 5000 })));
    await page.reload({ waitUntil: "domcontentloaded" });
    check("draft saved by the previous build restores its code screen", await codeScreenShows(page, "old@example.com"));
  },

  async googleUnchanged(page, base) {
    const { log } = await mockAuth(page);
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    const names = await page.locator("main, body").getByRole("button").allInnerTexts();
    const order = names.map((n) => n.trim()).filter((n) => /^Continue with/.test(n));
    check("web, Apple flag off: Google then Email, no Apple", JSON.stringify(order) === JSON.stringify(["Continue with Google", "Continue with Email"]), JSON.stringify(order));
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL(/\/auth\/v1\/authorize/, { timeout: 8000 });
    const a = log.authorize[0] ?? {};
    check("Google: same OAuth redirect as before", a.provider === "google" && a.redirect_to === base && a.prompt === "select_account", JSON.stringify(a));
  },

  async demoPath(page, base) {
    await mockAuth(page);
    await page.goto(`${base}/login?demo=1`, { waitUntil: "domcontentloaded" });
    check("?demo shows Try Demo Account and the password link", (await page.getByRole("button", { name: "Try Demo Account" }).isVisible()) && (await page.getByRole("button", { name: "Sign in with a password" }).isVisible()));
    await page.getByRole("button", { name: "Try Demo Account" }).click();
    await page.waitForURL(`${base}/`, { timeout: 8000 });
    check("demo account signs in to Home", true, page.url());
  },

  // Stored session with an expired access token, Supabase unreachable at
  // launch: the loader holds (never Welcome/sign-in), then the session comes
  // back by itself once the network does.
  async offlineColdStartHolds(page, base) {
    await seedExpiredSession(page);
    const { log, plan } = await mockAuth(page);
    plan.token = "offline";
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    let sawSignedOut = false;
    for (let i = 0; i < 45; i++) {
      const p = new URL(page.url()).pathname;
      if (p === "/welcome" || p === "/login" || (await signInVisible(page))) sawSignedOut = true;
      await sleep(1000);
    }
    check("offline start: never shows Welcome/sign-in in 45 s", !sawSignedOut, new URL(page.url()).pathname);
    check("offline start: the loader holds, with its retry", (await page.getByText("Getting GolfMe ready").isVisible()) && (await page.getByRole("button", { name: "Try again" }).isVisible()));
    check("offline start: refresh was attempted, stored session kept", log.token > 0 && (await storedSession(page)) !== null, `refresh attempts ${log.token}`);
    // Network back: no tap needed (online event + periodic retry; auth-js
    // caches a failed refresh for up to 60 s).
    plan.token = "ok";
    const t0 = Date.now();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForURL(/\/profile-setup$/, { timeout: 90_000 });
    check("network back: session restored without signing in again", JSON.parse((await storedSession(page)) ?? "{}").refresh_token === "r2", `${Math.round((Date.now() - t0) / 1000)} s after the network returned`);
  },

  // Same start, but the person taps the loader's "Try again" once the
  // network is back: immediate recovery (reload, fresh auth client).
  async offlineColdStartRetryButton(page, base) {
    await seedExpiredSession(page);
    const { plan } = await mockAuth(page);
    plan.token = "offline";
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Try again" }).waitFor({ timeout: 60_000 });
    await sleep(35_000); // past auth-js's own refresh retries
    check("offline start (retry case): still on the loader", !(await signInVisible(page)) && new URL(page.url()).pathname === "/");
    plan.token = "ok";
    const t0 = Date.now();
    await page.getByRole("button", { name: "Try again" }).click();
    await page.waitForURL(/\/profile-setup$/, { timeout: 30_000 });
    check("Try again after the network returns restores the session", true, `${Math.round((Date.now() - t0) / 1000)} s`);
  },

  // Refresh token rejected (revoked/expired) at launch: no stuck loader, the
  // signed-out screen shows and the dead session is cleared.
  async revokedSessionColdStart(page, base) {
    await seedExpiredSession(page);
    const { plan } = await mockAuth(page);
    plan.token = "revoked";
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/(welcome|login)$/, { timeout: 20_000 });
    check("revoked session at launch: signed-out screen, not a held loader", (await page.getByText("Getting GolfMe ready").count()) === 0, new URL(page.url()).pathname);
    check("revoked session at launch: stored session cleared", (await storedSession(page)) === null);
  },

  async reviewPasswordEntry(page, base) {
    await mockAuth(page);
    await page.goto(`${base}/login?review=1`, { waitUntil: "domcontentloaded" });
    check("?review=1 opens the password form (App Review path)", await page.locator('input[name="password"]').isVisible());
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    check("public web login shows no password sign-in", (await page.getByRole("button", { name: "Sign in with a password" }).count()) === 0 && (await page.getByRole("button", { name: "Try Demo Account" }).count()) === 0);
  },
};

const VIEWPORTS = [
  { name: "375x667", width: 375, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "1280x800", width: 1280, height: 800 },
];

async function layoutChecks(browser, base) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "en-US", deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const { plan } = await mockAuth(page);
    // Slow photo, to see whether anything moves when it arrives.
    await page.route("**/courses/skyway-aerial.jpg", async (route) => {
      await sleep(1200);
      return route.continue();
    });
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Continue with Email" }).waitFor();
    const before = await page.getByRole("button", { name: "Continue with Email" }).boundingBox();
    await page.waitForFunction(() => document.querySelector("img")?.complete, null, { timeout: 8000 });
    await sleep(400);
    const after = await page.getByRole("button", { name: "Continue with Email" }).boundingBox();
    const cls = await page.evaluate(() => window.__cls);
    check(`${vp.name} welcome: no layout shift while the photo loads`, before && after && before.y === after.y && cls < 0.01, `y ${before?.y}->${after?.y}, CLS ${cls.toFixed(4)}`);
    const fits = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((b) => /^Continue with/.test(b.innerText.trim()));
      const legal = [...document.querySelectorAll("p")].find((p) => p.innerText.includes("By continuing"));
      const bottom = Math.max(...btns.map((b) => b.getBoundingClientRect().bottom), legal?.getBoundingClientRect().bottom ?? 0);
      const heights = btns.map((b) => Math.round(b.getBoundingClientRect().height));
      return { bottom, vh: innerHeight, heights, overflowX: document.documentElement.scrollWidth > innerWidth };
    });
    check(`${vp.name} welcome: all methods + terms visible without scrolling`, fits.bottom <= fits.vh, `bottom ${Math.round(fits.bottom)} / ${fits.vh}`);
    check(`${vp.name} welcome: tap targets >= 44px, no horizontal overflow`, fits.heights.every((h) => h >= 44) && !fits.overflowX, JSON.stringify(fits.heights));
    await shot(page, `${vp.name}-1-welcome`);

    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.locator("#auth-email").waitFor();
    await page.fill("#auth-email", "golfer@example.com");
    await shot(page, `${vp.name}-2-email`);
    // A 260px keyboard: field and Send must stay above it (top-aligned layout).
    if (vp.width < 1000) {
      await page.setViewportSize({ width: vp.width, height: vp.height - 260 });
      await sleep(150);
      const r = await page.evaluate(() => {
        const send = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Send code");
        return { field: document.getElementById("auth-email").getBoundingClientRect().bottom, send: send.getBoundingClientRect().bottom, vh: innerHeight, scrollY };
      });
      check(`${vp.name} email: field + Send above a 260px keyboard`, r.field <= r.vh && r.send <= r.vh, JSON.stringify(r));
      await page.setViewportSize({ width: vp.width, height: vp.height });
    }
    plan.otp.push({ status: 200, body: {} });
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByRole("heading", { name: CHECK_EMAIL }).waitFor();
    await page.locator("#email-otp").pressSequentially("12");
    await shot(page, `${vp.name}-3-code`);
    if (vp.width < 1000) {
      await page.setViewportSize({ width: vp.width, height: vp.height - 260 });
      await sleep(150);
      const r = await page.evaluate(() => ({ boxes: document.getElementById("email-otp").getBoundingClientRect().bottom, vh: innerHeight }));
      check(`${vp.name} code: boxes above a 260px keyboard`, r.boxes <= r.vh, JSON.stringify(r));
      await page.setViewportSize({ width: vp.width, height: vp.height });
    }
    const boxRow = await page.evaluate(() => {
      const row = document.querySelector("form [aria-hidden]");
      const b = row.getBoundingClientRect();
      return { right: b.right, vw: innerWidth, overflowX: document.documentElement.scrollWidth > innerWidth };
    });
    check(`${vp.name} code: six boxes fit, no horizontal overflow`, boxRow.right <= boxRow.vw && !boxRow.overflowX, JSON.stringify(boxRow));
    plan.verify.push({ status: 403, body: { code: "otp_expired" } });
    await page.locator("#email-otp").pressSequentially("3456");
    await page.getByText(WRONG).waitFor({ timeout: 5000 });
    await shot(page, `${vp.name}-4-code-error`);
    check(`${vp.name}: no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // Reduced motion: the app's global prefers-reduced-motion rule (index.css)
  // collapses every animation to 0.01ms; nothing on these steps may outlast it.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US", reducedMotion: "reduce" });
  const page = await context.newPage();
  await mockAuth(page);
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Continue with Email" }).click();
  await page.locator("#auth-email").waitFor();
  const anim = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .map((el) => getComputedStyle(el))
      .filter((s) => s.animationName && s.animationName !== "none" && parseFloat(s.animationDuration) * (s.animationDuration.endsWith("ms") ? 1 : 1000) > 1)
      .map((s) => `${s.animationName} ${s.animationDuration}`),
  );
  check("reduced motion: no visible animation on the sign-in steps", anim.length === 0, JSON.stringify(anim));
  await context.close();
}

async function appleChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
  const page = await context.newPage();
  const { log } = await mockAuth(page);
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Continue with Email" }).waitFor();
  const order = (await page.getByRole("button").allInnerTexts()).map((n) => n.trim()).filter((n) => /^Continue with/.test(n));
  check("Apple flag on: Apple, Google, Email in that order", JSON.stringify(order) === JSON.stringify(["Continue with Apple", "Continue with Google", "Continue with Email"]), JSON.stringify(order));
  await shot(page, "apple-on-welcome");
  await page.getByRole("button", { name: "Continue with Apple" }).click();
  await page.waitForURL(/\/auth\/v1\/authorize/, { timeout: 8000 });
  const a = log.authorize[0] ?? {};
  check("Apple web: Supabase Apple OAuth redirect back to this origin", a.provider === "apple" && a.redirect_to === base, JSON.stringify(a));
  // Cancelled on Apple's page: Supabase sends the person back with an error.
  await page.goto(`${base}/#error=access_denied&error_description=user_cancelled_authorize`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Continue with Apple" }).waitFor();
  await sleep(500);
  const toast = await page.getByText(/went wrong|didn't finish/).count();
  check("Apple cancel: back on the sign-in screen, no error shown", toast === 0, new URL(page.url()).pathname);
  // A real failure redirect does get a friendly message.
  await page.goto(`${base}/#error=server_error&error_description=Unable+to+exchange+external+code`, { waitUntil: "domcontentloaded" });
  await page.getByText("Something went wrong signing you in").first().waitFor({ timeout: 5000 });
  check("provider failure redirect: friendly message, no raw text", (await page.getByText("Unable to exchange external code").count()) === 0);
  await context.close();
}

const executablePath = (() => {
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  const dir = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop() : null;
  if (!dir) return undefined;
  const sub = fs.readdirSync(path.join(cache, dir)).find((d) => d.startsWith("chrome-"));
  return sub ? path.join(cache, dir, sub, "chrome-headless-shell") : undefined;
})();
const libRoot = [process.env.GOLFME_CHROMIUM_LIBS, path.join(os.homedir(), ".cache", "golfme-chromium-libs", "root")].find((d) => d && fs.existsSync(d));
const env = { ...process.env };
if (libRoot) env.LD_LIBRARY_PATH = [path.join(libRoot, "usr/lib/x86_64-linux-gnu"), path.join(libRoot, "lib/x86_64-linux-gnu"), env.LD_LIBRARY_PATH].filter(Boolean).join(":");

async function startServer(p, appleWeb) {
  process.env.VITE_SUPABASE_URL = SUPA;
  process.env.VITE_SUPABASE_ANON_KEY = "dummy";
  if (appleWeb) process.env.VITE_APPLE_WEB_SIGN_IN = "true";
  else delete process.env.VITE_APPLE_WEB_SIGN_IN;
  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
    cacheDir: path.join(os.tmpdir(), `golfme-signin-flow-vite-${p}`),
    server: { port: p, strictPort: true, host: "127.0.0.1", hmr: false, fs: { allow: [root, path.dirname(fs.realpathSync(path.join(root, "node_modules")))] } },
    logLevel: "error",
  });
  await server.listen();
  return server;
}

const browser = await chromium.launch({ headless: true, executablePath, env });
let server = await startServer(port, false);
const base = `http://127.0.0.1:${port}`;
try {
  for (const [name, run] of Object.entries(flows)) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await run(page, base);
    } catch (e) {
      check(`${name}: ran to the end`, false, String(e).split("\n")[0]);
    }
    await shot(page, `flow-${name}`);
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
  await layoutChecks(browser, base);
  if (withApple) {
    await server.close();
    server = await startServer(port + 1, true);
    await appleChecks(browser, `http://127.0.0.1:${port + 1}`);
  }
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
