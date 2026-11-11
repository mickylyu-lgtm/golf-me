// Synthetic local UI fixture. No app auth, database, or real accounts.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RegisteredUsersSection } from "../../src/components/admin/RegisteredUsersSection";
import type { AdminUserRow } from "../../src/lib/adminUsers";
import { LocaleProvider } from "../../src/i18n/LocaleContext";
import "../../src/index.css";

function makeUsers(count: number): AdminUserRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    name: index === 229 ? "Avery Lastgolfer" : "Golfer " + index,
    username: index === 229 ? "avery_last" : "golfer" + index,
    email: index === 229
      ? "avery.lastgolfer+extremely-long-registered-address@example.test"
      : "golfer" + index + "@example.test",
    photo_url: null,
    avatar_color: null,
    avatar_initials: "QA",
    has_onboarded: index !== 229,
    verified_golfer: false,
    is_admin: index === 0,
    is_coach_reviewer: index === 229,
    member_since: "2026-11-11T00:00:00Z",
  }));
}

declare global {
  interface Window {
    adminUsersQA: {
      setRows: (count: number) => void;
      setLoading: (loading: boolean) => void;
      setError: (error: boolean) => void;
      retries: number;
    };
  }
}

export function Harness() {
  const [users, setUsers] = useState(() => makeUsers(230));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retries, setRetries] = useState(0);
  window.adminUsersQA = {
    setRows: (count) => setUsers(makeUsers(count)),
    setLoading,
    setError,
    retries,
  };
  return (
    <LocaleProvider>
      <main className="mx-auto max-w-5xl p-4">
        <RegisteredUsersSection users={users} loading={loading} error={error ? (
          <div role="alert">
            Could not load users. <button onClick={() => { setError(false); setRetries((value) => value + 1); }}>Retry</button>
          </div>
        ) : null} />
        <h2 className="mt-8">Caddie Usage (all accounts)</h2>
      </main>
    </LocaleProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
