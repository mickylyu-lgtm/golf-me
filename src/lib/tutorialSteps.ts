import type { TranslationKey } from "../i18n/locales/en";

// data-tutorial-id values the spotlight overlay looks up via
// document.querySelectorAll — kept centralized so the nav components (which
// render the actual DOM elements) and TUTORIAL_STEPS (which reference them
// by id) can't drift apart.
export const NAV_TUTORIAL_ID_BY_PATH: Record<string, string> = {
  "/": "nav-home",
  "/messages": "nav-messages",
  "/find": "nav-play",
  "/caddie": "nav-caddie",
  "/profile": "nav-me",
};

export const COMMUNITY_TUTORIAL_ID = "tutorial-community";

export interface TutorialStep {
  route: string;
  // null -> no spotlight cutout, card just centers (used for the opening
  // welcome and closing screens, neither of which points at one widget).
  targetId: string | null;
  titleKey: TranslationKey;
  textKey: TranslationKey;
}

// Home / Play / Chat / Community / Caddie, the same 5 features + order the
// product brief called out, plus a closing screen. Both nav-tab targets
// (Play/Chat/Caddie) and the on-page Community section stay spotlight-able
// because RootTabCarousel keeps all 5 root panels mounted at once (see its
// own header comment) -- navigating between steps here is a fast in-place
// slide, never a real remount, so the target element is already in the DOM
// before TutorialOverlay measures it.
export const TUTORIAL_STEPS: TutorialStep[] = [
  { route: "/", targetId: null, titleKey: "tutorial.home.title", textKey: "tutorial.home.text" },
  { route: "/find", targetId: "nav-play", titleKey: "tutorial.play.title", textKey: "tutorial.play.text" },
  { route: "/messages", targetId: "nav-messages", titleKey: "tutorial.chat.title", textKey: "tutorial.chat.text" },
  { route: "/", targetId: COMMUNITY_TUTORIAL_ID, titleKey: "tutorial.community.title", textKey: "tutorial.community.text" },
  { route: "/caddie", targetId: "nav-caddie", titleKey: "tutorial.caddie.title", textKey: "tutorial.caddie.text" },
  { route: "/", targetId: null, titleKey: "tutorial.done.title", textKey: "tutorial.done.text" },
];

// The last index is the closing screen -- no spotlight, no progress
// counter, no Skip (there's nothing left to skip).
export const TUTORIAL_LAST_INDEX = TUTORIAL_STEPS.length - 1;
