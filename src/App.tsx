import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { DataProvider, useData } from "./context/DataContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { RealRoundsProvider } from "./context/RealRoundsContext";
import { RealSocialProvider } from "./context/RealSocialContext";
import { RealCommunityProvider } from "./context/RealCommunityContext";
import { RealCaddieProvider } from "./context/RealCaddieContext";
import { ToastProvider } from "./context/ToastContext";
import { LocaleProvider, useLocale, LOCALES } from "./i18n/LocaleContext";
import type { Locale } from "./i18n/LocaleContext";
import { AppShell } from "./components/layout/AppShell";
import { ScrollToTop } from "./components/layout/ScrollToTop";
import { GolfMeLoader } from "./components/loading/GolfMeLoader";
import { Welcome } from "./pages/Welcome";
import { Onboarding } from "./pages/Onboarding";
import { Auth } from "./pages/Auth";
import { ProfileSetup } from "./pages/ProfileSetup";
import { Ready } from "./pages/Ready";
import { Home } from "./pages/Home";
import { Discover } from "./pages/Discover";
import { Find } from "./pages/Find";
import { TeeTimes } from "./pages/TeeTimes";
import { TeeTimeCourseDetail } from "./pages/TeeTimeCourseDetail";
import { Caddie } from "./pages/Caddie";
import { AnalyzeSwing } from "./pages/AnalyzeSwing";
import { CaddieAnalysisDetail } from "./pages/CaddieAnalysisDetail";
import { AutoMatch } from "./pages/AutoMatch";
import { GolfCalls } from "./pages/GolfCalls";
import { CreateGolfCall } from "./pages/CreateGolfCall";
import { GolfCallDetail } from "./pages/GolfCallDetail";
import { MyRounds } from "./pages/MyRounds";
import { Profile } from "./pages/Profile";
import { ReputationDetail } from "./pages/ReputationDetail";
import { GolfCircleDetail } from "./pages/GolfCircleDetail";
import { FollowingDetail } from "./pages/FollowingDetail";
import { FindFriends } from "./pages/FindFriends";
import { MyPosts } from "./pages/MyPosts";
import { MatchPreferencesDetail } from "./pages/MatchPreferencesDetail";
import { Settings } from "./pages/Settings";
import { LanguageSettings } from "./pages/LanguageSettings";
import { HelpCenter } from "./pages/HelpCenter";
import { About } from "./pages/About";
import { GolferProfilePage } from "./pages/GolferProfilePage";
import { Inbox } from "./pages/Inbox";
import { DirectMessageThread } from "./pages/DirectMessageThread";
import { Community } from "./pages/Community";
import { CreatePost } from "./pages/CreatePost";
import { PostDetail } from "./pages/PostDetail";
import { CommunityGuidelines } from "./pages/CommunityGuidelines";
import { SavedPosts } from "./pages/SavedPosts";
import { AdminReviewers } from "./pages/AdminReviewers";
import { AdminDashboard } from "./pages/AdminDashboard";
import { CoachInvite } from "./pages/CoachInvite";
import { usePendingReviewerInviteRedemption } from "./lib/usePendingReviewerInviteRedemption";

// Logged-in area: sidebar/bottom nav shell. Three real states, not two —
// no session -> Welcome; session but onboarding incomplete (real accounts
// only reach this mid-signup) -> back to /profile-setup rather than Home;
// session + onboarded -> the app.
function AuthedLayout() {
  const { session } = useData();
  if (!session.isLoggedIn) {
    return <Navigate to="/welcome" replace />;
  }
  if (!session.hasOnboarded) {
    return <Navigate to="/profile-setup" replace />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

// Welcome/onboarding/auth screens: no point revisiting these once signed in
// AND onboarded. A real account that's authenticated but hasn't finished
// onboarding is neither "guest" nor "authed" — it's forced to
// /profile-setup specifically (not bounced to "/", which AuthedLayout would
// just bounce right back out of) rather than allowed to sit on Welcome/Login.
function GuestOnly() {
  const { session } = useData();
  const location = useLocation();
  if (session.isLoggedIn && session.hasOnboarded) return <Navigate to="/" replace />;
  if (session.isLoggedIn && !session.hasOnboarded && location.pathname !== "/profile-setup") {
    return <Navigate to="/profile-setup" replace />;
  }
  return <Outlet />;
}

const KNOWN_LOCALES = new Set(LOCALES.map((l) => l.value));

// Two-way, best-effort sync between the device-local language setting and a
// real account's profiles.language — demo accounts never touch this. Pull
// once per login (new device picks up a previously-saved language); push on
// every explicit change after that (so it follows the account forward).
// Fire-and-forget by design — a save that fails here just means the device
// keeps its own local choice, never a blocking or user-visible error.
function useLanguageProfileSync() {
  const { locale, setLocale } = useLocale();
  const { isDemo, authUser, profileLanguage, saveProfile } = useAuth();
  const pulledForUser = useRef<string | null>(null);

  useEffect(() => {
    if (isDemo || !authUser) return;
    if (pulledForUser.current === authUser.id) return;
    pulledForUser.current = authUser.id;
    if (profileLanguage && KNOWN_LOCALES.has(profileLanguage as Locale) && profileLanguage !== locale) {
      setLocale(profileLanguage as Locale);
    }
    // Only depends on authUser/profileLanguage becoming available — locale/
    // setLocale intentionally excluded so this never re-fires on later
    // local changes (that's the push effect below's job).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, profileLanguage]);

  useEffect(() => {
    if (isDemo || !authUser) return;
    if (pulledForUser.current !== authUser.id) return; // wait for the pull above to settle first
    saveProfile({ language: locale }).catch((err) => console.error("Golf Me: failed to save language preference.", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, isDemo, authUser]);
}

// Real gate, not a fixed timer — mock data loads synchronously from
// localStorage (near-instant), but real session restore is a network round
// trip (getSession + the initial profiles fetch); both block here so the
// app never flickers Welcome->Home while either resolves.
function AppGate({ children }: { children: ReactNode }) {
  const { isLoading } = useData();
  const { authLoading } = useAuth();
  const { t } = useLocale();
  useLanguageProfileSync();
  // Fires as soon as a real auth session exists, even mid-onboarding (a
  // Coach Reviewer invite isn't gated on has_onboarded) — see the hook's
  // own comment for why this can't wait for AuthedLayout to mount.
  usePendingReviewerInviteRedemption();
  if (isLoading || authLoading) return <GolfMeLoader fullScreen message={t("loading.gettingReady")} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <RealRoundsProvider>
        <RealSocialProvider>
        <RealCommunityProvider>
        <RealCaddieProvider>
        <DataProvider>
          <ToastProvider>
            <AppGate>
              <BrowserRouter>
              <ScrollToTop />
              <Routes>
                {/* Standalone, outside both GuestOnly and AuthedLayout — by the
                    time signUpNewGolfer() lands here the session is already
                    authenticated (GuestOnly would bounce it straight to "/"),
                    but it deliberately skips AppShell's nav chrome, same as
                    the rest of the pre-Home first-run flow. */}
                <Route path="/ready" element={<Ready />} />
                {/* Standalone for the same reason as /ready — must work
                    whether the visitor is logged out, mid-onboarding, or
                    fully set up, so it can't sit inside either GuestOnly
                    (would bounce an already-authed visitor away) or
                    AuthedLayout (would bounce a logged-out one to /welcome
                    before the token is ever captured). */}
                <Route path="/coach-invite/:token" element={<CoachInvite />} />
                <Route element={<GuestOnly />}>
                  <Route path="/welcome" element={<Welcome />} />
                  <Route path="/onboarding" element={<Onboarding />} />
                  <Route path="/login" element={<Auth mode="login" />} />
                  <Route path="/signup" element={<Auth mode="signup" />} />
                  <Route path="/profile-setup" element={<ProfileSetup />} />
                </Route>

                <Route element={<AuthedLayout />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/discover" element={<Discover />} />
                  <Route path="/find" element={<Find />} />
                  <Route path="/auto-match" element={<AutoMatch />} />
                  <Route path="/golf-calls" element={<GolfCalls />} />
                  <Route path="/golf-calls/new" element={<CreateGolfCall />} />
                  <Route path="/golf-calls/:id" element={<GolfCallDetail />} />
                  <Route path="/my-rounds" element={<MyRounds />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/profile/reputation" element={<ReputationDetail />} />
                  <Route path="/profile/circle" element={<GolfCircleDetail />} />
                  <Route path="/profile/following" element={<FollowingDetail />} />
                  <Route path="/profile/following/find" element={<FindFriends />} />
                  <Route path="/profile/posts" element={<MyPosts />} />
                  <Route path="/profile/preferences" element={<MatchPreferencesDetail />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/settings/language" element={<LanguageSettings />} />
                  <Route path="/help" element={<HelpCenter />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/golfer/:id" element={<GolferProfilePage />} />
                  <Route path="/messages" element={<Inbox />} />
                  <Route path="/messages/:id" element={<DirectMessageThread />} />
                  <Route path="/community" element={<Community />} />
                  <Route path="/community/new" element={<CreatePost />} />
                  <Route path="/community/guidelines" element={<CommunityGuidelines />} />
                  <Route path="/community/:id" element={<PostDetail />} />
                  <Route path="/saved-posts" element={<SavedPosts />} />
                  {/* Not linked from any nav — reachable only by a direct
                      hit, and gated on the caller's own admin role inside
                      the page itself (re-verified server-side by every RPC
                      it calls). */}
                  <Route path="/admin/coach-reviewers" element={<AdminReviewers />} />
                  <Route path="/admin/dashboard" element={<AdminDashboard />} />
                  <Route path="/tee-times" element={<TeeTimes />} />
                  <Route path="/tee-times/:courseId" element={<TeeTimeCourseDetail />} />
                  <Route path="/caddie" element={<Caddie />} />
                  <Route path="/caddie/analyze" element={<AnalyzeSwing />} />
                  <Route path="/caddie/:analysisId" element={<CaddieAnalysisDetail />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AppGate>
        </ToastProvider>
      </DataProvider>
        </RealCaddieProvider>
        </RealCommunityProvider>
        </RealSocialProvider>
        </RealRoundsProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
