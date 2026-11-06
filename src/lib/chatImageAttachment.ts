import type { AttachmentState, ProcessedChatImage } from "./chatImages";

// The composer's one photo, outside React (lib/useChatImageAttachment.ts is
// the hook around it). Every pick belongs to one conversation *visit*: a
// generation number the hook bumps whenever the thread / round changes, so
// A -> B -> A is three generations. A pick, its processing result, its
// failure and a send all check both the generation and the pick's own key,
// so an answer that arrives late (the native picker resolving after the
// user moved to another chat, or an older pick finishing after a newer one)
// can never show up in, or replace, another chat's or a newer photo.
// Stale results are dropped: never carried to another chat, never sent.
//
// Object URLs: a stale result's own preview is revoked; a ready photo is
// revoked when it's replaced, removed, left behind by a chat change or the
// page unmounts; one handed to a send belongs to the sending bubble.

export type ChatImageFailure = "unreadable" | "tooLarge";

/** The attachment state plus the generation (conversation visit) it was picked in. */
export type OwnedAttachmentState = AttachmentState & { generation?: number };

export interface ChatImageAttachmentDeps {
  process: (file: File) => Promise<ProcessedChatImage>;
  revoke: (url: string) => void;
  /** The conversation visit that is current right now. */
  generation: () => number;
  /** Why processing failed: "unreadable" / "tooLarge". */
  failureReason: (err: unknown) => ChatImageFailure;
  onError: (reason: ChatImageFailure) => void;
  newKey?: () => string;
}

const NONE: AttachmentState = { kind: "none" };

export function createChatImageAttachment(deps: ChatImageAttachmentDeps) {
  let state: OwnedAttachmentState = NONE;
  let seq = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const newKey = deps.newKey ?? (() => `photo-${++seq}-${Date.now()}`);

  function set(next: OwnedAttachmentState) {
    if (next === state) return;
    state = next;
    for (const l of listeners) l();
  }

  function dropReady() {
    if (state.kind === "ready") deps.revoke(state.image.previewUrl);
  }

  /** Still the request the composer is waiting for: same pick, same visit, not unmounted. */
  function isCurrent(key: string, generation: number): boolean {
    return (
      !disposed && state.kind === "processing" && state.key === key && state.generation === generation && generation === deps.generation()
    );
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot(): OwnedAttachmentState {
      return state;
    },
    /** What a visit may show: its own photo only. */
    view(generation: number): AttachmentState {
      return state.kind !== "none" && state.generation === generation ? state : NONE;
    },
    /** A picked file, for the visit the picker was opened in. False if that visit is over (dropped). */
    pick(generation: number, file: File): boolean {
      if (disposed || generation !== deps.generation()) return false;
      dropReady();
      const key = newKey();
      set({ kind: "processing", key, generation });
      deps.process(file).then(
        (image) => {
          if (!isCurrent(key, generation)) {
            deps.revoke(image.previewUrl);
            return;
          }
          set({ kind: "ready", key, image, generation });
        },
        (err) => {
          if (!isCurrent(key, generation)) return;
          set(NONE);
          deps.onError(deps.failureReason(err));
        },
      );
      return true;
    },
    remove() {
      dropReady();
      set(NONE);
    },
    /** The visit changed: whatever belongs to an earlier one goes (a pending one is then stale). */
    leave(generation: number) {
      if (state.kind !== "none" && state.generation !== generation) {
        dropReady();
        set(NONE);
      }
    },
    /** The ready photo of this visit for a send; its preview URL now belongs to the sending bubble. */
    take(generation: number): ProcessedChatImage | null {
      if (disposed || state.kind !== "ready" || state.generation !== generation || generation !== deps.generation()) return null;
      const image = state.image;
      set(NONE);
      return image;
    },
    /** The page is mounted (again, under React StrictMode's double effects). */
    mount() {
      disposed = false;
    },
    /** The page unmounted: an unsent photo goes, a pending one is stale. */
    dispose() {
      dropReady();
      disposed = true;
      set(NONE);
    },
  };
}

export type ChatImageAttachment = ReturnType<typeof createChatImageAttachment>;
