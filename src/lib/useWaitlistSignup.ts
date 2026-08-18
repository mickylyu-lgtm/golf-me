import { useState } from "react";
import { supabase } from "./supabase";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type WaitlistOutcome = "success" | "duplicate" | "invalid-email" | "missing-region" | "error";

// Deliberately never chains .select() on the insert — waitlist_signups has
// no SELECT policy for anon at all (by design, see the migration comment:
// nobody, including the person who just signed up, can read the table
// back through the API). Postgres's RLS also enforces the SELECT policy
// against an INSERT ... RETURNING's output, so requesting the row back
// would fail even for a successful insert — confirmed live via a direct
// REST call before writing this hook, not assumed. Success is just "no
// error was thrown", which is all the UI needs.
export function useWaitlistSignup() {
  const [submitting, setSubmitting] = useState(false);

  async function submit(email: string, homeRegion: string, referralSource: string | null): Promise<WaitlistOutcome> {
    const trimmedEmail = email.trim();
    const trimmedRegion = homeRegion.trim();
    if (!EMAIL_RE.test(trimmedEmail)) return "invalid-email";
    if (!trimmedRegion) return "missing-region";

    setSubmitting(true);
    const { error } = await supabase.from("waitlist_signups").insert({
      email: trimmedEmail,
      home_region: trimmedRegion,
      referral_source: referralSource?.trim() || null,
    });
    setSubmitting(false);

    if (!error) return "success";
    if (error.code === "23505") return "duplicate"; // unique_violation on normalized_email
    if (error.code === "23514") return "invalid-email"; // check_violation — the DB's own email format check
    console.error("Golf Me: waitlist signup failed.", error);
    return "error";
  }

  return { submit, submitting };
}
