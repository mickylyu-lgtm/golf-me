import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { DataProvider, useData } from "./context/DataContext";
import { ToastProvider } from "./context/ToastContext";
import { LocaleProvider, useLocale } from "./i18n/LocaleContext";
import { AppShell } from "./components/layout/AppShell";
import { GolfMeLoader } from "./components/loading/GolfMeLoader";
import { Welcome } from "./pages/Welcome";
import { Onboarding } from "./pages/Onboarding";
import { Auth } from "./pages/Auth";
import { ProfileSetup } from "./pages/ProfileSetup";
import { Home } from "./pages/Home";
import { Discover } from "./pages/Discover";
import { Find } from "./pages/Find";
import { AutoMatch } from "./pages/AutoMatch";
import { GolfCalls } from "./pages/GolfCalls";
import { CreateGolfCall } from "./pages/CreateGolfCall";
import { GolfCallDetail } from "./pages/GolfCallDetail";
import { MyRounds } from "./pages/MyRounds";
import { Profile } from "./pages/Profile";
import { ReputationDetail } from "./pages/ReputationDetail";
import { GolfCircleDetail } from "./pages/GolfCircleDetail";
import { FollowingDetail } from "./pages/FollowingDetail";
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

// Logged-in area: sidebar/bottom nav shell + redirect back to the Welcome
// front page if the mock session isn't authenticated. Always the front
// page, never straight to /login — hasOnboarded only changes the copy on
// the login screen itself ("Welcome back" vs. "Log in"), it never skips
// the branded landing screen for a logged-out visitor.
function AuthedLayout() {
  const { session } = useData();
  if (!session.isLoggedIn) {
    return <Navigate to="/welcome" replace />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

// Welcome/onboarding/auth screens: no point revisiting these once signed in.
function GuestOnly() {
  const { session } = useData();
  if (session.isLoggedIn) return <Navigate to="/" replace />;
  return <Outlet />;
}

// Real gate, not a fixed timer — mock data loads synchronously from
// localStorage, so this normally resolves in a single tick, but it's the
// actual state DataProvider uses internally, not a manufactured delay.
function AppGate({ children }: { children: ReactNode }) {
  const { isLoading } = useData();
  const { t } = useLocale();
  if (isLoading) return <GolfMeLoader fullScreen message={t("loading.gettingReady")} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <LocaleProvider>
      <DataProvider>
        <ToastProvider>
          <AppGate>
            <BrowserRouter>
              <Routes>
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
                </Route>
              </Routes>
            </BrowserRouter>
          </AppGate>
        </ToastProvider>
      </DataProvider>
    </LocaleProvider>
  );
}
