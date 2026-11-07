import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useModeration } from "../context/ModerationContext";

// Admin dashboard data for moderation (migration 20261107270000): removed
// posts/comments, suspensions, the audit log. Admin-only RPCs; nothing is
// asked until my_moderation_status() says the migration is applied and the
// caller is an admin.

export interface RemovedContentRow {
  kind: "post" | "comment";
  id: string;
  post_id: string;
  author_id: string;
  author_name: string | null;
  author_username: string | null;
  text: string;
  created_at: string;
  removed_at: string;
  removed_reason: string;
  removed_by: string | null;
  removed_by_name: string | null;
}

export interface SuspensionRow {
  user_id: string;
  name: string | null;
  username: string | null;
  suspended_at: string;
  suspended_until: string | null;
  reason: string;
  hide_content: boolean;
  active: boolean;
  suspended_by: string | null;
  suspended_by_name: string | null;
}

export interface ModerationActionRow {
  id: number;
  created_at: string;
  admin_id: string | null;
  admin_name: string | null;
  action: string;
  target_type: string;
  target_id: string;
  target_user_id: string | null;
  target_name: string | null;
  target_username: string | null;
  reason: string | null;
  note: string | null;
  details: Record<string, unknown>;
}

export function useModerationAdminData() {
  const { available, isAdmin } = useModeration();
  const enabled = available && isAdmin;
  const [removed, setRemoved] = useState<RemovedContentRow[]>([]);
  const [suspensions, setSuspensions] = useState<SuspensionRow[]>([]);
  const [actions, setActions] = useState<ModerationActionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const [r, s, a] = await Promise.all([
      supabase.rpc("admin_list_removed_content", { p_limit: 200 }),
      supabase.rpc("admin_list_suspensions"),
      supabase.rpc("admin_list_moderation_actions", { p_limit: 50 }),
    ]);
    const firstError = r.error ?? s.error ?? a.error;
    if (firstError) console.error("GolfMe: moderation lists failed.", firstError);
    setError(firstError ? firstError.message : null);
    if (!r.error) setRemoved((r.data ?? []) as RemovedContentRow[]);
    if (!s.error) setSuspensions((s.data ?? []) as SuspensionRow[]);
    if (!a.error) setActions((a.data ?? []) as ModerationActionRow[]);
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    enabled,
    removed,
    suspensions,
    actions,
    error,
    reload,
    isRemoved: (id: string | null | undefined) => Boolean(id) && removed.some((x) => x.id === id),
    isSuspended: (userId: string | null | undefined) => Boolean(userId) && suspensions.some((x) => x.user_id === userId && x.active),
  };
}

export type ModerationAdminData = ReturnType<typeof useModerationAdminData>;
