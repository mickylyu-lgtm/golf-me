import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostRow, MediaRow } from "./communityPostRow.ts";
import { appendPage, cursorAfter, compareRowsDesc, type FeedCursor } from "./followingFeed.ts";
export const COMMUNITY_PAGE_SIZE = 20;
export interface CommunityCommentRow {
    id: string;
    post_id: string;
    author_id: string;
    text: string;
    parent_comment_id: string | null;
    created_at: string;
}
export interface CommunityDetails {
    media: MediaRow[];
    comments: CommunityCommentRow[];
    postVotes: {
        post_id: string;
        voter_id: string;
    }[];
    commentVotes: {
        comment_id: string;
        voter_id: string;
    }[];
    saved: {
        post_id: string;
    }[];
    hidden: {
        post_id: string;
    }[];
}
// Values come from database rows, never free-form search input. Preserve full
// timestamp precision: truncating to JS milliseconds can skip tied posts.
export function communityBefore(cursor: FeedCursor): string {
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.before) || !/^[0-9a-f-]{36}$/i.test(cursor.beforeId))
        throw new Error("Invalid community cursor");
    return `created_at.lt.${cursor.before},and(created_at.eq.${cursor.before},id.lt.${cursor.beforeId})`;
}
export async function readCommunityPage(client: SupabaseClient, cursor: FeedCursor): Promise<PostRow[]> {
    const { data, error } = await client.from("community_posts").select("*").order("created_at", { ascending: false }).order("id", { ascending: false }).or(communityBefore(cursor)).limit(COMMUNITY_PAGE_SIZE);
    if (error)
        throw error;
    return (data ?? []) as PostRow[];
}
// Re-read through the previously loaded floor on refresh, not just remembered
// ids: restored posts inside that range must return, removed rows must disappear.
export async function refreshCommunityRange(client: SupabaseClient, head: PostRow[], floor: FeedCursor | null): Promise<{
    posts: PostRow[];
    extra: PostRow[];
}> {
    let posts = head;
    const extra: PostRow[] = [];
    let cursor = cursorAfter(posts);
    while (cursor && floor && compareRowsDesc({ id: cursor.beforeId, created_at: cursor.before }, { id: floor.beforeId, created_at: floor.before }) < 0) {
        const page = await readCommunityPage(client, cursor);
        if (!page.length)
            break;
        const next = cursorAfter(page)!;
        if (compareRowsDesc({ id: next.beforeId, created_at: next.before }, { id: cursor.beforeId, created_at: cursor.before }) <= 0)
            throw new Error("Community page did not advance");
        extra.push(...page);
        posts = appendPage(posts, page);
        cursor = next;
    }
    return { posts, extra };
}
async function everyRow<T>(query: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: unknown;
}>): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0;;) {
        const { data, error } = await query(from, from + 199);
        if (error)
            throw error;
        const page = (data ?? []) as T[];
        rows.push(...page);
        if (!page.length)
            return rows;
        from += page.length;
    }
}
export async function readCommunityDetails(client: SupabaseClient, posts: readonly PostRow[], owner: string): Promise<CommunityDetails> {
    const out: CommunityDetails = { media: [], comments: [], postVotes: [], commentVotes: [], saved: [], hidden: [] };
    const ids = [...new Set(posts.map(p => p.id))];
    for (let start = 0; start < ids.length; start += 20) {
        const batch = ids.slice(start, start + 20);
        const [media, comments, postVotes, saved, hidden] = await Promise.all([
            everyRow<MediaRow>((a, b) => client.from('community_post_media').select('*').in('post_id', batch).order('id').range(a, b)),
            everyRow<CommunityCommentRow>((a, b) => client.from('community_comments').select('*').in('post_id', batch).order('created_at').order('id').range(a, b)),
            everyRow<{
                post_id: string;
                voter_id: string;
            }>((a, b) => client.from('community_post_votes').select('post_id, voter_id').in('post_id', batch).order('post_id').order('voter_id').range(a, b)),
            everyRow<{
                post_id: string;
            }>((a, b) => client.from('saved_posts').select('post_id').eq('owner_id', owner).in('post_id', batch).order('post_id').range(a, b)),
            everyRow<{
                post_id: string;
            }>((a, b) => client.from('hidden_posts').select('post_id').eq('owner_id', owner).in('post_id', batch).order('post_id').range(a, b)),
        ]);
        out.media.push(...media);
        out.comments.push(...comments);
        out.postVotes.push(...postVotes);
        out.saved.push(...saved);
        out.hidden.push(...hidden);
        for (let n = 0; n < comments.length; n += 20)
            out.commentVotes.push(...await everyRow<{
                comment_id: string;
                voter_id: string;
            }>((a, b) => client.from('community_comment_votes').select('comment_id, voter_id').in('comment_id', comments.slice(n, n + 20).map(c => c.id)).order('comment_id').order('voter_id').range(a, b)));
    }
    return out;
}
export function mergeCommunityRows<T>(base: readonly T[], page: readonly T[], key: (row: T) => string): T[] { return [...new Map([...base, ...page].map(row => [key(row), row])).values()]; }
export interface CommunityReadTicket {
    owner: string;
    generation: number;
    operation: number;
}
/** Reject results across refresh/account changes; only the active operation may clear its spinner. */
export class CommunityPageGuard {
    private owner = '';
    private generation = 0;
    private operation = 0;
    private refreshTicket: CommunityReadTicket | null = null;
    private pageTicket: CommunityReadTicket | null = null;
    reset(owner: string) { this.owner = owner; this.generation++; this.refreshTicket = null; this.pageTicket = null; }
    snapshot(): CommunityReadTicket { return { owner: this.owner, generation: this.generation, operation: this.operation }; }
    current(ticket: CommunityReadTicket) { return ticket.owner === this.owner && ticket.generation === this.generation; }
    refresh() { this.generation++; this.pageTicket = null; return this.refreshTicket = { ...this.snapshot(), operation: ++this.operation }; }
    finishRefresh(ticket: CommunityReadTicket) { if (this.refreshTicket !== ticket)
        return false; this.refreshTicket = null; return true; }
    page() { if (!this.owner || this.refreshTicket || this.pageTicket)
        return null; return this.pageTicket = { ...this.snapshot(), operation: ++this.operation }; }
    finishPage(ticket: CommunityReadTicket) { if (this.pageTicket !== ticket)
        return false; this.pageTicket = null; return true; }
}
export async function readCommunityOwnedPostIds(client: SupabaseClient, table: "saved_posts" | "hidden_posts", owner: string) {
    return { data: await everyRow<{
            post_id: string;
        }>((a, b) => client.from(table).select("post_id").eq("owner_id", owner).order("post_id").range(a, b)), error: null };
}
export function applyCommunityPreferences(ids: readonly string[], pending: ReadonlyMap<string, {
    value: boolean;
}>): string[] {
    const out = new Set(ids);
    for (const [id, change] of pending) {
        if (change.value)
            out.add(id);
        else
            out.delete(id);
    }
    return [...out];
}
/** Serial writes per account/table/post; an earlier rejection never poisons the queue. */
export class CommunityPreferenceQueue {
    private writes = new Map<string, Promise<unknown>>();
    run<T>(key: string, action: () => Promise<T>): Promise<T> {
        const previous = this.writes.get(key) ?? Promise.resolve();
        const result = previous.then(action, action);
        this.writes.set(key, result);
        void result.then(() => { if (this.writes.get(key) === result)
            this.writes.delete(key); }, () => { if (this.writes.get(key) === result)
            this.writes.delete(key); });
        return result;
    }
}
