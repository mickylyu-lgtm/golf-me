// Keep the submitted text visible until success. A delayed completion must
// never clear edits, another post's draft, or a different account's draft.
export type CommentSubmitResult =
  | { status: "sent" | "edited" | "stale" | "ignored" }
  | { status: "failed"; error: unknown };

interface DraftIo {
  load: (key: string) => string;
  save: (key: string, text: string) => void;
  changed: () => void;
  version: (key: string) => string;
}

export function createCommentDraftSession(io: DraftIo) {
  let active = false;
  let owner = "";
  let key = "";
  let text = "";
  let revision = 0;
  let attempt: object | null = null;

  function update(value: string) {
    if (!active) return;
    text = value;
    revision += 1;
    // Blocked/full storage must not make the editable field unusable.
    try { io.save(key, value); } catch { /* The in-memory draft is kept. */ }
    io.changed();
  }

  return {
    open(nextOwner: string, nextKey: string) {
      if (active && owner === nextOwner && key === nextKey) return;
      active = true;
      owner = nextOwner;
      key = nextKey;
      revision = 0;
      attempt = null;
      try { text = io.load(key); } catch { text = ""; }
      io.changed();
    },
    close() { active = false; attempt = null; },
    refresh(changedKey: string | null) {
      if (!active || (changedKey !== null && changedKey !== key)) return;
      let latest: string;
      try { latest = io.load(key); } catch { return; }
      if (latest === text) return;
      text = latest;
      revision += 1;
      io.changed();
    },
    snapshot: () => ({ owner, key, text, submitting: attempt !== null }),
    update,
    async submit(send: (text: string) => Promise<unknown>): Promise<CommentSubmitResult> {
      if (!active || attempt || !text.trim()) return { status: "ignored" };
      const token = {};
      const submittedRevision = revision;
      const submittedText = text;
      const submittedKey = key;
      // A new submission also owns a new persisted version, even if its
      // text equals an older request's text after leaving and returning.
      try { io.save(key, text); } catch { /* Keep the local draft. */ }
      const submittedVersion = io.version(key);
      attempt = token;
      io.changed();
      try {
        await send(submittedText);
        if (!active || attempt !== token) {
          // Navigating away must not leave an already-posted draft behind.
          // The version includes the sign-out generation: never clear a
          // newer edit, new send, or the next account's draft.
          if (io.version(submittedKey) === submittedVersion) {
            try { io.save(submittedKey, ""); } catch { /* Best-effort persistence. */ }
          }
          return { status: "stale" };
        }
        if (revision !== submittedRevision || io.version(key) !== submittedVersion) return { status: "edited" };
        update("");
        return { status: "sent" };
      } catch (error) {
        // No restoration: even a rejection leaves the newest typed text intact.
        return active && attempt === token ? { status: "failed", error } : { status: "stale" };
      } finally {
        if (active && attempt === token) {
          attempt = null;
          io.changed();
        }
      }
    },
  };
}
