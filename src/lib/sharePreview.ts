import { supabase } from "./supabase";
import { CANONICAL_ORIGIN } from "./shareLinks";

const PREPARE_DEADLINE_MS = 12_000;

// Prepare a minimal opaque preview link; only the explicit share action distributes it.
export async function createSharePreview(kind: "post" | "round", id: string): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Bound the caller's wait even when the transport does not settle on abort.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Unable to prepare share preview"));
    }, PREPARE_DEADLINE_MS);
  });
  try {
    const { data, error } = await Promise.race([
      supabase.rpc("create_share_preview", { p_kind: kind, p_id: id }).abortSignal(controller.signal),
      deadline,
    ]);
    if (error || typeof data !== "string" || !/^[0-9a-f]{64}$/.test(data)) throw new Error("Unable to prepare share preview");
    return `${CANONICAL_ORIGIN}/s/${data}`;
  } finally {
    clearTimeout(timer);
  }
}
