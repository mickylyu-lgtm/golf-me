-- Roboflow pose-analysis integration: analyze-swing now runs a Roboflow
-- six-phase pose workflow over sampled video frames BEFORE calling Gemini,
-- and feeds Gemini that trusted, filtered pose/metrics data instead of
-- relying on Gemini's own coarse (~1fps) video sampling alone. This column
-- preserves Roboflow's own raw filtered output separately from Gemini's
-- coaching output (analysis_json) so the two layers stay independently
-- inspectable/debuggable, per product brief point 13 ("preserve both
-- layers"). Reuses the existing analysis_json column for Gemini's output
-- rather than adding a second one for that.
alter table public.caddie_analyses
  add column roboflow_analysis_json jsonb;

comment on column public.caddie_analyses.roboflow_analysis_json is
  'Filtered, per-frame pose/body-metrics output from the Roboflow six-phase workflow (golf-swing-six-phase-analysis), one entry per sampled frame. Null for analyses that predate this pipeline or that failed before the Roboflow step. Never contains raw unreliable/unavailable metrics — those are already filtered out before this is written. Covered by the same owner-only RLS as every other column here.';
