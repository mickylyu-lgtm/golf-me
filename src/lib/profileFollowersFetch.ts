import { supabase } from "./supabase";
import { collectVisibleFollowers, parseFollowerPage } from "./profileFollowers";
import type { ProfileFollowers } from "./profileFollowers";

const FOLLOWERS_RPC = "golfer_profile_followers";

async function readPage(profileId: string, limit: number, offset: number) {
  const { data, error } = await supabase.rpc(FOLLOWERS_RPC, {
    p_profile_id: profileId, p_limit: limit, p_offset: offset,
  });
  // Fail closed, including a database which has not applied the endpoint.
  // Never fall back to broad follows/table/public-profile reads.
  if (error) throw error;
  return parseFollowerPage(data);
}

export async function fetchFollowerCount(profileId: string): Promise<number> {
  return (await readPage(profileId, 0, 0)).total;
}

export async function fetchProfileFollowers(profileId: string): Promise<ProfileFollowers> {
  return collectVisibleFollowers((offset, size) => readPage(profileId, size, offset));
}
