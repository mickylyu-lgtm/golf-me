// Installed app only. No schema/permissions changes and off unless explicitly
// enabled after plan/usage, account terms and combined provider limits review.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { budgetResponse, consumeRequestBudget } from "../_shared/requestBudget.ts";
import { createCourseTeeRatingsHandler, DETAIL_DAILY_CAP, reviewedCourseReferences } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const vendorKey = Deno.env.get("GOLF_COURSE_API_KEY");
const reviewedCourses = reviewedCourseReferences(Deno.env.get("COURSE_TEE_RATINGS_REVIEWED_COURSES"));
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const caller = (req: Request) => createClient(url, anonKey, {
  global: { headers: { Authorization: req.headers.get("Authorization")! } },
  auth: { persistSession: false },
});

Deno.serve(createCourseTeeRatingsHandler({
  enabled: () => Deno.env.get("COURSE_TEE_RATINGS_ENABLED") === "true" && !!vendorKey && reviewedCourses.size > 0,
  reviewedCourses,
  async authorize(req) {
    const { data, error } = await caller(req).auth.getUser();
    return !error && !!data.user && !data.user.is_anonymous;
  },
  async consumeCallerBudget(req, headers) {
    // Existing per-account budget; disabled and non-pilot requests are not charged.
    return budgetResponse(await consumeRequestBudget(caller(req), "course-enrich"), headers);
  },
  async lookupMappedId(req, courseId) {
    const { data, error } = await caller(req).from("course_external_ids")
      .select("external_id").eq("course_id", courseId).eq("provider", "golfcourseapi").limit(2)
      .abortSignal(AbortSignal.timeout(5000));
    if (error) throw new Error("mapping_unavailable");
    // Schema guarantees provider ID uniqueness, not one provider ID per
    // canonical course. Multiple results are ambiguous; never pick one.
    return data?.length === 1 && typeof data[0].external_id === "string" ? data[0].external_id : null;
  },
  async takeDetailQuota() {
    // Existing atomic, cross-replica, UTC-day counter. This reserved detail
    // slice does NOT measure the preexisting name-search path or other use of
    // the key. Leave opt-in off until the combined allowance is reviewed.
    const { data, error } = await admin.rpc("course_imagery_take_quota", {
      p_provider: "golfcourseapi_tee_detail", p_cap: DETAIL_DAILY_CAP, p_cost: 1,
    }).abortSignal(AbortSignal.timeout(5000));
    return !error && data === true;
  },
  fetchDetail(providerId) {
    return fetch(`https://api.golfcourseapi.com/v1/courses/${providerId}`, {
      headers: { Authorization: `Key ${vendorKey}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(6000),
    });
  },
  now: Date.now,
}));
