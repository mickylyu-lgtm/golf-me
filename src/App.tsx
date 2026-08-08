import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { DataProvider, useData } from "./context/DataContext";
import { ToastProvider } from "./context/ToastContext";
import { AppShell } from "./components/layout/AppShell";
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
import { Settings } from "./pages/Settings";
import { GolferProfilePage } from "./pages/GolferProfilePage";

// Logged-in area: sidebar/bottom nav shell + redirect back to Welcome/Login
// if the mock session isn't authenticated.
function AuthedLayout() {
  const { session } = useData();
  if (!session.isLoggedIn) {
    return <Navigate to={session.hasOnboarded ? "/login" : "/welcome"} replace />;
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

export default function App() {
  return (
    <DataProvider>
      <ToastProvider>
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
              <Route path="/settings" element={<Settings />} />
              <Route path="/golfer/:id" element={<GolferProfilePage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </DataProvider>
  );
}
