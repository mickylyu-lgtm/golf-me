// The swing measurement now lives in supabase/functions/_shared so the
// analyze-swing Edge Function computes exactly the verdicts the client
// shows (see _shared/caddieVerdicts.ts). Re-exported here so existing
// imports keep working.
export * from "../../supabase/functions/_shared/swingAssessment.ts";
