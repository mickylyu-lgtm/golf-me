export interface AdminUserRow {
  id: string;
  name: string | null;
  username: string | null;
  email: string;
  photo_url: string | null;
  avatar_color: string | null;
  avatar_initials: string | null;
  has_onboarded: boolean;
  verified_golfer: boolean;
  is_admin: boolean;
  is_coach_reviewer: boolean;
  member_since: string;
}

/** Search only the roster already returned by the admin-gated RPC.
 * No query, roster, or email address is persisted or sent to another service.
 */
export function filterRegisteredUsers<T extends Pick<AdminUserRow, "name" | "username" | "email">>(
  users: readonly T[],
  query: string,
): readonly T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return users;
  return users.filter((user) => {
    const fields = [user.name ?? "", user.username ? "@" + user.username : "", user.email ?? ""]
      .map((value) => value.toLowerCase());
    return terms.every((term) => fields.some((field) => field.includes(term)));
  });
}
