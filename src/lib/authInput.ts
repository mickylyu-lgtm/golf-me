// Sign-in screen helpers: email validation, which translated message an
// auth error gets, and the email draft that survives leaving the screen.
// Kept free of React/Supabase imports so tests/authInput.test.ts runs under
// plain node --test.

// Local part, one "@", a domain with at least one dot and a 2+ letter end.
// Deliberately loose otherwise (Supabase does the real check): it only has
// to stop "a@" or "name@gmail" from sending an email that can't arrive.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

export function normalizeEmail(raw: string): string {
  return raw.trim();
}

export function isValidEmail(raw: string): boolean {
  return EMAIL.test(normalizeEmail(raw));
}

export type AuthErrorKind = "network" | "rateLimited" | "invalidEmail" | "invalidCredentials" | "accountConflict" | "serverError" | "generic";

// Sign-in identities that can't be joined to this account (an Apple or
// Google identity already on another GolfMe account, an address taken).
// GolfMe never merges accounts itself; Supabase links identities only on a
// verified email match.
const CONFLICT_CODES = new Set(["identity_already_exists", "email_exists", "user_already_exists", "email_conflict_identity_not_deletable"]);

interface AuthLikeError {
  status?: number;
  code?: string;
  name?: string;
  message?: string;
}

// Supabase errors carry a status/code; a fetch that never reached the server
// is an AuthRetryableFetchError (status 0) or a bare TypeError whose message
// depends on the browser: "Load failed" (Safari/iPhone), "Failed to fetch"
// (Chrome), "NetworkError when attempting to fetch resource." (Firefox).
// Their raw English text was shown to the golfer before.
export function authErrorKind(err: unknown): AuthErrorKind {
  if (typeof err !== "object" || err === null) return "generic";
  const { status, code, name, message } = err as AuthLikeError;
  if (status === 429 || (typeof code === "string" && code.startsWith("over_"))) return "rateLimited";
  if (code === "email_address_invalid" || code === "validation_failed") return "invalidEmail";
  if (code === "invalid_credentials") return "invalidCredentials";
  if (typeof code === "string" && CONFLICT_CODES.has(code)) return "accountConflict";
  // supabase-js reports every 5xx as AuthRetryableFetchError too, with the
  // real status; for a send that is usually the email provider failing.
  if (typeof status === "number" && status >= 500) return "serverError";
  if (name === "AuthRetryableFetchError" || status === 0) return "network";
  if (typeof message === "string" && /load failed|failed to fetch|networkerror|network request failed|network connection was lost|internet connection appears to be offline/i.test(message)) return "network";
  return "generic";
}

export const AUTH_ERROR_MESSAGE_KEY = {
  network: "auth.networkError",
  rateLimited: "auth.code.rateLimited",
  invalidEmail: "auth.invalidEmail",
  invalidCredentials: "auth.invalidCredentials",
  accountConflict: "auth.accountConflict",
  serverError: "auth.authError",
  generic: "auth.authError",
} as const satisfies Record<AuthErrorKind, string>;

// Sending the code: a server error there is almost always the email not
// going out, which gets its own message.
export function sendCodeErrorKey(kind: AuthErrorKind) {
  return kind === "serverError" ? ("auth.code.sendFailed" as const) : AUTH_ERROR_MESSAGE_KEY[kind];
}

// Apple's Hide My Email relay. A real, working address (mail is forwarded),
// but meaningless as a display name, and a different address from the one
// the person types for an email code, so the two make separate accounts.
export function isPrivateRelayEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && /@privaterelay\.appleid\.com$/i.test(email.trim());
}

// A placeholder display name from an email, for the moment before the
// profile row loads: never a relay address's random local part.
export function placeholderNameFromEmail(email: string | null | undefined): string {
  if (!email || isPrivateRelayEmail(email)) return "Golfer";
  return email.split("@")[0] || "Golfer";
}

// Signing out on purpose (log out, account deletion) vs. the session ending
// by itself (refresh token revoked or expired). AuthContext's listener asks
// this when Supabase reports SIGNED_OUT, so only the second gets a "You've
// been signed out" notice.
let intentionalSignOutAt = 0;
export function noteIntentionalSignOut(now = Date.now()): void {
  intentionalSignOutAt = now;
}
export function wasIntentionalSignOut(now = Date.now(), withinMs = 30_000): boolean {
  return now - intentionalSignOutAt >= 0 && now - intentionalSignOutAt < withinMs;
}

// What the email sign-in box was showing, kept for the rest of the browser
// session so opening Terms/Privacy (or iOS reloading the page after a trip
// to the Mail app) doesn't wipe the address or the code screen. sentAt only
// counts for SENT_TTL_MS; codes expire and a stale "check your email" screen
// would be confusing. Cleared on sign-in (AuthContext) and on "Use a
// different method".
//
// sentTo is the address the code was actually sent to (the one submitted,
// not whatever the field says later): the code screen shows it, Verify and
// resend use it. A draft saved before sentTo existed falls back to its
// email, which was the sent address then.
export interface EmailDraft {
  email: string;
  open: boolean;
  sentAt: number | null;
  sentTo: string | null;
}

export const EMAIL_DRAFT_KEY = "golfme.auth.emailDraft";
export const SENT_TTL_MS = 30 * 60 * 1000;

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadEmailDraft(now = Date.now(), store: DraftStorage | null = sessionStore()): EmailDraft | null {
  try {
    const raw = store?.getItem(EMAIL_DRAFT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<EmailDraft>;
    if (typeof v.email !== "string") return null;
    const email = v.email.slice(0, 320);
    const boundTo = normalizeEmail(typeof v.sentTo === "string" ? v.sentTo.slice(0, 320) : email);
    const sent = typeof v.sentAt === "number" && now - v.sentAt >= 0 && now - v.sentAt < SENT_TTL_MS && isValidEmail(boundTo);
    const sentAt = sent ? (v.sentAt as number) : null;
    return { email, open: v.open === true || sent, sentAt, sentTo: sent ? boundTo : null };
  } catch {
    return null;
  }
}

export function saveEmailDraft(draft: EmailDraft, store: DraftStorage | null = sessionStore()): void {
  try {
    if (!draft.email && !draft.open && draft.sentAt === null && draft.sentTo === null) store?.removeItem(EMAIL_DRAFT_KEY);
    else store?.setItem(EMAIL_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage blocked: the draft just isn't kept.
  }
}

export function clearEmailDraft(store: DraftStorage | null = sessionStore()): void {
  try {
    store?.removeItem(EMAIL_DRAFT_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}
