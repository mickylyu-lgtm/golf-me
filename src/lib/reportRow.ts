// The public.reports row a report becomes, and the fallback for a database
// that doesn't have the post/comment columns yet. Post and comment reports
// used to reach moderation with no reference to the content at all (only a
// round id was ever forwarded). reported_post_id / reported_comment_id come
// from a migration that may not be applied yet when this code ships, so a
// "column doesn't exist" error retries once without them, with the ids kept
// in the details text instead. No Supabase/React imports: tests/reportRow.test.ts.

export interface ReportTarget {
  golfCallId?: string;
  postId?: string;
  commentId?: string;
  messageId?: string;
}

export interface ReportRowInput extends ReportTarget {
  reporterId: string;
  reportedUserId: string;
  category: string;
  details: string;
  context: string;
}

export function reportRow(input: ReportRowInput, withContentColumns: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    reporter_id: input.reporterId,
    reported_user_id: input.reportedUserId,
    round_id: input.golfCallId ?? null,
    reported_message_id: input.messageId ?? null,
    category: input.category,
    details: input.details,
    context: input.context,
  };
  if (withContentColumns) {
    row.reported_post_id = input.postId ?? null;
    row.reported_comment_id = input.commentId ?? null;
  } else {
    const refs = [input.postId && `post ${input.postId}`, input.commentId && `comment ${input.commentId}`].filter(Boolean);
    if (refs.length) row.details = `${input.details}${input.details ? "\n" : ""}[${refs.join(", ")}]`;
  }
  return row;
}

// PostgREST "column not found in the schema cache" (PGRST204) or Postgres
// undefined_column (42703).
export function isMissingColumnError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "PGRST204" || err.code === "42703" || /reported_(post|comment)_id/.test(err.message ?? "");
}
