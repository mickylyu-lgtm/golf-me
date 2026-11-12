import type { SupabaseClient } from "@supabase/supabase-js";

// A successful request is not necessarily a changed row (RLS/no match).
// Only an active round that this host actually transitions can acknowledge
// completion. The status filter also makes repeated/concurrent writes no-op.
export async function markRoundCompleted(client: SupabaseClient, roundId: string, userId: string): Promise<boolean> {
  const { data, error } = await client
    .from("golf_calls")
    .update({ status: "completed" })
    .eq("id", roundId)
    .eq("host_user_id", userId)
    .in("status", ["open", "full"])
    .select("id,status")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id === roundId && data?.status === "completed";
}
