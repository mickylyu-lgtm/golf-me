import { supabase } from "./supabase";
import { parseConnectionPage, collectConnections, parseConnections, parseFollowRequests, parseFollowState, parsePrivacySetting, requireChangedResponse, requireRequestResponse } from "./socialPrivacy";
import type { ConnectionCursor, ConnectionKind, FollowRequest } from "./socialPrivacy";

async function rpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function fetchConnections(id: string, kind: ConnectionKind, countOnly = false) {
  const read = async (offset: number) => parseConnections(await rpc("golfer_profile_connections", {
    p_profile_id: id, p_kind: kind, p_limit: countOnly ? 0 : 100, p_offset: offset,
  }), kind);
  const result = countOnly ? await read(0) : await collectConnections(read);
  if (!countOnly && kind === "followers" && result.mutualIds.length !== result.mutualTotal) throw new Error("Connections changed. Please retry.");
  return result;
}
export const fetchFollowState = async (id: string) => parseFollowState(await rpc("golfer_follow_state", { p_profile_id: id }));
export async function sendFollow(id: string) {
  const state = parseFollowState(await rpc("follow_golfer", { p_profile_id: id }));
  if (state.state === "none") throw new Error("Follow was not saved");
  return state;
}
export const sendUnfollow = async (id: string) => requireChangedResponse(await rpc("unfollow_golfer", { p_profile_id: id }));
export const sendRemoveFollower = async (id: string) => requireChangedResponse(await rpc("remove_follower", { p_follower_id: id }));
export const sendCancelRequest = async (id: string) => requireChangedResponse(await rpc("cancel_follow_request", { p_request_id: id }));
export const sendRespondRequest = async (id: string, accept: boolean) => requireRequestResponse(await rpc("respond_to_follow_request", { p_request_id: id, p_accept: accept }), accept);
export const sendPrivacySetting = async (value: boolean) => parsePrivacySetting(await rpc("set_account_private", { p_is_private: value }));
export async function fetchFollowRequests(): Promise<FollowRequest[]> {
  const requests: FollowRequest[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (let offset = 0; ; offset += 100) {
    const page = parseFollowRequests(await rpc("my_follow_requests", { p_limit: 100, p_offset: offset }));
    total ??= page.total;
    if (page.total !== total || total > 100000) throw new Error("Follow requests changed");
    for (const request of page.requests) {
      if (seen.has(request.id)) throw new Error("Follow requests changed");
      seen.add(request.id); requests.push(request);
    }
    if (requests.length >= total || page.requests.length < 100) {
      if (requests.length !== total) throw new Error("Follow requests changed");
      return requests;
    }
  }
}

export async function fetchConnectionPage(id: string, kind: ConnectionKind, search: string, cursor: ConnectionCursor | null) {
  return parseConnectionPage(await rpc("golfer_profile_connections_page", { p_profile_id: id, p_kind: kind, p_limit: 30, p_search: search, p_cursor: cursor }), kind);
}
