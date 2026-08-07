import type { AppData } from "../types";
import { buildGolfers, DEFAULT_CURRENT_USER_ID } from "../data/golfers";
import { buildGolfCallsBundle } from "../data/golfCalls";

// Bumped to v2 when GolfCall gained a required distanceMiles field —
// forces a reseed for anyone with v1 data cached in their browser.
const STORAGE_KEY = "golfme:data:v2";

export function seedData(): AppData {
  const golfers = buildGolfers();
  const { golfCalls, messages, reviews, circle } = buildGolfCallsBundle();
  return {
    golfers,
    golfCalls,
    messages,
    reviews,
    reports: [],
    blocks: [],
    circle,
    currentUserId: DEFAULT_CURRENT_USER_ID,
  };
}

export function loadData(): AppData {
  if (typeof window === "undefined") return seedData();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return persistAndReturn(seedData());
    const parsed = JSON.parse(raw) as Partial<AppData>;
    if (!parsed.golfers || !parsed.golfCalls) return persistAndReturn(seedData());
    return {
      golfers: parsed.golfers,
      golfCalls: parsed.golfCalls,
      messages: parsed.messages ?? [],
      reviews: parsed.reviews ?? [],
      reports: parsed.reports ?? [],
      blocks: parsed.blocks ?? [],
      circle: parsed.circle ?? [],
      currentUserId: parsed.currentUserId ?? DEFAULT_CURRENT_USER_ID,
    };
  } catch (err) {
    console.error("Golf Me: failed to load data, reseeding.", err);
    return persistAndReturn(seedData());
  }
}

function persistAndReturn(data: AppData): AppData {
  saveData(data);
  return data;
}

export function saveData(data: AppData): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function resetToSeedData(): AppData {
  const data = seedData();
  saveData(data);
  return data;
}
