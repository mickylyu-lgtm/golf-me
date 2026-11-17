import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostRow } from "./communityPostRow.ts";
import { isShareablePostId } from "./postShare.ts";

// No service key, RPC, public preview or relaxed permissions: null is the
// same result for nonexistent, removed, blocked and RLS-inaccessible posts.
export async function readSharedCommunityPost(client: SupabaseClient, id: string): Promise<PostRow | null> {
  if (!isShareablePostId(id)) return null;
  const { data, error } = await client.from("community_posts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as PostRow | null;
}
