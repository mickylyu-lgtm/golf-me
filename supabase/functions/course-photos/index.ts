// course-photos Edge Function: wiring only (logic + rules in handler.ts).
//
// Secrets (Supabase function secrets, never VITE_ variables):
//   GOOGLE_PLACES_API_KEY  optional; unset -> Google is skipped, Wikimedia
//                          only. Restrict it to "Places API (New)".
//   GEOAPIFY_API_KEY       already set for course-search; used here for one
//                          Place Details call per course (its outline).
//   COURSE_PHOTOS_DAILY_TEXT_SEARCH_CAP / _DETAILS_CAP / _PHOTO_CAP /
//   _WIKIMEDIA_CAP / _GEOAPIFY_DETAILS_CAP / _OVERPASS_CAP
//                          optional overrides of the daily caps.
//   COURSE_PHOTOS_DAILY_OVERPASS_LAYOUT_CAP (default 40) /
//   COURSE_PHOTOS_DAILY_USGS_EXPORT_CAP (default 300)
//                          caps for the course page detail (layout, NAIP
//                          picture), each made once per course then stored.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided
// by the platform. The service role is used only for public.course_imagery
// and the quota function, which no client can reach.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleRequest, type ImageryRow, type Store } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const PICTURE_BUCKET = "course-imagery";
const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const store: Store = {
  async courses(ids) {
    const [courses, external] = await Promise.all([
      admin.from("courses").select("id, name, latitude, longitude").in("id", ids),
      admin.from("course_external_ids").select("course_id, external_id").eq("provider", "geoapify").in("course_id", ids),
    ]);
    if (courses.error) throw new Error(courses.error.message);
    // A course without its Geoapify id just skips the Place Details outline.
    const placeIds = new Map((external.error ? [] : (external.data ?? [])).map((r) => [r.course_id as string, r.external_id as string]));
    return (courses.data ?? []).map((c) => ({ ...c, geoapify_place_id: placeIds.get(c.id) ?? null }));
  },
  async imagery(ids) {
    const { data, error } = await admin.from("course_imagery").select("*").in("course_id", ids);
    if (error) throw new Error(error.message);
    return (data ?? []) as ImageryRow[];
  },
  async saveImagery(row) {
    const { error } = await admin.from("course_imagery").upsert(row, { onConflict: "course_id" });
    if (error) throw new Error(error.message);
  },
  async takeQuota(provider, cap, cost = 1) {
    const { data, error } = await admin.rpc("course_imagery_take_quota", { p_provider: provider, p_cap: cap, p_cost: cost });
    if (error) throw new Error(error.message);
    return data === true;
  },
  async uploadPicture(path, bytes) {
    // Public bucket (20261107190000), service role only writes. The path is
    // versioned per outline + size, so the object can be cached as immutable.
    const { error } = await admin.storage.from(PICTURE_BUCKET).upload(path, bytes, { contentType: "image/jpeg", cacheControl: "31536000", upsert: true });
    if (error) throw new Error(error.message);
  },
  publicPictureUrl(path) {
    return admin.storage.from(PICTURE_BUCKET).getPublicUrl(path).data.publicUrl;
  },
};

Deno.serve((req: Request) =>
  handleRequest(req, {
    fetch: (input, init) => fetch(input, init),
    env: (name) => Deno.env.get(name),
    store,
    now: () => new Date(),
    log: (message, data) => console.error(message, data ?? {}),
    // A slow layout lookup finishes (and is stored) after the response.
    // (Read off globalThis: the edge-runtime.d.ts import doesn't declare it
    // for a plain `deno check`; Supabase's runtime always has it.)
    background: (p) => (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(p),
    async authenticate(r) {
      const authHeader = r.headers.get("Authorization") ?? "";
      if (!authHeader) return false;
      const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
      const { data, error } = await caller.auth.getUser();
      return !error && Boolean(data.user);
    },
  }),
);
