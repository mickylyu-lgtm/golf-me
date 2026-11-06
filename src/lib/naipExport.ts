// The NAIP Plus picture rules live in supabase/functions/_shared/naipExport.ts
// so course-photos (which renders and stores the picture once per course)
// and the browser (demo / fallback) build the very same request.
export * from "../../supabase/functions/_shared/naipExport.ts";
