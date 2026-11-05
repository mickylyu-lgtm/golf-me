// The bell's pure rules: which notifications are new vs "Earlier", which
// ones a screen clears just by being open, and whose face (if anyone's) a
// notification shows. No React or Supabase imports, so
// tests/notificationInbox.test.ts runs it under plain node.

export interface InboxNotification {
  id: string;
  type: string;
  actorId?: string;
  linkTo: string;
  read: boolean;
  createdAt: string;
}

// Read rows kept in the collapsed "Earlier" section. The fetch window is
// 200 rows; older read history is not worth scrolling through in a sheet.
export const EARLIER_LIMIT = 50;

function newestFirst<T extends InboxNotification>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Unread rows make the main list; read rows go to "Earlier" (newest first,
 * at most `earlierLimit`; the collapsed header counts what it would show).
 */
export function groupNotifications<T extends InboxNotification>(
  list: readonly T[],
  earlierLimit: number = EARLIER_LIMIT,
): { unread: T[]; earlier: T[] } {
  const sorted = newestFirst(list);
  const unread = sorted.filter((n) => !n.read);
  const earlier = sorted.filter((n) => n.read).slice(0, Math.max(0, earlierLimit));
  return { unread, earlier };
}

/** "/golf-calls/abc?x=1#y" -> "/golf-calls/abc" (no trailing slash). */
export function linkPath(link: string): string {
  const cut = link.split(/[?#]/, 1)[0] ?? "";
  const trimmed = cut.length > 1 ? cut.replace(/\/+$/, "") : cut;
  return trimmed || "/";
}

// Second segments that are a screen of their own, not an id.
const NON_ID_SEGMENTS: Record<string, ReadonlySet<string>> = {
  "golf-calls": new Set(["new"]),
  caddie: new Set(["analyze"]),
  community: new Set(["new", "guidelines"]),
  messages: new Set(["round"]),
};

/**
 * The link paths a screen counts as "opened": the screen's own path, plus
 * the round itself for a round's chat (and the chat for the round). Only
 * detail screens (an id in the path) clear anything; a tab like
 * /community or /messages never does.
 */
export function pathsOpenedByRoute(pathname: string): string[] {
  const path = linkPath(pathname);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "messages" && parts[1] === "round") {
    return [path, `/golf-calls/${parts[2]}`];
  }
  if (parts.length !== 2) return [];
  const [section, id] = parts;
  if (NON_ID_SEGMENTS[section]?.has(id)) return [];
  if (section === "golf-calls") return [path, `/messages/round/${id}`];
  return [path];
}

/**
 * Ids of the UNREAD notifications that being on `pathname` makes stale:
 * every notification whose link opens this screen, and for a DM thread
 * (/messages/<golferId>) every message notification from that golfer,
 * whatever its link says.
 */
export function notificationIdsClearedByRoute(pathname: string, list: readonly InboxNotification[]): string[] {
  const opened = new Set(pathsOpenedByRoute(pathname));
  if (opened.size === 0) return [];
  const parts = linkPath(pathname).split("/").filter(Boolean);
  const dmPartner = parts.length === 2 && parts[0] === "messages" ? parts[1] : undefined;
  const ids: string[] = [];
  for (const n of list) {
    if (n.read) continue;
    if (opened.has(linkPath(n.linkTo)) || (dmPartner !== undefined && n.type === "new_message" && n.actorId === dmPartner)) {
      ids.push(n.id);
    }
  }
  return ids;
}

/** Marks `ids` read in place of waiting for the server (same objects otherwise). */
export function withLocallyRead<T extends InboxNotification>(list: readonly T[], ids: ReadonlySet<string>): T[] {
  if (ids.size === 0) return list as T[];
  let changed = false;
  const out = list.map((n) => {
    if (n.read || !ids.has(n.id)) return n;
    changed = true;
    return { ...n, read: true };
  });
  return changed ? out : (list as T[]);
}

// Never a person, even if a row carries an actor id.
const SYSTEM_TYPES: ReadonlySet<string> = new Set(["caddie_analysis_complete"]);

export type NotificationActor<P> =
  /** A person's avatar. `showPhoto` false: initials only (blocked either way). */
  | { kind: "person"; profile: P; showPhoto: boolean }
  /** The GolfMe icon: system notifications, and any actor we can't (or mustn't) show. */
  | { kind: "system" };

export interface ActorLookup<P> {
  selfId?: string;
  getProfile: (id: string) => P | undefined;
  isBlockedEitherWay: (id: string) => boolean;
  /**
   * Whether the golfer is in the public directory (Discoverable). Only asked
   * for new-round alerts: the server already clears a hidden host's actor_id
   * on insert; this also covers rows from before that trigger and hosts who
   * hid themselves since.
   */
  isListed?: (id: string) => boolean;
}

export function resolveNotificationActor<P>(n: Pick<InboxNotification, "type" | "actorId">, lookup: ActorLookup<P>): NotificationActor<P> {
  const id = n.actorId;
  if (!id || id === lookup.selfId || SYSTEM_TYPES.has(n.type)) return { kind: "system" };
  if (n.type === "new_round_nearby" && lookup.isListed && !lookup.isListed(id)) return { kind: "system" };
  const profile = lookup.getProfile(id);
  if (profile === undefined) return { kind: "system" };
  return { kind: "person", profile, showPhoto: !lookup.isBlockedEitherWay(id) };
}

export type NotificationBadgeKind = "message" | "comment" | "round" | "roundAlert" | "follow" | "caddie" | "post" | "booking" | "other";

const BADGE_BY_TYPE: Record<string, NotificationBadgeKind> = {
  new_message: "message",
  post_reply: "comment",
  comment_reply: "comment",
  new_follower: "follow",
  round_joined: "round",
  round_left: "round",
  round_cancelled: "round",
  tee_time_updated: "round",
  round_created_from_post: "round",
  post_became_round: "round",
  new_round_nearby: "roundAlert",
  booking_proof_attached: "booking",
  booking_proof_removed: "booking",
  caddie_analysis_complete: "caddie",
  circle_post: "post",
};

/** The small icon on the avatar's corner. Unknown (newer server) types get "other". */
export function notificationBadgeKind(type: string): NotificationBadgeKind {
  return BADGE_BY_TYPE[type] ?? "other";
}
