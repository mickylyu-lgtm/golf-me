// Network side of lib/publicDirectory: every read of OTHER golfers' profiles
// goes through here. With migration 20261106120000 applied, both calls use
// the server RPCs (narrow columns, no coordinates, rules enforced in the
// database). Before it is applied (missing-function error only), they fall
// back to the old table reads, so the client can ship first. Once
// 20261106120100 makes the table own-row only, the fallback is never taken
// (the RPCs exist by then; it refuses to apply otherwise).
//
// Both resolve with { profiles, error } instead of rejecting, like a
// Supabase query, so callers keep their existing error handling.
import { supabase } from "./supabase";
import { profileRowToGolferProfile } from "./profile";
import type { ProfileRow } from "./profile";
import type { GolferProfile } from "../types";
import {
  DIRECTORY_MAX,
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_RPC,
  PUBLIC_PROFILES_CHUNK,
  PUBLIC_PROFILES_RPC,
  RpcAvailability,
  chunk,
  isListableFallbackRow,
  isMissingFunctionError,
  publicProfileRowToGolferProfile,
} from "./publicDirectory";
import type { PublicProfileRow } from "./publicDirectory";

export interface ProfilesResult {
  profiles: GolferProfile[];
  error: unknown;
}

const availability = new RpcAvailability();

/** The Golfers list (never includes the caller). */
export async function fetchGolferDirectory(selfId: string | undefined): Promise<ProfilesResult> {
  if (availability.shouldTry(DIRECTORY_RPC, Date.now())) {
    const profiles: GolferProfile[] = [];
    let missing = false;
    for (let offset = 0; offset < DIRECTORY_MAX; offset += DIRECTORY_PAGE_SIZE) {
      const { data, error } = await supabase.rpc(DIRECTORY_RPC, { p_limit: DIRECTORY_PAGE_SIZE, p_offset: offset });
      if (error) {
        if (offset === 0 && isMissingFunctionError(error, DIRECTORY_RPC)) {
          missing = true;
          break;
        }
        return { profiles: [], error };
      }
      const rows = (data ?? []) as PublicProfileRow[];
      for (const row of rows) profiles.push(publicProfileRowToGolferProfile(row));
      if (rows.length < DIRECTORY_PAGE_SIZE) break;
    }
    if (!missing) {
      availability.markPresent(DIRECTORY_RPC);
      return { profiles, error: null };
    }
    availability.markMissing(DIRECTORY_RPC, Date.now());
  }
  // Older database: the previous full-table read, with the same
  // completeness/Discoverable rules applied here.
  const { data, error } = await supabase.from("profiles").select("*");
  if (error) return { profiles: [], error };
  const rows = (data ?? []) as (ProfileRow & { discoverable?: boolean })[];
  return { profiles: rows.filter((row) => isListableFallbackRow(row, selfId)).map(profileRowToGolferProfile), error: null };
}

/**
 * Profiles for ids this account already has a reason to show (DM partners,
 * round rosters, follows, notification actors, post/comment authors, coach
 * reviewers). With the RPC, anyone blocked either way is simply absent.
 */
export async function fetchPublicProfiles(ids: readonly string[]): Promise<ProfilesResult> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { profiles: [], error: null };
  if (availability.shouldTry(PUBLIC_PROFILES_RPC, Date.now())) {
    const profiles: GolferProfile[] = [];
    let missing = false;
    for (const part of chunk(unique, PUBLIC_PROFILES_CHUNK)) {
      const { data, error } = await supabase.rpc(PUBLIC_PROFILES_RPC, { p_ids: part });
      if (error) {
        if (isMissingFunctionError(error, PUBLIC_PROFILES_RPC)) {
          missing = true;
          break;
        }
        return { profiles: [], error };
      }
      for (const row of (data ?? []) as PublicProfileRow[]) profiles.push(publicProfileRowToGolferProfile(row));
    }
    if (!missing) {
      availability.markPresent(PUBLIC_PROFILES_RPC);
      return { profiles, error: null };
    }
    availability.markMissing(PUBLIC_PROFILES_RPC, Date.now());
  }
  const profiles: GolferProfile[] = [];
  for (const part of chunk(unique, PUBLIC_PROFILES_CHUNK)) {
    const { data, error } = await supabase.from("profiles").select("*").in("id", part);
    if (error) return { profiles: [], error };
    for (const row of (data ?? []) as ProfileRow[]) profiles.push(profileRowToGolferProfile(row));
  }
  return { profiles, error: null };
}
