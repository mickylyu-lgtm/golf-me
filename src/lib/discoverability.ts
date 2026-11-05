// Settings -> Privacy -> "Discoverable" (profiles.discoverable, migration
// 20261106120000_add_public_golfer_directory, which supersedes the unapplied
// 20261104130000_add_profile_discoverable). Pure helpers, no React or
// Supabase imports, so tests/discoverability.test.ts can run them under
// node --test.
//
// What the switch controls: whether a golfer is OFFERED to people who don't
// know them yet (the Golfers tab, Find Golfers search, suggested golfers,
// and their name/photo on new-round alerts). It is not a private profile:
// golfer_public_profiles() still resolves them for people they share a
// round, chat, follow or post with. The server enforces the discovery side.

/**
 * The Settings switch for the signed-in golfer:
 * - "unavailable": no profile row yet, or the database has no column (the
 *   switch is not shown, so it can never claim to hide anyone);
 * - otherwise the saved value.
 */
export type DiscoverableSetting = "unavailable" | "on" | "off";

export function discoverableSetting(row: Record<string, unknown> | null | undefined): DiscoverableSetting {
  if (!row || !("discoverable" in row)) return "unavailable";
  return row.discoverable === false ? "off" : "on";
}

/**
 * The real-account Golfers list: the directory ids (already filtered by the
 * server), resolved against the profile cache (which also holds people this
 * account is connected to, hidden or not), minus self and anyone blocked
 * either way (the server already dropped blocks; this covers a block made
 * since the last directory fetch).
 */
export function discoverableCandidates<T>(
  directoryIds: readonly string[],
  profilesById: ReadonlyMap<string, T>,
  selfId: string | undefined,
  blockedEitherWay: ReadonlySet<string>,
): T[] {
  const out: T[] = [];
  for (const id of directoryIds) {
    if (id === selfId || blockedEitherWay.has(id)) continue;
    const profile = profilesById.get(id);
    if (profile !== undefined) out.push(profile);
  }
  return out;
}
