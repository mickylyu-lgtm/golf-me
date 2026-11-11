// UI hints only: the database rechecks identity, active admin role and
// suspension on every official write. Never authorize from a founder id.
export interface OfficialPostCapability {
  available: boolean;
  canPostOfficial: boolean;
}
export const OFFICIAL_POST_UNAVAILABLE: OfficialPostCapability = { available: false, canPostOfficial: false };

export function parseOfficialPostCapability(data: unknown, error?: unknown): OfficialPostCapability {
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return OFFICIAL_POST_UNAVAILABLE;
  const row = data as Record<string, unknown>;
  if (row.version !== 1 || typeof row.can_post_official !== "boolean") return OFFICIAL_POST_UNAVAILABLE;
  return { available: true, canPostOfficial: row.can_post_official };
}

export async function fetchOfficialPostCapability(
  request: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<OfficialPostCapability> {
  try {
    const { data, error } = await request();
    return parseOfficialPostCapability(data, error);
  } catch {
    return OFFICIAL_POST_UNAVAILABLE;
  }
}

export class OfficialPostPermissionError extends Error {
  constructor() {
    super("official_post_not_allowed");
    this.name = "OfficialPostPermissionError";
  }
}

export function isOfficialPostError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /official_post_(not_allowed|immutable)/.test(message);
}

/** Omit the new column for ordinary posts so an older backend still works. */
export function officialPostInsertFields(requested?: boolean): { is_official: true } | Record<string, never> {
  return requested === true ? { is_official: true } : {};
}

/** Only a persisted strict boolean is an official designation. */
export function isOfficialPostRow(row: { is_official?: unknown }): boolean {
  return row.is_official === true;
}

/** Recheck at submission, dropping an answer from an account that has changed. */
export async function requireOfficialPostCapability(
  request: () => PromiseLike<{ data: unknown; error: unknown }>,
  isCurrentAccount: () => boolean,
): Promise<void> {
  const capability = await fetchOfficialPostCapability(request);
  if (!capability.canPostOfficial || !isCurrentAccount()) throw new OfficialPostPermissionError();
}

/** The initial post insert succeeded, but attachment rollback was uncertain.
 * The caller must check the post, never blindly retry the whole publication. */
export class OfficialPostPublicationUncertainError extends Error {
  postId: string;
  constructor(postId: string) {
    super("official_post_publication_uncertain");
    this.name = "OfficialPostPublicationUncertainError";
    this.postId = postId;
  }
}

/** A post exists already. Offer a retry only after its deletion is confirmed. */
export async function rejectFailedOfficialMedia(
  postId: string,
  mediaError: { message: string },
  undo: () => PromiseLike<{ data: { id?: unknown } | null; error: unknown }>,
): Promise<never> {
  let result;
  try {
    result = await undo();
  } catch {
    throw new OfficialPostPublicationUncertainError(postId);
  }
  if (result.error || result.data?.id !== postId) throw new OfficialPostPublicationUncertainError(postId);
  throw new Error(mediaError.message);
}
