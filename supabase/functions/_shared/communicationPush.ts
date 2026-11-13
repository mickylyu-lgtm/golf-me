// APNs payload for send-push, with optional iOS Communication Notification
// fields (the sender's round photo instead of the app icon, like iMessage).
//
// A push that names a sender (sender_id from the Postgres trigger) gets:
//   aps.mutable-content = 1   -> the app's Notification Service Extension runs
//   aps.thread-id             -> groups that person's/post's pushes together
//   sender { id, avatar_url?, initials, colors }  -> what the extension needs
// The display name is NOT repeated: the extension uses aps.alert.title, which
// the trigger already set to the sender's (fallback-safe) name.
//
// avatar_url is only ever the sender's own object in the PUBLIC avatars bucket
// of this project (the app already shows it to any golfer), so the extension
// can fetch it with no auth, and the payload never points the phone at any
// other host. No photo -> no avatar_url; the extension then draws the same
// initials-on-gradient monogram the app uses.
//
// A push without a sender (round updates, Caddie, fan-out) keeps exactly the
// old payload, byte for byte, so nothing changes for system notifications.
// Pure functions only: unit-tested with node --test, imported by send-push.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Tailwind gradient tokens from src/lib/avatar.ts -> [from, to] hex.
const GRADIENTS: Record<string, [string, string]> = {
  "from-emerald-400 to-teal-600": ["#34d399", "#0d9488"],
  "from-sky-400 to-blue-600": ["#38bdf8", "#2563eb"],
  "from-slate-500 to-slate-800": ["#64748b", "#1e293b"],
  "from-fuchsia-400 to-purple-600": ["#e879f9", "#9333ea"],
  "from-amber-400 to-orange-600": ["#fbbf24", "#ea580c"],
  "from-rose-400 to-pink-600": ["#fb7185", "#db2777"],
  "from-red-400 to-rose-700": ["#f87171", "#be123c"],
  "from-lime-400 to-green-600": ["#a3e635", "#16a34a"],
  "from-teal-400 to-cyan-700": ["#2dd4bf", "#0e7490"],
  "from-indigo-400 to-violet-700": ["#818cf8", "#6d28d9"],
  "from-fairway-500 to-fairway-700": ["#22c55e", "#15803d"],
};
// GolfMe fairway green, the app's own fallback avatar colour.
export const DEFAULT_GRADIENT: [string, string] = ["#22c55e", "#15803d"];

export function avatarGradient(token: unknown): [string, string] {
  if (typeof token !== "string") return DEFAULT_GRADIENT;
  return GRADIENTS[token.trim().replace(/\s+/g, " ")] ?? DEFAULT_GRADIENT;
}

// Same rule as initialsFromName in src/lib/avatar.ts; a stored value wins
// when it is short and printable. Never "??": an empty name gives "".
export function monogramInitials(stored: unknown, name: unknown): string {
  if (typeof stored === "string") {
    const s = stored.trim();
    const printable = [...s].every((ch) => ch.charCodeAt(0) >= 0x20 && ch !== "<" && ch !== ">");
    if (s && s !== "??" && [...s].length <= 3 && printable) return s.toUpperCase();
  }
  if (typeof name !== "string") return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return [...parts[0]].slice(0, 2).join("").toUpperCase();
  return ([...parts[0]][0] + [...parts[parts.length - 1]][0]).toUpperCase();
}

// Only the sender's own object under the public avatars bucket of THIS
// project, over https. Anything else (a Google URL from before the copy to
// storage, another user's folder, another host, a data: URL) -> null.
export function trustedAvatarUrl(photoUrl: unknown, supabaseUrl: string, senderId: string): string | null {
  if (typeof photoUrl !== "string" || photoUrl.length > 512 || !isUuid(senderId)) return null;
  let base: URL;
  let url: URL;
  try {
    base = new URL(supabaseUrl);
    url = new URL(photoUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.host !== base.host || url.username || url.password) return null;
  const prefix = `/storage/v1/object/public/avatars/${senderId.toLowerCase()}/`;
  const path = url.pathname.toLowerCase();
  if (!path.startsWith(prefix) || path.length === prefix.length || path.includes("..")) return null;
  return url.toString();
}

// DMs: one thread per person (the link is /messages/<sender>). Anything
// else: one thread per thing it links to (a post, a round, a profile).
// APNs has no hard thread-id limit, but keep it short and printable.
export function threadIdFor(linkTo: unknown, senderId: string): string {
  if (typeof linkTo === "string") {
    const dm = /^\/messages\/([0-9a-f-]{36})$/i.exec(linkTo);
    if (dm && isUuid(dm[1])) return `dm-${dm[1].toLowerCase()}`;
    if (/^\/[A-Za-z0-9/_-]{1,100}$/.test(linkTo)) return `link-${linkTo.slice(1).replace(/\//g, "-")}`;
  }
  return `person-${senderId.toLowerCase()}`;
}

export type SenderProfile = {
  name?: string | null;
  photo_url?: string | null;
  avatar_initials?: string | null;
  avatar_color?: string | null;
};

export type CommunicationSender = {
  id: string;
  avatar_url?: string;
  initials: string;
  colors: [string, string];
};

export function communicationSender(senderId: string, profile: SenderProfile, supabaseUrl: string): CommunicationSender {
  const avatar = trustedAvatarUrl(profile.photo_url, supabaseUrl, senderId);
  return {
    id: senderId.toLowerCase(),
    ...(avatar ? { avatar_url: avatar } : {}),
    initials: monogramInitials(profile.avatar_initials, profile.name),
    colors: avatarGradient(profile.avatar_color),
  };
}

export type PushPayloadInput = {
  title: unknown;
  body: unknown;
  linkTo: unknown;
  sender?: CommunicationSender | null;
};

export function buildApnsPayload({ title, body, linkTo, sender }: PushPayloadInput): Record<string, unknown> {
  if (!sender) {
    // Unchanged pre-communication shape (JSON.stringify drops an undefined title, as before).
    return { aps: { alert: { title, body }, sound: "default" }, link_to: linkTo ?? null };
  }
  return {
    aps: {
      alert: { title, body },
      sound: "default",
      "mutable-content": 1,
      "thread-id": threadIdFor(linkTo, sender.id),
    },
    link_to: linkTo ?? null,
    sender,
  };
}
