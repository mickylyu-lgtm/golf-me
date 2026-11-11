import { supabase } from "./supabase";
import { fetchPublicProfiles } from "./publicProfilesFetch";
import { collectFollowerIds } from "./profileFollowers";
import type { ProfileFollowers } from "./profileFollowers";

export async function fetchFollowerCount(profileId: string): Promise<number> {
  const { count, error } = await supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", profileId);
  if (error) throw error;
  if (count === null) throw new Error("Follower count unavailable");
  return count;
}

export async function fetchProfileFollowers(profileId: string, viewerId: string): Promise<ProfileFollowers> {
  const followersPromise = collectFollowerIds(async (offset, size) => {
    const { data, error } = await supabase.from("follows").select("follower_id")
      .eq("following_id", profileId).order("follower_id").range(offset, offset + size - 1);
    if (error) throw error;
    return (data ?? []).map((row) => row.follower_id as string);
  });
  const followingPromise = collectFollowerIds(async (offset, size) => {
    const { data, error } = await supabase.from("follows").select("following_id")
      .eq("follower_id", viewerId).order("following_id").range(offset, offset + size - 1);
    if (error) throw error;
    return (data ?? []).map((row) => row.following_id as string);
  });
  // Page the viewer's follows too: mutuals must not inherit a capped
  // context query once someone follows more than the API's row limit.
  const [ids, following] = await Promise.all([followersPromise, followingPromise]);
  const followed = new Set(following);
  // Reuse the existing narrow profile RPC, including its two-way block
  // filtering. No new table access, grants or private-account assumptions.
  const { profiles, error } = await fetchPublicProfiles(ids);
  if (error) throw error;
  const byId = new Map(profiles.map((g) => [g.id, g]));
  return { total: ids.length, mutualIds: ids.filter((id) => followed.has(id)), golfers: ids.map((id) => byId.get(id)).filter((g): g is NonNullable<typeof g> => Boolean(g)) };
}
