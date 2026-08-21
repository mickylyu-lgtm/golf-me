-- 0-100 swing score, replacing the "N things to work on" count on Caddie's
-- list views. Sum of 5 criteria at 20 points each — the full per-criterion
-- breakdown and reasoning lives in analysis_json.score.criteria; this flat
-- column exists purely so list views (Caddie recent list, Home's latest-
-- swing card) can show it without needing the full JSON blob.
alter table public.caddie_analyses
  add column score smallint check (score is null or (score >= 0 and score <= 100));

comment on column public.caddie_analyses.score is
  'Gemini-assigned 0-100 swing score, sum of 5 criteria at 20 points each (see analysis_json.score.criteria for the per-criterion breakdown/reasoning). Null for analyses that predate this field. Never a fabricated number: derived only from TRUSTED_POSE_DATA and the video, per the same conservative-beta rules as the rest of the analysis.';
