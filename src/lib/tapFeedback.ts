import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

// Haptic feedback for taps, in the native iOS app only.
//
// Kinds:
//   tap        light impact: buttons, the bell, the avatar menu, inbox rows,
//              switches, reaction emojis
//   selection  the selection tick: tab bar tabs, segmented controls, tabs.
//              Skipped when the tapped option is already the selected one.
//   medium     medium impact: sending a message
//   success    the success notification: joined a round, hosted a round,
//              published a post, a Caddie analysis finished
//              (components/caddie/CaddieDoneHaptic)
//
// Web: nothing. iOS Safari has no vibration API at all, and buzzing Android
// phones through navigator.vibrate on every ordinary tap is more irritating
// than helpful (no intensity control, and it is not what Android apps do for
// a button press). Gesture moments (swipe to reply, hold) keep their own
// vibrate fallback in their own hooks.
//
// "Reduce haptics": GolfMe has no such setting. iOS's own Settings > Sounds &
// Haptics > System Haptics switch turns UIFeedbackGenerator off, which is
// what the Haptics plugin uses, so a golfer who switched haptics off on the
// phone gets none here either.
//
// Never throws, never awaits: the plugin call is fire-and-forget and a
// rejected promise is swallowed. Throttled so one tap can never buzz twice
// (a nested tappable, a ghost click), with a separate window for outcome
// haptics so a "joined" success right after the Join tap still lands.

export type HapticKind = "tap" | "selection" | "medium" | "success";

const KINDS: readonly HapticKind[] = ["tap", "selection", "medium", "success"];

export function isHapticKind(value: unknown): value is HapticKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

export interface HapticDriver {
  isNative(): boolean;
  impact(style: "light" | "medium"): Promise<unknown> | void;
  selection(): Promise<unknown> | void;
  success(): Promise<unknown> | void;
}

// Taps and selection ticks share one window; it only needs to cover one
// physical tap (a double fire lands within a frame or two).
export const TAP_THROTTLE_MS = 80;
// Outcomes (medium, success) share another.
export const OUTCOME_THROTTLE_MS = 400;

export function createTapFeedback(driver: HapticDriver, now: () => number = () => Date.now()) {
  let lastTap = Number.NEGATIVE_INFINITY;
  let lastOutcome = Number.NEGATIVE_INFINITY;
  // Returns whether a haptic was requested from the device.
  return function haptic(kind: HapticKind): boolean {
    try {
      if (!driver.isNative()) return false;
      const t = now();
      if (kind === "medium" || kind === "success") {
        if (t - lastOutcome < OUTCOME_THROTTLE_MS) return false;
        lastOutcome = t;
      } else {
        if (t - lastTap < TAP_THROTTLE_MS) return false;
        lastTap = t;
      }
      const result =
        kind === "tap"
          ? driver.impact("light")
          : kind === "medium"
            ? driver.impact("medium")
            : kind === "selection"
              ? driver.selection()
              : driver.success();
      if (result && typeof (result as Promise<unknown>).catch === "function") (result as Promise<unknown>).catch(() => {});
      return true;
    } catch {
      return false;
    }
  };
}

// The plugin's iOS selectionChanged() does nothing unless selectionStart()
// created the generator first, so the first selection tick starts it and
// later ones reuse it (never ended: it costs nothing while idle).
let selectionReady: Promise<unknown> | null = null;

const capacitorDriver: HapticDriver = {
  isNative: () => Capacitor.isNativePlatform(),
  impact: (style) => Haptics.impact({ style: style === "medium" ? ImpactStyle.Medium : ImpactStyle.Light }),
  selection: () => {
    if (!selectionReady) {
      selectionReady = Haptics.selectionStart().catch((err) => {
        selectionReady = null;
        throw err;
      });
    }
    return selectionReady.then(() => Haptics.selectionChanged());
  },
  success: () => Haptics.notification({ type: NotificationType.Success }),
};

const deviceHaptic = createTapFeedback(capacitorDriver);

// The one call for the app. When a test page has put an array on
// window.__gmTapHaptics before load, every request is also recorded there, so
// a headless browser can check which taps ask for which haptic (web never
// buzzes). Nothing is recorded otherwise.
export function tapHaptic(kind: HapticKind): boolean {
  try {
    const w = typeof window !== "undefined" ? (window as unknown as { __gmTapHaptics?: unknown }) : null;
    if (w && Array.isArray(w.__gmTapHaptics)) w.__gmTapHaptics.push(kind);
  } catch {
    // Recording is best-effort.
  }
  return deviceHaptic(kind);
}

// ---------------------------------------------------------------------------
// Delegated taps. One click listener for the whole document instead of a
// handler on every button: an element opts in with data-haptic="<kind>"
// (the shared Button does by default), and these roles get one without it:
// tab / radio (selection), switch / menuitemradio (tap). data-haptic="none"
// opts out.

export const HAPTIC_SELECTOR = '[data-haptic],[role="tab"],[role="radio"],[role="switch"],[role="menuitemradio"]';

// The minimal Element surface used here, so tests can pass plain objects.
export interface HapticElementLike {
  closest(selector: string): HapticElementLike | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

function isAlreadySelected(el: HapticElementLike): boolean {
  if (el.getAttribute("aria-selected") === "true") return true;
  if (el.getAttribute("aria-checked") === "true") return true;
  if (el.getAttribute("aria-pressed") === "true") return true;
  const current = el.getAttribute("aria-current");
  return current !== null && current !== "false";
}

// Which haptic a click on `target` asks for, read from the state BEFORE the
// click's own handlers run (a tab that is about to become selected must not
// look already selected).
export function hapticForElement(target: unknown): HapticKind | null {
  if (!target || typeof (target as HapticElementLike).closest !== "function") return null;
  const el = (target as HapticElementLike).closest(HAPTIC_SELECTOR);
  if (!el) return null;
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return null;
  const explicit = el.getAttribute("data-haptic");
  let kind: HapticKind;
  if (explicit !== null && explicit !== "") {
    if (!isHapticKind(explicit)) return null; // "none", or anything unknown
    kind = explicit;
  } else {
    const role = el.getAttribute("role");
    kind = role === "tab" || role === "radio" ? "selection" : "tap";
  }
  if (kind === "selection" && isAlreadySelected(el)) return null;
  return kind;
}

interface ClickLike {
  target: unknown;
  detail: number;
}

type ClickListener = (e: ClickLike) => void;

interface ListenerTarget {
  addEventListener(type: "click", listener: ClickListener, capture: boolean): void;
  removeEventListener(type: "click", listener: ClickListener, capture: boolean): void;
}

// The document capture listener reads which haptic the tap asks for (state
// before any handler runs) and arms a one-off listener on the tappable
// itself; the haptic fires only when the click actually reaches it. So a
// capture-phase handler that swallows a click with stopPropagation (the DM
// hold menu ignoring the lifting finger's click) never buzzes, while a
// bubble-phase stopPropagation in the app's own handlers (a button inside a
// clickable card) still does: React handles those at the root, after the
// click has passed the tappable. Keyboard and programmatic clicks (detail
// 0) never buzz. A scroll never produces a click.
export function installTapFeedback(
  target: ListenerTarget = document as unknown as ListenerTarget,
  haptic: (kind: HapticKind) => unknown = tapHaptic,
): () => void {
  let armed: { el: ListenerTarget; listener: ClickListener } | null = null;
  const disarm = () => {
    if (armed) armed.el.removeEventListener("click", armed.listener, false);
    armed = null;
  };
  const onCapture = (e: ClickLike) => {
    disarm();
    if (e.detail === 0) return;
    const t = e.target as HapticElementLike | null;
    const kind = hapticForElement(t);
    if (!kind || !t) return;
    const el = t.closest(HAPTIC_SELECTOR) as unknown as ListenerTarget | null;
    if (!el || typeof el.addEventListener !== "function") return;
    const listener: ClickListener = (ev) => {
      if (ev !== e) return;
      disarm();
      haptic(kind);
    };
    el.addEventListener("click", listener, false);
    armed = { el, listener };
  };
  target.addEventListener("click", onCapture, true);
  return () => {
    disarm();
    target.removeEventListener("click", onCapture, true);
  };
}
