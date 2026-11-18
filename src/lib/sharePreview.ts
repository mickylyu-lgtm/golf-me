import { supabase } from "./supabase";
import { CANONICAL_ORIGIN } from "./shareLinks";
// Prepare a minimal opaque preview link; only the explicit share action distributes it.
export async function createSharePreview(kind: "post" | "round", id: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_share_preview", { p_kind: kind, p_id: id });
  if (error || typeof data !== "string" || !/^[0-9a-f]{64}$/.test(data)) throw new Error("Unable to prepare share preview");
  return `${CANONICAL_ORIGIN}/s/${data}`;
}
