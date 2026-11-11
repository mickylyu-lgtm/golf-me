import type { ReactNode } from "react";
import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Users, X } from "lucide-react";
import { filterRegisteredUsers } from "../../lib/adminUsers";
import type { AdminUserRow } from "../../lib/adminUsers";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";

const PAGE_SIZE = 100;

// Rendered only inside the admin-gated dashboard. The existing server RPC
// remains the authority for roster/email access; this component only filters
// its loaded response in memory.
export function RegisteredUsersSection({ users, loading, error }: {
  users: readonly AdminUserRow[];
  loading: boolean;
  error: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const bodyId = id + "-users";
  const headingId = id + "-heading";
  const countId = id + "-count";
  const filteredUsers = useMemo(() => filterRegisteredUsers(users, query), [users, query]);
  const hasQuery = query.trim().length > 0;
  const onboardedCount = users.filter((user) => user.has_onboarded).length;
  const initialLoading = loading && users.length === 0;

  function updateQuery(value: string) {
    setQuery(value);
    setVisibleCount(PAGE_SIZE);
    setExpanded(true);
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id={headingId} className="min-w-0">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((value) => !value)}
            className="flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-bold text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fairway-600"
          >
            <Users size={15} aria-hidden="true" className="text-fairway-600" />
            Registered Users
            <ChevronDown size={16} aria-hidden="true" className={expanded ? "rotate-180" : ""} />
          </button>
        </h2>
        <div className="relative min-w-0 basis-full sm:ml-auto sm:basis-72">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="search"
            aria-label="Search registered users by name, username, or email"
            aria-controls={bodyId}
            aria-describedby={countId}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="Search name or email"
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-11 text-sm text-slate-800 outline-none focus:border-fairway-500 focus:ring-2 focus:ring-fairway-100 [&::-webkit-search-cancel-button]:hidden"
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label="Clear user search"
              onClick={() => { updateQuery(""); inputRef.current?.focus(); }}
              className="absolute right-0 top-0 flex h-full w-11 items-center justify-center rounded-r-xl text-slate-500 focus-visible:outline-2 focus-visible:outline-fairway-600"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <p id={countId} role="status" className="text-xs text-slate-500">
        {error ? "Unavailable" : initialLoading ? "Loading users..." : hasQuery
          ? filteredUsers.length + " matching " + (filteredUsers.length === 1 ? "account" : "accounts") + " of " + users.length + " loaded"
          : users.length + " accounts · " + onboardedCount + " onboarded"}
      </p>
      {error}
      <div id={bodyId} hidden={!expanded}>
        {!error && (initialLoading ? (
          <p className="text-xs text-slate-400">Loading...</p>
        ) : users.length === 0 ? (
          <EmptyState icon={<Users size={20} />} title="No registered users yet." />
        ) : filteredUsers.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title="No matching users." description="Try a different name, username, or email." />
        ) : (
          <div className="flex flex-col gap-2">
            {filteredUsers.slice(0, visibleCount).map((user) => (
              <div key={user.id} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                <Avatar
                  golfer={{
                    avatarColor: user.avatar_color ?? "from-fairway-500 to-fairway-700",
                    avatarInitials: user.avatar_initials ?? "?",
                    photoUrl: user.photo_url ?? undefined,
                    verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: user.verified_golfer },
                  }}
                  size="sm"
                  showVerified={user.verified_golfer}
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-slate-800">{user.name ?? "Unnamed"}</p>
                  <p className="select-text break-all text-xs text-slate-600">{user.email}</p>
                  <p className="break-words text-xs text-slate-500">
                    {user.username && <>@{user.username} · </>}
                    joined {new Date(user.member_since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                  {(!user.has_onboarded || user.is_admin || user.is_coach_reviewer) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {!user.has_onboarded && <Badge tone="outline">mid-onboarding</Badge>}
                      {user.is_admin && <Badge tone="fairway">admin</Badge>}
                      {user.is_coach_reviewer && <Badge tone="sky">reviewer</Badge>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {filteredUsers.length > visibleCount && (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                className="min-h-11 self-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600"
              >
                Show {Math.min(PAGE_SIZE, filteredUsers.length - visibleCount)} more
              </button>
            )}
          </div>
        ))}
      </div>
      {!error && users.length >= 1000 && (
        <p className="text-xs text-slate-400">Search covers the latest 1,000 loaded accounts.</p>
      )}
    </section>
  );
}
