-- Designed by golfme-architect; approved by Micky 2026-09-30 (DMs included). Apple Guideline 1.2: filter objectionable text before it is stored.
-- Severe-only word list in private.blocked_terms (editable by SQL, no migration needed). Not readable by
-- anon/authenticated. Only NEW or CHANGED values of the listed columns are checked, so existing rows and unrelated
-- updates are never re-checked. The demo path is localStorage-only and never reaches these tables.

-- 1. Term -> regex. Per letter: the letter, repeatable (n+). Letters may be
--    split by . _ * -. Words in a phrase are split by any non-alphanumerics
--    (or nothing). Optional trailing s/z. Custom boundaries so "_" and digits
--    count as word breaks.
--    Masked letters: '*' or '#' may stand in for exactly ONE middle letter
--    (never the first or last). Up to 1 mask for 4-5 letter terms, up to 2
--    for 6+ letter terms. None for 3-letter terms or phrases. This keeps at
--    least 3 real letters (4 for 6+ letter terms), so '***', 's**t', 'f**k'
--    can't overmatch, and masked swears that aren't listed (sh*t, f*ck) pass.
--    Each allowed mask placement becomes its own branch of an alternation.
create function private.blocked_term_pattern(p_term text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with chars as (
    select ch, pos::int as pos
    from unnest(string_to_array(p_term, null)) with ordinality as c(ch, pos)
  ),
  masks as (
    select array[]::int[] as m
    union all
    select array[i]
    from generate_series(2, char_length(p_term) - 1) as i
    where char_length(p_term) >= 4 and strpos(p_term, ' ') = 0
    union all
    select array[i, j]
    from generate_series(2, char_length(p_term) - 1) as i,
         generate_series(2, char_length(p_term) - 1) as j
    where i < j and char_length(p_term) >= 6 and strpos(p_term, ' ') = 0
  ),
  variants as (
    select (
      select string_agg(
        case
          when c.ch = ' ' then '[^[:alnum:]]*'
          else case when c.pos > 1 and substr(p_term, c.pos - 1, 1) <> ' ' then '[._*-]*' else '' end
               || case when c.pos = any(m.m) then '[*#]' else c.ch || '+' end
        end,
        '' order by c.pos)
      from chars c
    ) as v
    from masks m
  )
  select '(?:^|[^[:alnum:]])(?:' || string_agg(v, '|') || ')[sz]?(?:$|[^[:alnum:]])'
  from variants;
$$;

revoke execute on function private.blocked_term_pattern(text) from public, anon, authenticated;

-- 2. The list. 'word' = lowercase a-z words; 'substring' = reserved for future CJK terms (matched with strpos).
create table private.blocked_terms (
  id          bigint generated always as identity primary key,
  term        text not null unique,
  match_mode  text not null default 'word' check (match_mode in ('word', 'substring')),
  category    text not null check (category in ('slur', 'sexual', 'harassment')),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  pattern     text generated always as (
                case when match_mode = 'word' then private.blocked_term_pattern(term) end
              ) stored,
  constraint blocked_terms_term_shape check (
    (match_mode = 'word' and term ~ '^[a-z]+( [a-z]+)*$')
    or (match_mode = 'substring' and term = lower(term) and char_length(term) >= 2)
  )
);

-- RLS on with no policies, plus no grants: only the table owner can read it.
alter table private.blocked_terms enable row level security;
revoke all on table private.blocked_terms from public, anon, authenticated;

insert into private.blocked_terms (term, category) values
  -- racial / ethnic slurs
  ('nigger','slur'), ('nigga','slur'), ('kike','slur'), ('spic','slur'),
  ('wetback','slur'), ('gook','slur'), ('raghead','slur'), ('towelhead','slur'),
  ('beaner','slur'),
  -- homophobic / transphobic / ableist slurs
  ('faggot','slur'), ('tranny','slur'), ('retard','slur'), ('retarded','slur'),
  -- explicit sexual
  ('cunt','sexual'), ('whore','sexual'), ('slut','sexual'), ('blowjob','sexual'),
  ('handjob','sexual'), ('cumshot','sexual'), ('creampie','sexual'),
  ('gangbang','sexual'), ('bukkake','sexual'), ('child porn','sexual'),
  -- severe harassment / violence / hate
  ('rape','harassment'), ('raped','harassment'), ('raping','harassment'),
  ('rapist','harassment'), ('kys','harassment'), ('kill yourself','harassment'),
  ('kill urself','harassment'), ('heil hitler','harassment'), ('sieg heil','harassment');

-- 3. The check (SECURITY INVOKER; only called from the definer trigger; execute revoked from clients).
--    Match if either normalized view hits: a) leetspeak folded (0->o 1->i 3->e 4->a @->a $->s 5->s 7->t);
--    b) digits turned into boundaries. Zero-width / soft-hyphen characters (U+00AD, U+200B-U+200F, U+2060, U+FEFF) are
--    stripped first, written as \u escapes so they survive copying.
create function private.text_is_objectionable(p_text text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_re    text;
  v_clean text;
begin
  if p_text is null or p_text !~ '[[:alpha:]]' then
    return false;
  end if;

  v_clean := lower(regexp_replace(p_text, '[\u00AD\u200B-\u200F\u2060\uFEFF]', '', 'g'));

  select '(?:' || string_agg(pattern, '|') || ')' into v_re
  from private.blocked_terms
  where enabled and match_mode = 'word';

  if v_re is not null and (
       translate(v_clean, '0134@$57', 'oieaasst') ~ v_re
    or regexp_replace(v_clean, '[0-9]+', ' ', 'g') ~ v_re
  ) then
    return true;
  end if;

  return exists (
    select 1 from private.blocked_terms
    where enabled and match_mode = 'substring' and strpos(v_clean, term) > 0
  );
end;
$$;

revoke execute on function private.text_is_objectionable(text) from public, anon, authenticated;

-- 4. Generic trigger; column names come in as trigger arguments. Unchanged columns are skipped on UPDATE.
--    SECURITY DEFINER so it can read the hidden list; reads NEW/OLD + the list, writes nothing.
--    Client token: message prefix + hint 'objectionable_content' (P0001 -> HTTP 400). The term is never echoed.
create function private.reject_objectionable_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_col text;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;

  foreach v_col in array tg_argv loop
    continue when tg_op = 'UPDATE' and (v_new -> v_col) is not distinct from (v_old -> v_col);
    if private.text_is_objectionable(v_new ->> v_col) then
      raise exception 'objectionable_content: That contains language that isn''t allowed on GolfMe.'
        using errcode = 'P0001',
              hint    = 'objectionable_content',
              detail  = tg_table_name || '.' || v_col;
    end if;
  end loop;

  return new;
end;
$$;

revoke execute on function private.reject_objectionable_text() from public, anon, authenticated;

-- 5. Attach. "UPDATE OF <cols>" means updates that don't touch these columns never call the function.
create trigger filter_objectionable_text
  before insert or update of text, course_tag on public.community_posts
  for each row execute function private.reject_objectionable_text('text', 'course_tag');

create trigger filter_objectionable_text
  before insert or update of text on public.community_comments
  for each row execute function private.reject_objectionable_text('text');

create trigger filter_objectionable_text
  before insert or update of name, username, bio on public.profiles
  for each row execute function private.reject_objectionable_text('name', 'username', 'bio');

create trigger filter_objectionable_text
  before insert or update of notes, course_name on public.golf_calls
  for each row execute function private.reject_objectionable_text('notes', 'course_name');

create trigger filter_objectionable_text
  before insert or update of text on public.round_messages
  for each row execute function private.reject_objectionable_text('text');

-- 6. 1:1 DMs (approved by Micky: strangers can DM, and DM text appears in lock-screen push previews).
create trigger filter_objectionable_text
  before insert or update of text on public.messages
  for each row execute function private.reject_objectionable_text('text');
