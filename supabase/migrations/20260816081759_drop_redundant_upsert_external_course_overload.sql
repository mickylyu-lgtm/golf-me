-- create or replace with an added parameter doesn't replace a function --
-- it overloads it, since the signature (argument list) differs. Left two
-- versions of upsert_external_course briefly (10-arg and 11-arg with
-- p_holes). Dropping the old 10-arg one so there's exactly one definition;
-- callers that omit p_holes still work via its default value.
drop function public.upsert_external_course(text, text, text, text, text, text, text, text, double precision, double precision);
