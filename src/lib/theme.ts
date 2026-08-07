import type { GolfVibe } from "../types";

export const VIBE_TONE: Record<GolfVibe, "fairway" | "sun" | "sky" | "rose" | "slate"> = {
  "Casual & Social": "fairway",
  Competitive: "rose",
  "Beginner-Friendly": "sky",
  Networking: "sun",
  "Just Here to Golf": "slate",
};
