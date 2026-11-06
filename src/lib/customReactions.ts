// Whether the database takes custom reaction emoji (the hold menu's "+"
// picker). Before migration 20261107160000_custom_reaction_emoji both
// reaction tables allow only the six quick emoji, so "+" stays hidden until
// this says "yes".
//
// Detection, two layers:
//   1. Probe: public.is_reaction_emoji(text) exists only once the migration
//      is applied (it IS the function the new check constraints call). One
//      call per page load, made by the reaction contexts after their first
//      successful reaction fetch: true -> "yes"; function not found
//      (PGRST202 / 42883) -> "no"; any other error (offline, timeout) ->
//      stays "unknown" and the next fetch tries again. Why a probe and not
//      only a fallback: the user never sees a refused pick on an old
//      database, and "+" appears without anyone having to fail first.
//   2. Fallback: a custom reaction the database refuses anyway (check
//      violation 23514 on *_emoji_check, e.g. the migration rolled back
//      after the probe) sets "no" for the rest of the session; the page's
//      usual "couldn't update your reaction" toast reports that one tap.
// It is a property of the database, not of the account: no reset on
// account switch. Demo accounts never ask (the menu shows "+" for them).
// No React imports, so tests/customReactions.test.ts runs under plain node.

export type CustomReactionSupport = "unknown" | "yes" | "no";

export interface ProbeResult {
  data: unknown;
  error: unknown;
}

export interface CustomReactionSupportStore {
  get: () => CustomReactionSupport;
  subscribe: (listener: () => void) => () => void;
  // Runs `call` unless the answer is known or a probe is already running.
  probe: (call: () => PromiseLike<ProbeResult>) => Promise<CustomReactionSupport>;
  // A custom reaction was refused by the emoji check.
  markRefused: () => void;
}

// PostgREST PGRST202 "Could not find the function public.is_reaction_emoji
// ... in the schema cache", Postgres 42883 undefined_function.
export function isMissingProbeFunctionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "PGRST202" || code === "42883") return true;
  return typeof message === "string" && message.includes("is_reaction_emoji") && /could not find|does not exist/i.test(message);
}

// The reaction tables' emoji check refused the value (old six-only check,
// or a value the new rule doesn't take).
export function isEmojiCheckViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "23514" && typeof message === "string" && message.includes("emoji_check");
}

export function createCustomReactionSupport(): CustomReactionSupportStore {
  let state: CustomReactionSupport = "unknown";
  let running: Promise<CustomReactionSupport> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: CustomReactionSupport) => {
    if (next === state) return;
    state = next;
    for (const l of listeners) l();
  };
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    probe(call) {
      if (state !== "unknown") return Promise.resolve(state);
      if (running) return running;
      running = (async () => {
        try {
          const { data, error } = await call();
          // A refusal seen meanwhile wins over a late "yes".
          if (state !== "unknown") return state;
          if (!error) set(data === true ? "yes" : "no");
          else if (isMissingProbeFunctionError(error)) set("no");
        } catch {
          // Network: unknown, the next fetch probes again.
        } finally {
          running = null;
        }
        return state;
      })();
      return running;
    },
    markRefused: () => set("no"),
  };
}

// The app-wide one (one database).
export const customReactionSupport = createCustomReactionSupport();

// The emoji the probe asks about: a custom one (not in the quick row).
export const PROBE_EMOJI = "⛳";
