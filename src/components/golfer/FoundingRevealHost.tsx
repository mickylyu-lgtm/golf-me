import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "../../context/AuthContext";
import { FoundingGolferReveal } from "./FoundingGolfer";

// The Founding Golfer reveal for a number that arrives OUTSIDE onboarding:
// a backfill, or an award the server made after Ready was already behind
// the golfer. Shown once per number, the next time the app is opened or
// comes back to the foreground. Ready marks its own reveal as seen with the
// same key, so a new signup never sees it twice.

const SEEN_KEY = (userId: string) => `golfme:foundingRevealSeen:${userId}`;
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
    // Private mode: worst case the reveal shows once more.
  }
}

function revealSeen(userId: string, number: number): boolean {
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
  const show = !dismissed && !onboarding && !!userId && number != null && fresh && !revealSeen(userId, number);

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
