import type { CourseTeeRating, CourseTeeRatings, TeeRatingSet } from "./contract.ts";

type Row = Record<string, unknown>;
const asRow = (value: unknown): Row | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;

const APP_ORIGINS = new Set(["https://golfme.app", "https://www.golfme.app"]);
const CANONICAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_ID = /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/;
const MAX_TEES_PER_GROUP = 32;
const MAX_CACHE_ENTRIES = 64;
const MAX_PARALLEL_REQUESTS = 5;
const CACHE_MS = 24 * 60 * 60 * 1000;
const EMPTY_CACHE_MS = 30 * 60 * 1000;
export const DETAIL_DAILY_CAP = 5;

const REVIEW_MAX_COURSES = 8;
const REVIEW_MAX_TEES = 32;
const REVIEW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const segments = ["overall", "front", "back"] as const;
const fields = ["course", "slope", "bogey"] as const;
type TeeMetric = typeof fields[number];

interface ReviewedCourse {
  providerId: string;
  source: NonNullable<CourseTeeRatings["source"]>;
  reviewedAt: number;
  expiresAt: number;
  tees: CourseTeeRating[];
}

function teeName(value: unknown): string {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) return "";
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  return name.length <= 100 ? name : "";
}

function teeKey(tee: CourseTeeRating): string {
  return JSON.stringify([tee.name.toLowerCase(), tee.group, tee.holes]);
}

function rating(value: unknown, field: TeeMetric): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const [min, max, scale] = field === "slope" ? [55, 155, 1] : field === "course" ? [1, 120, 10] : [1, 180, 10];
  if (value < min || value > max) return null;
  // Do not round a contradictory, higher-precision value into agreement.
  const units = value * scale;
  const nearest = Math.round(units);
  if (Math.abs(units - nearest) > Number.EPSILON * Math.max(1, units) * 2) return null;
  return nearest / scale;
}

function ratingSet(row: Row, prefix = ""): TeeRatingSet {
  return {
    course: rating(row[prefix + "course_rating"], "course"),
    slope: rating(row[prefix + "slope_rating"], "slope"),
    bogey: rating(row[prefix + "bogey_rating"], "bogey"),
  };
}

const hasRatings = (tee: CourseTeeRating) => segments.some((segment) => fields.some((field) => tee[segment][field] !== null));

function publicSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 512 || !/^https:\/\//.test(raw) || /[\s\\\p{Cc}\p{Cf}]/u.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    // Provenance is established by human review, not an arbitrary link being
    // syntactically valid. Never accept local links or URLs carrying tokens.
    if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname) ||
        /\.(internal|localhost|local|test|invalid|example)$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseOfficialTee(raw: unknown): CourseTeeRating | null {
  const row = asRow(raw);
  const name = teeName(row?.name);
  if (!row || !name || (row.group !== "men" && row.group !== "women") || (row.holes !== 9 && row.holes !== 18)) return null;
  const tee: CourseTeeRating = { name, group: row.group, holes: row.holes, overall: ratingSet({}), front: ratingSet({}), back: ratingSet({}) };
  for (const segment of segments) {
    if (row[segment] == null) continue;
    const set = asRow(row[segment]);
    if (!set || Object.keys(set).some((key) => key !== "course" && key !== "slope" && key !== "bogey")) return null;
    for (const field of fields) {
      const value = set[field];
      if (value == null) continue;
      if (segment === "back" && row.holes === 9) return null;
      const parsed = rating(value, field);
      if (parsed === null) return null;
      tee[segment][field] = parsed;
    }
  }
  return hasRatings(tee) ? tee : null;
}

// Current external mapping RPCs accept values from authenticated callers.
// The independent, server-only review also checks exact official ratings.
// Config shape { [canonical UUID]: { providerId, sourceUrl, reviewedOn, tees } }.
export function reviewedCourseReferences(raw: string | undefined): ReadonlyMap<string, ReviewedCourse> {
  if (!raw || new TextEncoder().encode(raw).length > 32000) return new Map();
  try {
    const value = asRow(JSON.parse(raw));
    if (!value) return new Map();
    const entries = Object.entries(value);
    if (entries.length > REVIEW_MAX_COURSES) return new Map();
    const result = new Map<string, ReviewedCourse>();
    const seen = new Set<string>();
    for (const [rawCourseId, rawEntry] of entries) {
      const courseId = rawCourseId.toLowerCase();
      const entry = asRow(rawEntry);
      const providerId = entry?.providerId;
      const reviewedOn = entry?.reviewedOn;
      const url = publicSourceUrl(entry?.sourceUrl);
      if (!entry || !CANONICAL_ID.test(courseId) || typeof providerId !== "string" || !PROVIDER_ID.test(providerId) ||
          result.has(courseId) || seen.has(providerId) || !url || typeof reviewedOn !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(reviewedOn) || !Array.isArray(entry.tees) ||
          !entry.tees.length || entry.tees.length > REVIEW_MAX_TEES) return new Map();
      const reviewedAt = Date.parse(`${reviewedOn}T00:00:00Z`);
      if (!Number.isFinite(reviewedAt) || new Date(reviewedAt).toISOString().slice(0, 10) !== reviewedOn) return new Map();
      const tees: CourseTeeRating[] = [];
      const keys = new Set<string>();
      for (const rawTee of entry.tees) {
        const tee = parseOfficialTee(rawTee);
        if (!tee || keys.has(teeKey(tee))) return new Map();
        keys.add(teeKey(tee));
        tees.push(tee);
      }
      result.set(courseId, { providerId, source: { url, reviewedOn }, reviewedAt,
        expiresAt: reviewedAt + (REVIEW_DAYS + 1) * DAY_MS, tees });
      seen.add(providerId);
    }
    return result;
  } catch {
    return new Map();
  }
}

function currentlyReviewed(review: ReviewedCourse, now: number): boolean {
  return now >= review.reviewedAt && now < review.expiresAt;
}

export function normalizeCourseTeeRatings(raw: unknown, expectedId: string): CourseTeeRatings {
  // The official OpenAPI GET response is the Course object itself.
  const course = asRow(raw);
  if (!course || typeof course.id !== "string" || !PROVIDER_ID.test(course.id) || course.id !== expectedId) {
    throw new Error("unexpected_course_detail");
  }
  const groups = asRow(course.tees);
  const tees: CourseTeeRating[] = [];
  for (const [key, group] of [["male", "men"], ["female", "women"]] as const) {
    const rows = groups?.[key];
    // Do not accept a duplicate after a truncated prefix.
    if (!Array.isArray(rows) || rows.length > MAX_TEES_PER_GROUP) continue;
    for (const candidate of rows) {
      const row = asRow(candidate);
      const name = teeName(row?.tee_name);
      if (!row || !name || (row.number_of_holes !== 9 && row.number_of_holes !== 18)) continue;
      const holes = row.number_of_holes;
      // Keep named empty rows during verification: they can prove ambiguity.
      tees.push({ name, group, holes, overall: ratingSet(row), front: ratingSet(row, "front_"),
        back: ratingSet(holes === 9 ? {} : row, "back_") });
    }
  }
  return { tees };
}

export function verifyCourseTeeRatings(vendor: CourseTeeRatings, official: ReviewedCourse): CourseTeeRatings | null {
  const vendorByKey = new Map<string, CourseTeeRating | null>();
  for (const tee of vendor.tees) {
    const key = teeKey(tee);
    vendorByKey.set(key, vendorByKey.has(key) ? null : tee);
  }
  const tees: CourseTeeRating[] = [];
  for (const reviewed of official.tees) {
    const incoming = vendorByKey.get(teeKey(reviewed));
    if (!incoming) continue;
    const verified: CourseTeeRating = { name: reviewed.name, group: reviewed.group, holes: reviewed.holes,
      overall: ratingSet({}), front: ratingSet({}), back: ratingSet({}) };
    for (const segment of segments) {
      if (segment === "back" && reviewed.holes === 9) continue;
      for (const field of fields) {
        const expected = reviewed[segment][field];
        if (expected !== null && expected === incoming[segment][field]) verified[segment][field] = expected;
      }
    }
    if (hasRatings(verified)) tees.push(verified);
  }
  return tees.length ? { tees, source: official.source } : null;
}

class InvalidBody extends Error {}

async function boundedJson(body: ReadableStream<Uint8Array> | null, max: number): Promise<unknown> {
  if (!body) throw new InvalidBody();
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let count = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > max) {
        void reader.cancel().catch(() => {});
        throw new InvalidBody();
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new InvalidBody();
  } finally {
    reader.releaseLock();
  }
}

type DetailResult = CourseTeeRatings | null | "temporarily_unavailable";
interface Dependencies {
  enabled(): boolean;
  authorize(req: Request): Promise<boolean>;
  consumeCallerBudget(req: Request, headers: Record<string, string>): Promise<Response | null>;
  reviewedCourses: ReadonlyMap<string, ReviewedCourse>;
  lookupMappedId(req: Request, courseId: string): Promise<string | null>;
  takeDetailQuota(): Promise<boolean>;
  fetchDetail(providerId: string): Promise<Response>;
  now(): number;
}

export function createCourseTeeRatingsHandler(deps: Dependencies) {
  // This bounded private warm-worker cache is not a quota counter; replicas
  // can disagree on hit/miss and the atomic server ledger counts every miss.
  const cached = new Map<string, { payload: CourseTeeRatings | null; expires: number }>();
  const inFlight = new Map<string, Promise<DetailResult>>();
  async function load(review: ReviewedCourse): Promise<DetailResult> {
    const { providerId } = review;
    try {
      if (!currentlyReviewed(review, deps.now())) return null;
      if (!await deps.takeDetailQuota()) return "temporarily_unavailable";
      const response = await deps.fetchDetail(providerId);
      if (response.status !== 404 && !response.ok) {
        void response.body?.cancel().catch(() => {});
        return "temporarily_unavailable";
      }
      if (response.status === 404) void response.body?.cancel().catch(() => {});
      const contents = response.status === 404 ? null : normalizeCourseTeeRatings(await boundedJson(response.body, 512 * 1024), providerId);
      const payload = contents ? verifyCourseTeeRatings(contents, review) : null;
      if (cached.size >= MAX_CACHE_ENTRIES) {
        const oldest = cached.keys().next();
        if (!oldest.done) cached.delete(oldest.value);
      }
      cached.set(providerId, { payload, expires: deps.now() + (payload ? CACHE_MS : EMPTY_CACHE_MS) });
      return payload;
    } catch {
      return "temporarily_unavailable";
    }
  }

  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("Origin");
    const headers = {
      ...(origin && APP_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      Vary: "Origin",
    };
    const reply = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers });
    if (origin && !APP_ORIGINS.has(origin)) return reply(403, { error: "not_allowed" });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return reply(405, { error: "not_allowed" });
    if (!/^Bearer \S+$/i.test(req.headers.get("Authorization") ?? "")) return reply(401, { error: "not_authenticated" });
    try {
      if (!await deps.authorize(req)) return reply(401, { error: "not_authenticated" });
      const body = asRow(await boundedJson(req.body, 512));
      if (!body || Object.keys(body).length !== 1 || typeof body.courseId !== "string" || !CANONICAL_ID.test(body.courseId)) {
        return reply(400, { error: "invalid_course" });
      }
      if (!deps.enabled()) return reply(503, { error: "ratings_unavailable" });
      const courseId = body.courseId.toLowerCase();
      const review = deps.reviewedCourses.get(courseId);
      if (!review || !currentlyReviewed(review, deps.now())) return reply(200, null);
      const { providerId } = review;
      const limited = await deps.consumeCallerBudget(req, headers);
      if (limited) return limited;
      if (await deps.lookupMappedId(req, courseId) !== providerId || !currentlyReviewed(review, deps.now())) return reply(200, null);

      const entry = cached.get(providerId);
      if (entry && entry.expires > deps.now()) {
        cached.delete(providerId);
        cached.set(providerId, entry);
        return reply(200, entry.payload);
      }
      if (entry) cached.delete(providerId);
      let pending = inFlight.get(providerId);
      if (!pending) {
        if (inFlight.size >= MAX_PARALLEL_REQUESTS) return reply(503, { error: "ratings_unavailable" });
        pending = load(review).finally(() => { inFlight.delete(providerId); });
        inFlight.set(providerId, pending);
      }
      const payload = await pending;
      if (!currentlyReviewed(review, deps.now())) return reply(200, null);
      return payload === "temporarily_unavailable"
        ? reply(503, { error: "ratings_unavailable" })
        : reply(200, payload);
    } catch (error) {
      return error instanceof InvalidBody
        ? reply(400, { error: "invalid_course" })
        : reply(503, { error: "ratings_unavailable" });
    }
  };
}
