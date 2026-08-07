import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DataProvider } from "./context/DataContext";
import { ToastProvider } from "./context/ToastContext";
import { AppShell } from "./components/layout/AppShell";
import { Home } from "./pages/Home";
import { Discover } from "./pages/Discover";
import { Find } from "./pages/Find";
import { GolfCalls } from "./pages/GolfCalls";
import { CreateGolfCall } from "./pages/CreateGolfCall";
import { GolfCallDetail } from "./pages/GolfCallDetail";
import { MyRounds } from "./pages/MyRounds";
import { Profile } from "./pages/Profile";
import { GolferProfilePage } from "./pages/GolferProfilePage";

export default function App() {
  return (
    <DataProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppShell>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/discover" element={<Discover />} />
              <Route path="/find" element={<Find />} />
              <Route path="/golf-calls" element={<GolfCalls />} />
              <Route path="/golf-calls/new" element={<CreateGolfCall />} />
              <Route path="/golf-calls/:id" element={<GolfCallDetail />} />
              <Route path="/my-rounds" element={<MyRounds />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/golfer/:id" element={<GolferProfilePage />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </ToastProvider>
    </DataProvider>
  );
}
