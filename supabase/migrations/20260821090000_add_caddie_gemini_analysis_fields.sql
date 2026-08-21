-- Gemini-backed Caddie analysis: extends caddie_analyses (previously
-- schema-only scaffolding, see 20260817090000 — no real provider existed
-- yet) with the structured fields a real provider response carries that the
-- original flat strengths/issues/recommendations/drills columns can't hold:
-- per-issue confidence, a single prioritized focus + drill, visible-vs-
-- uncertain limitations, and which camera angle was used (face-on vs
-- down-the-line changes what's a fair claim to make about a swing).
--
-- analysis_json is the source of truth for a real row going forward;
-- strengths/issues/recommendations/drills stay populated too (derived from
-- it at write time by the analyze-swing Edge Function) so every existing
-- UI/query path keeps working unmodified — this is purely additive.
--
-- No RLS changes needed: these are plain columns on an already fully-RLS'd
-- table (owner-only select/insert/update/delete, see 20260817090000 and
-- 20260817091500's ownership trigger), so the existing policies already
-- cover them.
alter table public.caddie_analyses
  add column analysis_json jsonb,
  add column camera_angle text check (camera_angle in ('face_on', 'down_the_line', 'other', 'uncertain')),
  add column model text,
  add column error_message text;

comment on column public.caddie_analyses.analysis_json is
  'Full structured Gemini response: summary, strengths, work_on[{issue,why_it_matters,confidence}], focus{title,instruction}, drill{name,steps}, limitations[]. Null until status=complete.';
comment on column public.caddie_analyses.camera_angle is
  'Gemini''s own assessment of the source video''s camera angle — influences which feedback categories are treated as fair claims. Null until status=complete.';
comment on column public.caddie_analyses.model is
  'Which Gemini model produced analysis_json, e.g. gemini-2.5-flash. Kept per-row so a future model change is auditable against old rows, not just documented in code.';
comment on column public.caddie_analyses.error_message is
  'Safe, non-sensitive failure summary for status=failed rows (never the raw provider error/stack, never logged with request bodies) — covered by the same owner-only RLS as every other column here.';
