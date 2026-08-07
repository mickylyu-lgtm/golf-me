// Same gradient palette used by the seeded golfers, so a newly signed-up
// golfer's avatar fits right in visually.
const AVATAR_COLORS = [
  "from-emerald-400 to-teal-600",
  "from-sky-400 to-blue-600",
  "from-slate-500 to-slate-800",
  "from-fuchsia-400 to-purple-600",
  "from-amber-400 to-orange-600",
  "from-rose-400 to-pink-600",
  "from-red-400 to-rose-700",
  "from-lime-400 to-green-600",
  "from-teal-400 to-cyan-700",
  "from-indigo-400 to-violet-700",
];

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarColorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
