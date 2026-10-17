import { Capacitor, registerPlugin } from "@capacitor/core";

// Native Sign in with Apple + Google in the iOS app.
//
// Apple guideline 4.8: an iOS app that offers Google sign-in must also offer
// Sign in with Apple. Google has been hidden in the iOS app since f5dcc57 for
// that reason. Both come back together, and only when BOTH of these hold:
//
// 1. The running native build contains the GolfMeAppleSignIn plugin
//    (ios/App/App/AppleSignInPlugin.swift). Every build before it, including
//    the one in App Review now, doesn't, so it never shows either button no
//    matter what the web code says. The iOS app loads the live site, so this
//    is what makes deploying this web code ahead of the new build safe.
// 2. SOCIAL_SIGN_IN_ENABLED below is true, or this device's test switch is on
//    (About -> tap the GolfMe logo 7 times, founder account only).
//
// The web is untouched by both: Google shows there as before, Apple doesn't.

// Flip to true (and deploy) when the build with the plugin goes to App
// Review or is released, so that build shows Apple + Google for everyone.
export const SOCIAL_SIGN_IN_ENABLED = false;

const TEST_KEY = "golfme:socialSignInTest";
const APPLE_PLUGIN = "GolfMeAppleSignIn";

export function isSocialSignInTestEnabled(): boolean {
  try {
    return window.localStorage.getItem(TEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSocialSignInTestEnabled(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(TEST_KEY, "1");
    else window.localStorage.removeItem(TEST_KEY);
  } catch {
    // Storage unavailable: the switch just doesn't stick.
  }
}

export function isNativeAppleSignInAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable(APPLE_PLUGIN);
}

// True when the native app should show Sign in with Apple and Google.
export function isNativeSocialSignInEnabled(): boolean {
  return isNativeAppleSignInAvailable() && (SOCIAL_SIGN_IN_ENABLED || isSocialSignInTestEnabled());
}

export interface AppleAuthorizeResult {
  identityToken: string;
  // Short-lived (5 min), single use. Only needed for token revocation.
  authorizationCode?: string;
  user: string;
  // Only on the first authorization of this Apple ID for GolfMe.
  email?: string;
  givenName?: string;
  familyName?: string;
}

interface GolfMeAppleSignInPlugin {
  // nonce: the RAW nonce; the plugin sends Apple its SHA-256.
  authorize(options: { nonce: string; requestScopes?: boolean }): Promise<AppleAuthorizeResult>;
}

const AppleSignIn = registerPlugin<GolfMeAppleSignInPlugin>(APPLE_PLUGIN);

// Codes the plugin rejects with (ASAuthorizationError, mapped in Swift).
export function isAppleSignInCanceled(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "canceled";
}

export function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function authorizeWithApple(nonce: string, requestScopes = true): Promise<AppleAuthorizeResult> {
  return AppleSignIn.authorize({ nonce, requestScopes });
}

interface AppleIdentityHolder {
  identities?: { provider: string }[];
  app_metadata?: { providers?: unknown };
}

// Account deletion (Apple guideline 5.1.1(v)): an account that uses Sign in
// with Apple must have its Apple tokens revoked. Supabase keeps no Apple
// refresh token for native sign-in, so the app asks Apple for a fresh
// authorization code here and delete-account exchanges it for a token and
// revokes that server-side (it needs GolfMe's Sign in with Apple key, which
// only the Edge Function holds).
//
// Returns null when there's nothing to revoke from this device (no Apple
// identity, or a build/platform without the plugin) or Apple failed for a
// reason other than the person closing the sheet: deletion then goes ahead
// without revocation rather than being blocked. Closing the sheet rethrows,
// so the caller can stop and let them try again.
export async function getAppleCodeForAccountDeletion(user: AppleIdentityHolder | null): Promise<string | null> {
  const providers = user?.app_metadata?.providers;
  const hasApple =
    Boolean(user?.identities?.some((identity) => identity.provider === "apple")) ||
    (Array.isArray(providers) && providers.includes("apple"));
  if (!hasApple || !isNativeAppleSignInAvailable()) return null;
  try {
    const result = await authorizeWithApple(randomNonce(), false);
    return result.authorizationCode ?? null;
  } catch (err) {
    if (isAppleSignInCanceled(err)) throw err;
    console.error("GolfMe: Apple re-authorization for account deletion failed.", err);
    return null;
  }
}
