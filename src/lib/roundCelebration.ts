// Round-complete celebration: when it should play, and the confetti physics.
// Pure (no DOM, no React) so node tests can cover it.
//
// Who sees it, and when:
//   - the host, every time they mark a round completed (their own action);
//   - everyone else in the group, once per round, either when the round flips
//     to completed while its page is open (realtime), or the first time they
//     open it afterwards, as long as the round day was recent. Rounds have no
//     completed-at timestamp, so "recent" is the round's own date; without
//     it, every old completed round would celebrate on its first visit after
//     this shipped.

export const RECENT_ROUND_MS = 3 * 24 * 60 * 60 * 1000;
export const SEEN_LIMIT = 200;

export function seenKey(userId: string): string {
  return `gm.roundCelebrated.${userId}`;
}

export function parseSeen(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Newest last, capped so the list never grows without bound.
export function addSeen(seen: readonly string[], callId: string): string[] {
  const next = seen.filter((id) => id !== callId);
  next.push(callId);
  return next.length > SEEN_LIMIT ? next.slice(next.length - SEEN_LIMIT) : next;
}

export interface CelebrateInput {
  isCompleted: boolean;
  isJoined: boolean;
  callId: string;
  dateISO: string;
  now: number;
  seen: readonly string[];
}

// Whether opening (or watching) a completed round should celebrate.
export function shouldCelebrateOnView(input: CelebrateInput): boolean {
  if (!input.isCompleted || !input.isJoined) return false;
  if (input.seen.includes(input.callId)) return false;
  const roundAt = new Date(input.dateISO).getTime();
  if (!Number.isFinite(roundAt)) return false;
  return input.now - roundAt <= RECENT_ROUND_MS && input.now >= roundAt - RECENT_ROUND_MS;
}

// ---------------------------------------------------------------------------
// Confetti. Paper pieces fall from two bursts at the top corners, tumble, and
// fade out. Brand forest, fairway green, gold and white: no rainbow.

export const CONFETTI_COLORS = ["#1b4a2d", "#2f8f5b", "#7cc49a", "#f0b93f", "#f7d98a", "#ffffff"] as const;
export const CONFETTI_MS = 2600;

export interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vrot: number;
  // Flutter: the piece's apparent width swings as it tumbles.
  flip: number;
  vflip: number;
  color: string;
  round: boolean;
}

export function makeConfetti(count: number, width: number, height: number, rand: () => number = Math.random): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const left = i % 2 === 0;
    const angle = (left ? -60 : -120) * (Math.PI / 180) + (rand() - 0.5) * 0.9;
    const speed = 0.55 + rand() * 0.75; // px per ms
    pieces.push({
      x: left ? width * 0.08 : width * 0.92,
      y: height * 0.32,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 6 + rand() * 5,
      h: 9 + rand() * 7,
      rot: rand() * Math.PI * 2,
      vrot: (rand() - 0.5) * 0.02,
      flip: rand() * Math.PI * 2,
      vflip: 0.008 + rand() * 0.012,
      color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)] ?? CONFETTI_COLORS[0],
      round: rand() < 0.18,
    });
  }
  return pieces;
}

export const GRAVITY = 0.0016; // px per ms^2
export const DRAG = 0.0022; // per ms
export const TERMINAL_VY = 0.32; // px per ms: paper drifts, it does not drop

export function stepPiece(p: Piece, dt: number): void {
  const d = Math.max(0, 1 - DRAG * dt);
  p.vx *= d;
  p.vy = Math.min(TERMINAL_VY, p.vy * d + GRAVITY * dt);
  p.x += p.vx * dt + Math.sin(p.flip) * 0.04 * dt;
  p.y += p.vy * dt;
  p.rot += p.vrot * dt;
  p.flip += p.vflip * dt;
}

// Overall opacity: full, then a fade over the last 30%.
export function confettiAlpha(elapsed: number, total: number = CONFETTI_MS): number {
  if (elapsed <= 0) return 1;
  if (elapsed >= total) return 0;
  const fadeStart = total * 0.7;
  return elapsed < fadeStart ? 1 : 1 - (elapsed - fadeStart) / (total - fadeStart);
}
