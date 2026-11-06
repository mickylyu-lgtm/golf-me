// The profile picture a sign-in provider gave us, used to prefill the photo
// on the onboarding screen. Today only Google sends one (Apple never does).
// Kept free of React/Supabase imports so tests/providerPhoto.test.ts runs
// under plain node --test.
//
// user_metadata is writable by the user themselves (auth.updateUser), so
// it's only trusted when the account really signed in with Google, and only
// for an https URL on Google's own photo host.

export const PROVIDER_PHOTO_SIZE = 320;

interface ProviderUser {
  app_metadata?: { provider?: string; providers?: string[] } | null;
  user_metadata?: Record<string, unknown> | null;
}

function isGoogleAccount(user: ProviderUser): boolean {
  const meta = user.app_metadata;
  if (!meta) return false;
  return meta.provider === "google" || (Array.isArray(meta.providers) && meta.providers.includes("google"));
}

export function isGooglePhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /(^|\.)googleusercontent\.com$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

// Google photo URLs end in a size option such as "=s96-c" (96px, cropped).
// Ask for the size the avatar is stored at instead of upscaling a thumbnail.
export function sizedGooglePhotoUrl(url: string, size = PROVIDER_PHOTO_SIZE): string {
  if (/=s\d+(-c)?$/.test(url)) return url.replace(/=s\d+(-c)?$/, `=s${size}-c`);
  if (/=[^/=]*$/.test(url)) return url;
  return `${url}=s${size}-c`;
}

// The biggest version of a profile photo there is, for the fullscreen
// zoomable viewer (your own avatar). A Google photo can be asked for at any
// size; a GolfMe-stored avatar only exists at the size it was uploaded at.
export const FULLSCREEN_PHOTO_SIZE = 1024;

export function largestPhotoUrl(url: string): string {
  return isGooglePhotoUrl(url) ? sizedGooglePhotoUrl(url, FULLSCREEN_PHOTO_SIZE) : url;
}

export function providerPhotoUrl(user: ProviderUser | null | undefined): string | undefined {
  if (!user || !isGoogleAccount(user)) return undefined;
  const meta = user.user_metadata ?? {};
  const raw = [meta.avatar_url, meta.picture].find((v): v is string => typeof v === "string" && v.trim() !== "");
  if (!raw || !isGooglePhotoUrl(raw.trim())) return undefined;
  return sizedGooglePhotoUrl(raw.trim());
}
