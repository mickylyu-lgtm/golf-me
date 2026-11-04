import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { FoundingGolferReveal } from "./FoundingGolfer";

// The Founding Golfer reveal for a number that arrives OUTSIDE onboarding:
// a backfill, or an award the server made after Ready was already behind
// the golfer. Shown once per number, the next time the app is opened or
// comes back to the foreground. Ready marks its own reveal as seen with the
// same key, so a new signup never sees it twice.

const SEEN_KEY = (userId: string) => `golfme:foundingRevealSeen:${userId}`;
// Also kept on the account (auth user_metadata, which the user can write
// themselves), so signing in on another device doesn't show it again
// (Micky, 2026-11-04). localStorage stays as the instant, offline answer.
const SEEN_META = "golfme_founding_reveal_seen";
// An award older than this is treated as already seen (e.g. a cleared
// browser or a new phone), so nobody gets a "welcome" months later.
const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
// A golfer without a number re-reads their profile on resume at most this
// often, so a backfill shows up without a cold start.
const RESUME_REFRESH_MS = 10 * 60 * 1000;

export function markFoundingRevealSeen(userId: string, number: number) {
  try {
    window.localStorage.setItem(SEEN_KEY(userId), String(number));
  } catch {
    // Private mode: the account copy below still covers it.
  }
  // Best-effort: on failure only another device might show it once more.
  void supabase.auth
    .updateUser({ data: { [SEEN_META]: number } })
    .then(({ error }) => error && console.error("GolfMe: could not save the Founding reveal as seen.", error));
}

function revealSeen(userId: string, number: number, meta: Record<string, unknown> | undefined): boolean {
  if (meta?.[SEEN_META] === number) return true;
  try {
    return window.localStorage.getItem(SEEN_KEY(userId)) === String(number);
  } catch {
    return false;
  }
}

export function FoundingRevealHost() {
  const { isDemo, authUser, profile, refreshProfile } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const lastRefreshRef = useRef(0);
  const { pathname } = useLocation();
  // Onboarding has its own reveal on Ready, right after this save awards it.
  const onboarding = pathname.startsWith("/profile-setup") || pathname.startsWith("/ready");

  const userId = authUser?.id;
  const number = isDemo ? undefined : profile?.foundingMemberNumber;
  const awardedAt = profile?.foundingAwardedAt ? Date.parse(profile.foundingAwardedAt) : NaN;
  const fresh = Number.isFinite(awardedAt) ? Date.now() - awardedAt < FRESH_MS : true;
  const show = !dismissed && !onboarding && !!userId && number != null && fresh && !revealSeen(userId, number, authUser?.user_metadata);

  // Seen here before the account kept it: copy it up once, so other
  // devices know too.
  const seenMeta = authUser?.user_metadata?.[SEEN_META];
  useEffect(() => {
    if (isDemo || !userId || number == null || seenMeta === number) return;
    if (revealSeen(userId, number, undefined)) markFoundingRevealSeen(userId, number);
  }, [isDemo, userId, number, seenMeta]);

  useEffect(() => {
    if (isDemo || !userId || number != null) return;
    const maybeRefresh = () => {
      if (Date.now() - lastRefreshRef.current < RESUME_REFRESH_MS) return;
      lastRefreshRef.current = Date.now();
      void refreshProfile().catch(() => {});
    };
    lastRefreshRef.current = Date.now(); // the profile was just loaded at launch
    const onVisible = () => document.visibilityState === "visible" && maybeRefresh();
    document.addEventListener("visibilitychange", onVisible);
    const native = Capacitor.isNativePlatform()
      ? CapacitorApp.addListener("appStateChange", ({ isActive }) => isActive && maybeRefresh())
      : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void native?.then((l) => l.remove());
    };
  }, [isDemo, userId, number, refreshProfile]);

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[96] overflow-y-auto">
      <FoundingGolferReveal
        number={number}
        onContinue={() => {
          markFoundingRevealSeen(userId, number);
          setDismissed(true);
        }}
      />
    </div>
  );
}
