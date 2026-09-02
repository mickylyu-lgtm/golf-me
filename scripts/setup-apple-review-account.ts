// One-time (but safe-to-rerun) setup for Apple's App Review demo account.
// Rejected under Guideline 2.1(a) because reviewers had no working way in:
// GolfMe's only sign-in methods are Google OAuth (reviewers won't link a
// real Google account) and magic-link email (reviewers have no inbox
// access to apple-review@golfme.app). This script provisions a real
// Supabase Auth user with a fixed password instead — src/pages/Auth.tsx
// now has a matching "Sign in with a password" option for it to use.
//
// Uses the Admin API (never a raw `insert into auth.users`) so password
// hashing, identities, and email-confirmation state all end up in whatever
// shape GoTrue actually expects — hand-rolling that via SQL is exactly the
// kind of thing that produces a user who "exists" but can't log in.
//
// Run locally (never in CI, never with the key committed anywhere):
//   SUPABASE_SERVICE_ROLE_KEY=<service_role key from Supabase dashboard, Settings > API> npx tsx scripts/setup-apple-review-account.ts
//
// VITE_SUPABASE_URL is read from .env.local (already present for the app
// itself) via a tiny manual parse below, since this script runs outside
// Vite and doesn't have import.meta.env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const REVIEW_EMAIL = "apple-review@golfme.app";
const REVIEW_PASSWORD = "GolfMeAppleReview2026!";
// An existing, unrelated seeded golfer to be the reviewer's one DM
// conversation partner — deliberately not Micky's own account, which was
// just wiped clean of activity history for the TestFlight demo.
const CHAT_PARTNER_ID = "c790590e-e48b-4fee-a0e1-fc857a25f3b1"; // Gordon Chen

function readEnvLocal(key: string): string | undefined {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const line = text.split("\n").find((l) => l.trim().startsWith(`${key}=`));
    return line?.split("=").slice(1).join("=").trim();
  } catch {
    return undefined;
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? readEnvLocal("VITE_SUPABASE_URL");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error("Missing VITE_SUPABASE_URL (checked env and .env.local).");
  process.exit(1);
}
if (!serviceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY. Run with:");
  console.error("  SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/setup-apple-review-account.ts");
  console.error("Find the key in the Supabase dashboard: Settings > API > service_role secret.");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function findExistingUserId(email: string): Promise<string | null> {
  // No admin.getUserByEmail in this SDK version -- list-and-find. Fine at
  // this project's current user count; revisit with pagination if it ever
  // grows past a single page.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function main() {
  console.log(`Setting up Apple App Review account: ${REVIEW_EMAIL}`);

  let userId = await findExistingUserId(REVIEW_EMAIL);
  if (userId) {
    console.log("Existing auth user found — updating password + confirming email.");
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: REVIEW_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
  } else {
    console.log("No existing auth user — creating one.");
    const { data, error } = await admin.auth.admin.createUser({
      email: REVIEW_EMAIL,
      password: REVIEW_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    // handle_new_user() trigger already inserted a stub public.profiles
    // row (id only) at this point -- the upsert below fills it in.
  }

  console.log(`Auth user id: ${userId}`);

  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    name: "Apple Review",
    username: "apple_review",
    bio: "Demo account for GolfMe App Review",
    area_label: "New York, NY",
    playing_area_lat: 40.7128,
    playing_area_lng: -74.006,
    handicap: 15,
    skill_level: "Intermediate",
    avatar_color: "from-sky-400 to-blue-600",
    avatar_initials: "AR",
    round_length_preference: "18 Holes",
    group_type_preference: "Mixed / Anyone",
    game_format_preference: "No Preference",
    gender_preference: "No preference",
    networking_preference: "No Preference",
    has_onboarded: true,
    onboarding_tutorial_completed: true,
    email_verified: true,
  });
  if (profileError) throw profileError;
  console.log("Profile upserted: name, area, handicap, skill level, onboarding complete.");

  // Idempotent DM seed -- reuses the exact shape get_or_create_dm_conversation()
  // would produce (that RPC itself relies on auth.uid(), which is null under
  // the service-role client, so it's replicated directly here instead).
  const { data: existingParticipant } = await admin
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  let conversationId = existingParticipant?.conversation_id as string | undefined;
  if (!conversationId) {
    const { data: conv, error: convError } = await admin.from("conversations").insert({}).select("id").single();
    if (convError) throw convError;
    conversationId = conv.id;
    const { error: partError } = await admin.from("conversation_participants").insert([
      { conversation_id: conversationId, user_id: userId },
      { conversation_id: conversationId, user_id: CHAT_PARTNER_ID },
    ]);
    if (partError) throw partError;
    const { error: msgError } = await admin.from("messages").insert([
      { conversation_id: conversationId, sender_id: CHAT_PARTNER_ID, text: "Hey! Saw you're new — welcome to GolfMe." },
      { conversation_id: conversationId, sender_id: userId, text: "Thanks! Excited to check out a round this weekend." },
      { conversation_id: conversationId, sender_id: CHAT_PARTNER_ID, text: "Nice, there are a few open foursomes on Play right now." },
    ]);
    if (msgError) throw msgError;
    console.log("Seeded one DM conversation with 3 messages.");
  } else {
    console.log("DM conversation already exists — left as is.");
  }

  console.log("\nDone. Summary:");
  console.log(`  Auth user:        ${REVIEW_EMAIL} (password set, email confirmed)`);
  console.log(`  Profile:          complete, onboarding marked done`);
  console.log(`  Chat:             1 conversation seeded (or already present)`);
  console.log(`  Community/Play:   uses existing global content (RLS allows any authenticated user to read it) -- nothing to seed`);
  console.log(`  Caddie:           left empty on purpose -- no real swing video to legitimately analyze, and the app never fabricates analysis results`);
}

main().catch((err) => {
  console.error("Setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
