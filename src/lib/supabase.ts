import { createClient } from "@supabase/supabase-js";

// golfme-dev only — this project has no production Supabase backend yet.
// The deployed Vercel site still runs entirely on the mocked/localStorage
// DataContext; nothing reads these env vars there. Anon/publishable keys
// are meant to be public (this is not a secret) — access control lives in
// Postgres RLS policies, never in keeping this key hidden. The
// service_role key is never fetched or referenced anywhere in this
// codebase; it has no business existing in frontend code.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill in the golfme-dev project values.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
