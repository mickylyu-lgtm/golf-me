// The Wikimedia matching rules now live in supabase/functions/_shared so the
// course-photos Edge Function and the browser (demo accounts) apply exactly
// the same rules. Re-exported here so existing imports keep working.
export * from "../../supabase/functions/_shared/coursePhotoMatch.ts";
