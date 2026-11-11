import type { AppData } from "../types";
import type { ConnectionKind, FollowState, ProfileConnections, FollowRequest } from "./socialPrivacy.ts";

export function demoBlocked(data: AppData, a: string, b: string): boolean {
  return data.blocks.some((block) => (block.blockerId === a && block.blockedId === b) || (block.blockerId === b && block.blockedId === a));
}
export function demoFollowState(data: AppData, viewer: string, owner: string): FollowState {
  if (demoBlocked(data, viewer, owner) || !data.golfers.some((g) => g.id === owner)) throw new Error("Follow unavailable");
  const following = data.follows.some((f) => f.followerId === viewer && f.followingId === owner);
  const request = data.followRequests?.find((r) => r.followerId === viewer && r.followingId === owner);
  return { state: following ? "following" : request ? "pending" : "none", requestId: following ? null : request?.id ?? null, isPrivate: data.privateFollowProfiles?.[owner] ?? false, canViewConnections: viewer === owner || following };
}
export function demoConnections(data: AppData, viewer: string, owner: string, kind: ConnectionKind): ProfileConnections {
  if (!demoFollowState(data, viewer, owner).canViewConnections) throw new Error("Follow to view connections");
  const eligible = (id: string) => !demoBlocked(data, viewer, id) && !demoBlocked(data, owner, id);
  const viewerFollows = new Set(data.follows.filter((f) => f.followerId === viewer).map((f) => f.followingId));
  const followers = new Set(data.follows.filter((f) => f.followingId === owner && eligible(f.followerId)).map((f) => f.followerId));
  const ids = kind === "followers" ? followers : new Set(data.follows.filter((f) => f.followerId === owner && eligible(f.followingId)).map((f) => f.followingId));
  const golfers = data.golfers.filter((g) => ids.has(g.id));
  return { total: golfers.length, mutualTotal: data.golfers.filter((g) => followers.has(g.id) && viewerFollows.has(g.id)).length, golfers, mutualIds: golfers.filter((g) => viewerFollows.has(g.id)).map((g) => g.id) };
}
export function demoIncomingRequests(data: AppData, owner: string): FollowRequest[] {
  return (data.followRequests ?? []).filter((r) => r.followingId === owner && !demoBlocked(data, owner, r.followerId)).flatMap((r) => {
    const golfer = data.golfers.find((g) => g.id === r.followerId);
    return golfer ? [{ id: r.id, createdAt: r.createdAt, golfer }] : [];
  });
}
