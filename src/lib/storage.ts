import type { AppData } from "../types";
import { buildGolfers, DEFAULT_CURRENT_USER_ID } from "../data/golfers";
import { buildGolfCallsBundle } from "../data/golfCalls";
import { buildCommunityBundle } from "../data/community";

// Bumped to v8 when GolferProfile's skillPreference/agePreference fields
// were replaced with numeric handicapPreferenceMin/Max, agePreferenceMin/Max,
// noAgePreference, and noBudgetPreference was added — forces a reseed for
// anyone with older cached data still shaped the old way (same class of
// crash the v7 bump above was fixing).
const STORAGE_KEY = "golfme:data:v8";

export function seedData(): AppData {
  const golfers = buildGolfers();
  const { golfCalls, messages, reviews, circle, follows, directMessages } = buildGolfCallsBundle();
  const { posts, comments, postVotes, commentVotes } = buildCommunityBundle();
  return {
    golfers,
    golfCalls,
    messages,
    reviews,
    reports: [],
    blocks: [],
    circle,
    follows,
    directMessages,
    dmReads: [],
    posts,
    postVotes,
    comments,
    commentVotes,
    savedPosts: [],
    hiddenPosts: [],
    notifications: [],
    currentUserId: DEFAULT_CURRENT_USER_ID,
    session: { isLoggedIn: false, hasOnboarded: false },
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
      follows: parsed.follows ?? [],
      directMessages: parsed.directMessages ?? [],
      dmReads: parsed.dmReads ?? [],
      posts: parsed.posts ?? [],
      postVotes: parsed.postVotes ?? [],
      comments: parsed.comments ?? [],
      commentVotes: parsed.commentVotes ?? [],
      savedPosts: parsed.savedPosts ?? [],
      hiddenPosts: parsed.hiddenPosts ?? [],
      notifications: parsed.notifications ?? [],
      currentUserId: parsed.currentUserId ?? DEFAULT_CURRENT_USER_ID,
      session: parsed.session ?? { isLoggedIn: false, hasOnboarded: false },
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
