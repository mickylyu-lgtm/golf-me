// Short, cancellable scroll motion for the iOS app's keyboard reveals
// (Micky, 2026-11-06: tapping a field "moves the screen" abruptly).
//
// Why: keyboardWillShow arrives as the keyboard STARTS its ~250 ms slide,
// and the reveals (page: useRevealFocusedFieldAboveKeyboard, sheet /
// onboarding scrollers: revealFocusedField, Host a Round's course field:
// CourseAutocomplete) used to jump straight to their final position on the
// next frame. This moves the same scroller to the SAME final position over
// 140-260 ms (ease-out cubic, never overshoots), so it travels with the
// keyboard instead of teleporting ahead of it. Nothing waits for the
// keyboard; the motion starts exactly when the jump used to happen.
//
// Rules:
// - One animation per scroller. A new target within 1 px of the running one
//   keeps it going (repeated focus / keyboardWillShow events coalesce); a
//   different target continues from where the scroller is now. Never a
//   queue.
// - Each frame: the caller's guard (field still focused, keyboard state,
//   route) is checked before writing; false stops it where it is.
// - A touch or wheel while it runs stops it: the golfer takes over. Typing
//   never does. The tap that focused the field came before the motion
//   started, so it can't cancel itself.
// - Something else scrolling meanwhile (a WebKit pan, a dock restore) is
//   not fought: the motion continues from there to the same target, within
//   the same end time.
// - A hard deadline: whatever frames were dropped, it ends at the target.
// - Reduced motion, the switch below off, no requestAnimationFrame or a
//   hidden page: the target is written at once (exactly the old behaviour).
// - Per frame only one scroll read + one write: no layout reads, no React.
//
// Master switch: SMOOTH_KEYBOARD_MOTION = false restores the instant writes
// everywhere. Per device, About -> tap the description 7 times (founder
// account) flips localStorage "golfme:kbMotion" ("off" / "on") for a
// before/after on the phone without a redeploy.
//
// The core (createScrollAnimator) takes its clock, frames and input watcher
// as arguments and touches no DOM at import time, so
// tests/smoothScroll.test.ts runs under plain node.

export const SMOOTH_KEYBOARD_MOTION = true;
export const KEYBOARD_MOTION_KEY = "golfme:kbMotion";

const MIN_MS = 140;
const MAX_MS = 260;
const MS_PER_PX = 0.4;
// Extra time after the planned end before the deadline forces the target.
const DEADLINE_SLACK_MS = 120;
// Moves smaller than this are written at once.
const MIN_ANIMATED_PX = 2;
// A target this close to the running one is the same target.
const SAME_TARGET_PX = 1;
// Read back further than this from what was last written: someone else
// scrolled.
const EXTERNAL_PX = 1.5;

export function motionDuration(distance: number): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, MIN_MS + Math.abs(distance) * MS_PER_PX));
}

export function easeOutCubic(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

export interface ScrollAxis {
  read(): number;
  write(value: number): void;
}

export interface MotionEnv {
  now(): number;
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
  // True: write the target at once instead of animating.
  instant(): boolean;
  // Calls onInput on the golfer's own scroll input; returns the detach.
  watchUserInput(onInput: () => void): () => void;
}

export interface AnimateOptions {
  // Checked every frame before writing; false stops the motion there.
  guard?: () => boolean;
  // Once per call: true when the target was reached (or written at once),
  // false when stopped (guard, input, cancel, replaced by a new target).
  onDone?: (reached: boolean) => void;
  // Stop (instead of carrying on) when something else scrolls meanwhile.
  yieldToOtherScrolls?: boolean;
}

export interface ScrollAnimator {
  animateTo(target: number, options?: AnimateOptions): void;
  cancel(): void;
  isRunning(): boolean;
}

interface Run {
  from: number;
  to: number;
  start: number;
  end: number;
  deadline: number;
  lastWritten: number;
  guard?: () => boolean;
  onDone?: (reached: boolean) => void;
  yieldToOtherScrolls?: boolean;
  detachInput: () => void;
}

export function createScrollAnimator(axis: ScrollAxis, env: MotionEnv): ScrollAnimator {
  let run: Run | null = null;
  let frameId: number | null = null;

  function stop(reached: boolean) {
    const r = run;
    run = null;
    if (frameId !== null) env.cancelFrame(frameId);
    frameId = null;
    if (!r) return;
    r.detachInput();
    r.onDone?.(reached);
  }

  function write(value: number, r: Run) {
    const v = Math.round(value);
    axis.write(v);
    r.lastWritten = v;
  }

  function frame() {
    frameId = null;
    const r = run;
    if (!r) return;
    if (r.guard && !r.guard()) return stop(false);
    const now = env.now();
    const current = axis.read();
    if (Math.abs(current - r.lastWritten) > EXTERNAL_PX) {
      if (r.yieldToOtherScrolls) return stop(false);
      // Moved by something else: carry on from here, same end time.
      r.from = current;
      r.start = now;
      r.end = Math.max(now + 60, r.end);
    }
    if (now >= r.end || now >= r.deadline || Math.abs(r.to - r.from) < MIN_ANIMATED_PX) {
      write(r.to, r);
      return stop(true);
    }
    const t = (now - r.start) / (r.end - r.start);
    write(r.from + (r.to - r.from) * easeOutCubic(t), r);
    frameId = env.requestFrame(frame);
  }

  return {
    animateTo(target, options = {}) {
      if (run && Math.abs(target - run.to) <= SAME_TARGET_PX) {
        // Same destination: keep the running motion, newest guard/onDone.
        const previous = run.onDone;
        run.guard = options.guard;
        run.onDone = options.onDone;
        run.yieldToOtherScrolls = options.yieldToOtherScrolls;
        if (previous && previous !== options.onDone) previous(false);
        return;
      }
      const current = axis.read();
      if (env.instant() || Math.abs(target - current) < MIN_ANIMATED_PX) {
        stop(false);
        if (Math.round(target) !== Math.round(current)) axis.write(Math.round(target));
        options.onDone?.(true);
        return;
      }
      const now = env.now();
      const duration = motionDuration(target - current);
      if (run) {
        // New destination: continue from where the scroller is now.
        const previous = run.onDone;
        Object.assign(run, {
          from: current,
          to: target,
          start: now,
          end: now + duration,
          deadline: now + duration + DEADLINE_SLACK_MS,
          lastWritten: current,
          guard: options.guard,
          onDone: options.onDone,
          yieldToOtherScrolls: options.yieldToOtherScrolls,
        });
        if (previous && previous !== options.onDone) previous(false);
        return;
      }
      run = {
        from: current,
        to: target,
        start: now,
        end: now + duration,
        deadline: now + duration + DEADLINE_SLACK_MS,
        lastWritten: current,
        guard: options.guard,
        onDone: options.onDone,
        yieldToOtherScrolls: options.yieldToOtherScrolls,
        detachInput: () => {},
      };
      run.detachInput = env.watchUserInput(() => stop(false));
      frameId = env.requestFrame(frame);
    },
    cancel() {
      stop(false);
    },
    isRunning() {
      return run !== null;
    },
  };
}

// ── DOM side ───────────────────────────────────────────────────────────────

export function readKeyboardMotionOverride(): "on" | "off" | null {
  try {
    const v = window.localStorage.getItem(KEYBOARD_MOTION_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

export function setKeyboardMotionOverride(value: "on" | "off" | null): void {
  try {
    if (value) window.localStorage.setItem(KEYBOARD_MOTION_KEY, value);
    else window.localStorage.removeItem(KEYBOARD_MOTION_KEY);
  } catch {
    // Storage unavailable: the switch just doesn't stick.
  }
}

// Smooth keyboard motion on for this device right now.
export function keyboardMotionEnabled(): boolean {
  const override = readKeyboardMotionOverride();
  if (override) return override === "on";
  return SMOOTH_KEYBOARD_MOTION;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// Motion would actually play right now (switch on, no reduced motion).
export function keyboardMotionActive(): boolean {
  return keyboardMotionEnabled() && !prefersReducedMotion();
}

function domEnv(): MotionEnv {
  return {
    now: () => performance.now(),
    requestFrame: (cb) => window.requestAnimationFrame(cb),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    instant: () => !keyboardMotionEnabled() || prefersReducedMotion() || typeof window.requestAnimationFrame !== "function" || document.hidden,
    watchUserInput(onInput) {
      const options: AddEventListenerOptions = { capture: true, passive: true };
      window.addEventListener("touchstart", onInput, options);
      window.addEventListener("wheel", onInput, options);
      return () => {
        window.removeEventListener("touchstart", onInput, options);
        window.removeEventListener("wheel", onInput, options);
      };
    },
  };
}

let windowAnimator: ScrollAnimator | null = null;

// The one animator for the page's own scroll (shared by every caller, so two
// can never move the window at once: the latest target wins).
function windowScroll(): ScrollAnimator {
  windowAnimator ??= createScrollAnimator(
    {
      read: () => window.scrollY,
      write: (y) => window.scrollTo(0, y),
    },
    domEnv(),
  );
  return windowAnimator;
}

function maxWindowScroll(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

// Scrolls the window to `y` (clamped to its range). Stops by itself on a
// route change.
export function animateWindowTo(y: number, options: AnimateOptions = {}): void {
  const path = window.location.pathname;
  const guard = options.guard;
  windowScroll().animateTo(Math.min(Math.max(0, y), maxWindowScroll()), {
    ...options,
    guard: () => window.location.pathname === path && (!guard || guard()),
  });
}

export function animateWindowBy(delta: number, options: AnimateOptions = {}): void {
  animateWindowTo(window.scrollY + delta, options);
}

export function cancelWindowAnimation(): void {
  windowAnimator?.cancel();
}

const elementAnimators = new WeakMap<HTMLElement, ScrollAnimator>();

// Scrolls `el`'s own scrollTop to `top` (clamped). Stops by itself once the
// element has left the page, and when anything else sets its scrollTop
// meanwhile (KeyboardAwareModal's restore when the keyboard closes): inside
// a scroller there's no native pan to ride through, so another write always
// means someone else now owns the position.
export function animateScrollTop(el: HTMLElement, top: number, options: AnimateOptions = {}): void {
  let animator = elementAnimators.get(el);
  if (!animator) {
    animator = createScrollAnimator(
      {
        read: () => el.scrollTop,
        write: (value) => {
          el.scrollTop = value;
        },
      },
      domEnv(),
    );
    elementAnimators.set(el, animator);
  }
  const guard = options.guard;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  animator.animateTo(Math.min(Math.max(0, top), max), {
    yieldToOtherScrolls: true,
    ...options,
    guard: () => el.isConnected && (!guard || guard()),
  });
}
