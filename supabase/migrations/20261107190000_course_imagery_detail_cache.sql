-- Course page detail cache (Micky, 2026-11-07: "make the overview feel
-- faster", layout fallback bug, privacy). PREPARED, NOT APPLIED.
--
-- Requires 20261106140000_add_course_imagery (course_imagery,
-- course_imagery_usage, course_imagery_take_quota) to be applied first.
--
-- Until now each browser made the two slow things itself, per device:
--   * the sharp NAIP Plus picture (one exportImage, a cold render 1.5-20 s,
--     warm only for 12 h per CloudFront edge), and
--   * the OSM layout (Overpass, 10-35 s, from two public endpoints incl.
--     maps.mail.ru, which saw each viewer's IP and the course looked at).
-- course-photos now makes each once per course and stores it:
--   1. course_imagery.layout (+ status, checked_at): the parsed, simplified
--      layout (_shared/courseLayout.ts CourseLayout v1, a few KB to ~70 KB),
--      or status 'unmapped' when OSM has nothing for the course (re-checked
--      after 7 days; a stored layout after 90). A transient failure
--      (Overpass error remark, HTTP error, timeout) is never written.
--   2. course_imagery.naip_* + the public `course-imagery` Storage bucket:
--      the rendered JPEG (~0.15-0.7 MB) at naip/v1/<course id>/<w>x<h>-<tag>.jpg
--      and the Web-Mercator box it covers.
--
-- Access: unchanged for course_imagery (RLS on, no policies, no grants to
-- anon/authenticated; only the service role, i.e. course-photos, reads and
-- writes). The bucket is PUBLIC for reading (public-domain imagery, URLs
-- handed out by course-photos; no user data in it) and has NO storage.objects
-- policies, so only the service role can write, overwrite or delete.
-- Licences: NAIP is public domain (USGS/USDA); the layout is OSM data, ODbL
-- ("© OpenStreetMap contributors" is shown with the overview).
--
-- Rollback (objects first: SQL can't delete Storage objects, empty the
-- bucket in the dashboard or with the Storage API, then):
--   delete from storage.buckets where id = 'course-imagery';
--   alter table public.course_imagery
--     drop constraint course_imagery_layout_shape,
--     drop constraint course_imagery_naip_shape,
--     drop column layout, drop column layout_status, drop column layout_checked_at,
--     drop column naip_path, drop column naip_bbox, drop column naip_width,
--     drop column naip_height, drop column naip_checked_at;

alter table public.course_imagery
  add column layout jsonb,
  add column layout_status text check (layout_status in ('ok', 'unmapped')),
  add column layout_checked_at timestamptz,
  add column naip_path text,
  add column naip_bbox double precision[],
  add column naip_width integer,
  add column naip_height integer,
  add column naip_checked_at timestamptz;

-- Each branch is wrapped in coalesce(..., false): a CHECK that evaluates to
-- NULL passes, so a half-filled row must make its branch false, not null.
alter table public.course_imagery
  add constraint course_imagery_layout_shape check (
    (layout_status is null and layout is null)
    or coalesce(layout_status = 'unmapped' and layout is null and layout_checked_at is not null, false)
    or coalesce(layout_status = 'ok' and layout is not null and layout_checked_at is not null
        and jsonb_typeof(layout) = 'object'
        and layout->>'v' = '1'
        and jsonb_typeof(layout->'areas') = 'array'
        and jsonb_typeof(layout->'holes') = 'array'
        -- A 36-hole facility simplified is ~70 KB; refuse anything far past it.
        and pg_column_size(layout) < 600000, false)
  ),
  add constraint course_imagery_naip_shape check (
    num_nonnulls(naip_path, naip_bbox, naip_width, naip_height) = 0
    or coalesce(num_nonnulls(naip_path, naip_bbox, naip_width, naip_height, naip_checked_at) = 5
        and naip_path ~ '^naip/v1/[0-9a-f-]{36}/[0-9]{2,4}x[0-9]{2,4}-[0-9a-f]{8}\.jpg$'
        and array_length(naip_bbox, 1) = 4
        and naip_bbox[1] < naip_bbox[3] and naip_bbox[2] < naip_bbox[4]
        and naip_width between 64 and 4000 and naip_height between 64 and 4000, false)
  );

comment on column public.course_imagery.layout is
  'OSM golf features for the course page overview (_shared/courseLayout.ts CourseLayout v1), simplified to ~1 m; ODbL. null with layout_status unmapped = nothing mapped.';
comment on column public.course_imagery.naip_path is
  'The course''s rendered USGS NAIP Plus picture in the public course-imagery bucket (public domain).';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-imagery', 'course-imagery', true, 3145728, array['image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
