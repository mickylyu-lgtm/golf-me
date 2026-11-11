import type { GolferProfile } from "../types";
import { publicProfileRowToGolferProfile } from "./publicDirectory.ts";
import type { PublicProfileRow } from "./publicDirectory.ts";

export type ConnectionKind = "followers" | "following";
export interface FollowState {
  state: "none" | "pending" | "following";
  requestId: string | null;
  isPrivate: boolean;
  canViewConnections: boolean;
}
export interface FollowRequest { id: string; createdAt: string; golfer: GolferProfile }
export interface ConnectionSummary { total: number; mutualTotal: number }
export interface ProfileConnections extends ConnectionSummary { golfers: GolferProfile[]; mutualIds: string[] }
export interface SocialPrivacyApi {
  getConnectionPage: (id: string, kind: ConnectionKind, search: string, cursor: ConnectionCursor | null) => Promise<ConnectionPage>;
  getProfileConnections: (id: string, kind: ConnectionKind) => Promise<ProfileConnections>;
  getConnectionSummary: (id: string, kind: ConnectionKind) => Promise<ConnectionSummary>;
  getFollowState: (id: string) => Promise<FollowState>;
  removeFollower: (id: string) => Promise<void>;
  cancelFollowRequest: (id: string) => Promise<void>;
  getFollowRequests: () => Promise<FollowRequest[]>;
  respondToFollowRequest: (id: string, accept: boolean) => Promise<void>;
  setAccountPrivate: (value: boolean) => Promise<boolean>;
}
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Social data unavailable");
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) throw new Error("Unsupported social response");
  return raw;
}
function profile(value: unknown): GolferProfile {
  if (!value || typeof value !== "object") throw new Error("Invalid social profile");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id || typeof row.name !== "string" || !row.name.trim()) throw new Error("Invalid social profile");
  return publicProfileRowToGolferProfile(row as unknown as PublicProfileRow);
}
export function parseFollowState(value: unknown): FollowState {
  const raw = object(value);
  if (!["none", "pending", "following"].includes(String(raw.state)) || typeof raw.is_private !== "boolean" || typeof raw.can_view_connections !== "boolean"
      || !(raw.request_id === null || typeof raw.request_id === "string")
      || (raw.state === "pending" && !raw.request_id) || (raw.state !== "pending" && raw.request_id !== null)) throw new Error("Invalid follow state");
  return { state: raw.state as FollowState["state"], requestId: raw.request_id as string | null, isPrivate: raw.is_private, canViewConnections: raw.can_view_connections };
}
export function parseConnections(value: unknown, kind: ConnectionKind): ProfileConnections {
  const raw = object(value);
  if (raw.kind !== kind || !count(raw.total) || !count(raw.mutual_total) || !Array.isArray(raw.profiles) || raw.profiles.length > 100) throw new Error("Invalid connections response");
  const seen = new Set<string>();
  const mutualIds: string[] = [];
  const golfers = raw.profiles.map((value) => {
    const golfer = profile(value);
    if (seen.has(golfer.id) || typeof value.is_mutual !== "boolean") throw new Error("Invalid connection");
    seen.add(golfer.id);
    if (value.is_mutual) mutualIds.push(golfer.id);
    return golfer;
  });
  if (golfers.length > raw.total || (kind === "followers" && (raw.mutual_total > raw.total || mutualIds.length > raw.mutual_total))) throw new Error("Invalid connections total");
  return { total: raw.total, mutualTotal: raw.mutual_total, golfers, mutualIds };
}
export async function collectConnections(read: (offset: number) => Promise<ProfileConnections>): Promise<ProfileConnections> {
  const golfers: GolferProfile[] = [], mutualIds: string[] = [];
  const seen = new Set<string>();
  let summary: ConnectionSummary | undefined;
  for (let offset = 0; ; offset += 100) {
    const page = await read(offset);
    summary ??= page;
    if (page.total > 100000 || page.total !== summary.total || page.mutualTotal !== summary.mutualTotal) throw new Error("Connections changed. Please retry.");
    for (const golfer of page.golfers) {
      if (seen.has(golfer.id)) throw new Error("Connections changed. Please retry.");
      seen.add(golfer.id); golfers.push(golfer);
    }
    mutualIds.push(...page.mutualIds);
    if (golfers.length >= page.total || page.golfers.length < 100) {
      if (golfers.length !== summary.total) throw new Error("Connections changed. Please retry.");
      return { total: summary.total, mutualTotal: summary.mutualTotal, golfers, mutualIds };
    }
  }
}
export function parseFollowRequests(value: unknown): { total: number; requests: FollowRequest[] } {
  const raw = object(value);
  if (!count(raw.total) || !Array.isArray(raw.requests) || raw.requests.length > 100 || raw.requests.length > raw.total) throw new Error("Invalid follow requests");
  const seen = new Set<string>();
  const requests = raw.requests.map((row) => {
    if (typeof row.request_id !== "string" || !row.request_id || seen.has(row.request_id) || typeof row.created_at !== "string") throw new Error("Invalid follow request");
    seen.add(row.request_id);
    return { id: row.request_id, createdAt: row.created_at, golfer: profile(row.profile) };
  });
  return { total: raw.total, requests };
}
export function parsePrivacySetting(value: unknown): boolean {
  const raw = object(value);
  if (typeof raw.is_private !== "boolean") throw new Error("Invalid follow setting");
  return raw.is_private;
}
export function requireChangedResponse(value: unknown): void {
  if (typeof object(value).changed !== "boolean") throw new Error("Invalid social action response");
}
export function requireRequestResponse(value: unknown, accept: boolean): void {
  if (object(value).state !== (accept ? "accepted" : "rejected")) throw new Error("Invalid request response");
}


export type ConnectionCursor = Record<string, unknown>;
export interface ConnectionPage extends ProfileConnections { matchedTotal: number; nextCursor: ConnectionCursor | null }
export function parseConnectionPage(value: unknown, kind: ConnectionKind): ConnectionPage {
  if (!value || typeof value !== "object") throw new Error("Invalid connection page");
  const raw = value as Record<string, unknown>;
  if (raw.version !== 2 || !count(raw.matched_total) || !count(raw.total) || raw.matched_total > raw.total
      || !(raw.next_cursor === null || (typeof raw.next_cursor === "object" && !Array.isArray(raw.next_cursor)))) throw new Error("Invalid connection page");
  const parsed = parseConnections({ ...raw, version: 1 }, kind);
  if (parsed.golfers.length > raw.matched_total || (raw.next_cursor !== null && parsed.golfers.length === 0)) throw new Error("Invalid connection page");
  return { ...parsed, matchedTotal: raw.matched_total, nextCursor: raw.next_cursor as ConnectionCursor | null };
}
/** Never silently skip overlapping or nonadvancing pages after graph changes. */
export function appendConnectionPage(previous: ConnectionPage, next: ConnectionPage): ConnectionPage {
  const seen = new Set(previous.golfers.map(g => g.id));
  if (next.golfers.some(g => seen.has(g.id)) || (next.nextCursor && JSON.stringify(next.nextCursor) === JSON.stringify(previous.nextCursor))) throw new Error("Connections changed. Please retry.");
  return { ...next, golfers: [...previous.golfers, ...next.golfers], mutualIds: [...previous.mutualIds, ...next.mutualIds] };
}
