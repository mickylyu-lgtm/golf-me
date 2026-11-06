-- Custom reaction emoji (the hold menu's "+" picker). PREPARED, NOT APPLIED:
-- apply only after Micky's sign-off. Requires 20261105150000,
-- 20261105160000 and 20261106160000 (applied) and 20261107130000
-- (round_message_reactions; refuses to run without it).
--
-- What changes: the emoji check on BOTH reaction tables
--   public.message_reactions.message_reactions_emoji_check
--   public.round_message_reactions.round_message_reactions_emoji_check
-- goes from "one of the six quick emoji" to "exactly one emoji":
-- public.is_reaction_emoji(text). Constraint names are kept (the client's
-- refusal detection, lib/customReactions.ts isEmojiCheckViolation, matches
-- "emoji_check"). NULL (a tombstone) still passes.
--
-- The rule (same as the client's src/lib/reactionEmoji.ts isReactionEmoji):
-- at most 48 bytes of UTF-8 (the longest RGI emoji, a kiss with two skin
-- tones, is 35; the structure below can't exceed 41, so the cap is a
-- backstop, not the rule) and exactly one of
--   * a flag: two regional indicators;
--   * a keycap: 0-9 # * (U+FE0F optional) U+20E3;
--   * a tag flag: U+1F3F4, 1..7 tag characters, U+E007F (England, ...);
--   * up to 4 emoji joined by U+200D (ZWJ), each with an optional U+FE0F,
--     or one skin tone (U+1F3FB..U+1F3FF) when it is a modifier base; the
--     first one needs U+FE0F when its default presentation is text (so the
--     bare U+2764 heart is still refused, as before).
-- Plain text, digits, whitespace, an empty string or two emoji side by side
-- never match. Every code point is written as an 8-digit \U escape: no
-- invisible characters in this file.
--
-- Why a regex over code-point classes, not an allow-list table of the
-- ~3,800 RGI sequences: a CHECK constraint can't read a table (an FK to an
-- allow-list would work but has to be re-seeded for every Unicode release,
-- and a newer phone's keyboard emoji would be refused until then); the
-- classes are generated from the Unicode tables (scripts/emoji/
-- build-emoji-data.mjs, Unicode 17.0) and include not-yet-assigned
-- pictographic code points, so future emoji pass without a migration. What
-- it accepts beyond RGI (a ZWJ pair no vendor draws) renders as at most
-- four emoji glyphs, never text. The three class constants below are
-- generated (tests/reactionEmoji.test.ts compares them with the client's)
-- and assembled exactly like the client's pattern (the PGlite suite runs
-- both over every emoji in the picker's dataset plus random strings).
--
-- Unchanged: RLS policies, the authz triggers (prepare_message_reaction,
-- prepare_round_message_reaction: uniform reaction_not_allowed), the
-- ordering triggers and tombstones (client_seq), unsend cleanup, realtime,
-- grants on the tables.
--
-- public.is_reaction_emoji(text) is also the client's feature probe:
-- callable by authenticated (the CHECK runs it as the writing role, so it
-- needs EXECUTE anyway), not by anon. IMMUTABLE and pure: reveals nothing.
--
-- Rollout: client first or migration first, both safe. Before this
-- migration the client hides "+" (the probe RPC isn't found); after it the
-- next reaction fetch's probe shows "+". Clients older than the "+" build
-- drop rows whose emoji isn't one of the six, so they show no pill for a
-- custom reaction (and keep working).
--
-- Verify: emoji-picker-check.sql returns true (one row).
-- Rollback (emoji-picker-rollback.sql, in a transaction): custom reactions
-- become tombstones (emoji NULL, client_seq kept: "no reaction" everywhere,
-- ordering intact; run as the SQL editor's postgres role, the authz
-- triggers let a privileged update through), then the six-emoji checks
-- come back and the function goes:
--   update public.message_reactions set emoji = null
--    where emoji is not null and emoji not in (U&'\2764\FE0F', U&'\+01F602', U&'\+01F62E', U&'\+01F622', U&'\+01F621', U&'\+01F44D');
--   update public.round_message_reactions set emoji = null
--    where emoji is not null and emoji not in (...same six...);
--   alter table ... drop constraint ..._emoji_check, add constraint ..._emoji_check check (emoji in (...six...));
--   drop function public.is_reaction_emoji(text);
--   notify pgrst, 'reload schema';

do $$
begin
  if to_regclass('public.message_reactions') is null or to_regclass('public.round_message_reactions') is null then
    raise exception 'custom_reaction_emoji: apply 20261105150000 and 20261107130000 first';
  end if;
end;
$$;

create function public.is_reaction_emoji(p_emoji text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $fn$
declare
  -- GENERATED (src/lib/reactionEmojiRanges.ts, Unicode 17.0): emoji
  -- presentation by default + unassigned pictographic code points.
  c_presentation constant text := '[\U0000231A-\U0000231B\U000023E9-\U000023EC\U000023F0\U000023F3\U000025FD-\U000025FE\U00002614-\U00002615\U00002648-\U00002653\U0000267F\U00002693\U000026A1\U000026AA-\U000026AB\U000026BD-\U000026BE\U000026C4-\U000026C5\U000026CE\U000026D4\U000026EA\U000026F2-\U000026F3\U000026F5\U000026FA\U000026FD\U00002705\U0000270A-\U0000270B\U00002728\U0000274C\U0000274E\U00002753-\U00002755\U00002757\U00002795-\U00002797\U000027B0\U000027BF\U00002B1B-\U00002B1C\U00002B50\U00002B55\U0001F004\U0001F02C-\U0001F02F\U0001F094-\U0001F09F\U0001F0AF-\U0001F0B0\U0001F0C0\U0001F0CF-\U0001F0D0\U0001F0F6-\U0001F0FF\U0001F18E\U0001F191-\U0001F19A\U0001F1AE-\U0001F1E5\U0001F201\U0001F203-\U0001F20F\U0001F21A\U0001F22F\U0001F232-\U0001F236\U0001F238-\U0001F23A\U0001F23C-\U0001F23F\U0001F249-\U0001F25F\U0001F266-\U0001F320\U0001F32D-\U0001F335\U0001F337-\U0001F37C\U0001F37E-\U0001F393\U0001F3A0-\U0001F3CA\U0001F3CF-\U0001F3D3\U0001F3E0-\U0001F3F0\U0001F3F4\U0001F3F8-\U0001F3FA\U0001F400-\U0001F43E\U0001F440\U0001F442-\U0001F4FC\U0001F4FF-\U0001F53D\U0001F54B-\U0001F54E\U0001F550-\U0001F567\U0001F57A\U0001F595-\U0001F596\U0001F5A4\U0001F5FB-\U0001F64F\U0001F680-\U0001F6C5\U0001F6CC\U0001F6D0-\U0001F6D2\U0001F6D5-\U0001F6DF\U0001F6EB-\U0001F6EF\U0001F6F4-\U0001F6FF\U0001F7DA-\U0001F7FF\U0001F80C-\U0001F80F\U0001F848-\U0001F84F\U0001F85A-\U0001F85F\U0001F888-\U0001F88F\U0001F8AE-\U0001F8AF\U0001F8BC-\U0001F8BF\U0001F8C2-\U0001F8CF\U0001F8D9-\U0001F8FF\U0001F90C-\U0001F93A\U0001F93C-\U0001F945\U0001F947-\U0001F9FF\U0001FA58-\U0001FA5F\U0001FA6E-\U0001FAFF\U0001FC00-\U0001FFFD]';
  -- GENERATED: text presentation by default (needs U+FE0F alone); digits,
  -- # and * excluded (keycaps only).
  c_text_default constant text := '[\U000000A9\U000000AE\U0000203C\U00002049\U00002122\U00002139\U00002194-\U00002199\U000021A9-\U000021AA\U00002328\U000023CF\U000023ED-\U000023EF\U000023F1-\U000023F2\U000023F8-\U000023FA\U000024C2\U000025AA-\U000025AB\U000025B6\U000025C0\U000025FB-\U000025FC\U00002600-\U00002604\U0000260E\U00002611\U00002618\U0000261D\U00002620\U00002622-\U00002623\U00002626\U0000262A\U0000262E-\U0000262F\U00002638-\U0000263A\U00002640\U00002642\U0000265F-\U00002660\U00002663\U00002665-\U00002666\U00002668\U0000267B\U0000267E\U00002692\U00002694-\U00002697\U00002699\U0000269B-\U0000269C\U000026A0\U000026A7\U000026B0-\U000026B1\U000026C8\U000026CF\U000026D1\U000026D3\U000026E9\U000026F0-\U000026F1\U000026F4\U000026F7-\U000026F9\U00002702\U00002708-\U00002709\U0000270C-\U0000270D\U0000270F\U00002712\U00002714\U00002716\U0000271D\U00002721\U00002733-\U00002734\U00002744\U00002747\U00002763-\U00002764\U000027A1\U00002934-\U00002935\U00002B05-\U00002B07\U00003030\U0000303D\U00003297\U00003299\U0001F170-\U0001F171\U0001F17E-\U0001F17F\U0001F202\U0001F237\U0001F321\U0001F324-\U0001F32C\U0001F336\U0001F37D\U0001F396-\U0001F397\U0001F399-\U0001F39B\U0001F39E-\U0001F39F\U0001F3CB-\U0001F3CE\U0001F3D4-\U0001F3DF\U0001F3F3\U0001F3F5\U0001F3F7\U0001F43F\U0001F441\U0001F4FD\U0001F549-\U0001F54A\U0001F56F-\U0001F570\U0001F573-\U0001F579\U0001F587\U0001F58A-\U0001F58D\U0001F590\U0001F5A5\U0001F5A8\U0001F5B1-\U0001F5B2\U0001F5BC\U0001F5C2-\U0001F5C4\U0001F5D1-\U0001F5D3\U0001F5DC-\U0001F5DE\U0001F5E1\U0001F5E3\U0001F5E8\U0001F5EF\U0001F5F3\U0001F5FA\U0001F6CB\U0001F6CD-\U0001F6CF\U0001F6E0-\U0001F6E5\U0001F6E9\U0001F6F0\U0001F6F3]';
  -- GENERATED: modifier bases (+ unassigned pictographic): may take one
  -- skin tone.
  c_modifier_base constant text := '[\U0000261D\U000026F9\U0000270A-\U0000270D\U0001F02C-\U0001F02F\U0001F094-\U0001F09F\U0001F0AF-\U0001F0B0\U0001F0C0\U0001F0D0\U0001F0F6-\U0001F0FF\U0001F1AE-\U0001F1E5\U0001F203-\U0001F20F\U0001F23C-\U0001F23F\U0001F249-\U0001F24F\U0001F252-\U0001F25F\U0001F266-\U0001F2FF\U0001F385\U0001F3C2-\U0001F3C4\U0001F3C7\U0001F3CA-\U0001F3CC\U0001F442-\U0001F443\U0001F446-\U0001F450\U0001F466-\U0001F478\U0001F47C\U0001F481-\U0001F483\U0001F485-\U0001F487\U0001F48F\U0001F491\U0001F4AA\U0001F574-\U0001F575\U0001F57A\U0001F590\U0001F595-\U0001F596\U0001F645-\U0001F647\U0001F64B-\U0001F64F\U0001F6A3\U0001F6B4-\U0001F6B6\U0001F6C0\U0001F6CC\U0001F6D9-\U0001F6DB\U0001F6ED-\U0001F6EF\U0001F6FD-\U0001F6FF\U0001F7DA-\U0001F7DF\U0001F7EC-\U0001F7EF\U0001F7F1-\U0001F7FF\U0001F80C-\U0001F80F\U0001F848-\U0001F84F\U0001F85A-\U0001F85F\U0001F888-\U0001F88F\U0001F8AE-\U0001F8AF\U0001F8BC-\U0001F8BF\U0001F8C2-\U0001F8CF\U0001F8D9-\U0001F8FF\U0001F90C\U0001F90F\U0001F918-\U0001F91F\U0001F926\U0001F930-\U0001F939\U0001F93C-\U0001F93E\U0001F977\U0001F9B5-\U0001F9B6\U0001F9B8-\U0001F9B9\U0001F9BB\U0001F9CD-\U0001F9CF\U0001F9D1-\U0001F9DD\U0001FA58-\U0001FA5F\U0001FA6E-\U0001FA6F\U0001FA7D-\U0001FA7F\U0001FA8B-\U0001FA8D\U0001FAC3-\U0001FAC5\U0001FAC7\U0001FAC9-\U0001FACC\U0001FADD-\U0001FADE\U0001FAEB-\U0001FAEE\U0001FAF0-\U0001FAFF\U0001FC00-\U0001FFFD]';
  c_skin_tone constant text := '[\U0001F3FB-\U0001F3FF]';
  c_vs16 constant text := '\U0000FE0F';
  c_zwj constant text := '\U0000200D';
  v_first text;
  v_next text;
begin
  if p_emoji is null or octet_length(p_emoji) < 1 or octet_length(p_emoji) > 48 then
    return false;
  end if;
  -- First element: a text-default emoji needs U+FE0F. Later ones (after a
  -- ZWJ) may omit it.
  v_first := '(?:' || c_modifier_base || c_skin_tone || '|' || c_presentation || c_vs16 || '?|' || c_text_default || c_vs16 || ')';
  v_next := '(?:' || c_modifier_base || c_skin_tone || '|' || c_presentation || c_vs16 || '?|' || c_text_default || c_vs16 || '?)';
  return p_emoji ~ (
    '^(?:[\U0001F1E6-\U0001F1FF]{2}'
    || '|[0-9#*]' || c_vs16 || '?\U000020E3'
    || '|\U0001F3F4[\U000E0020-\U000E007E]{1,7}\U000E007F'
    || '|' || v_first || '(?:' || c_zwj || v_next || '){0,3})$'
  );
end;
$fn$;

comment on function public.is_reaction_emoji(text) is
  'True when the text is exactly one reaction emoji (<= 48 bytes). Used by the reaction tables'' emoji checks; also the client''s probe for custom reactions (migration 20261107160000).';

revoke all on function public.is_reaction_emoji(text) from public, anon;
grant execute on function public.is_reaction_emoji(text) to authenticated, service_role;

alter table public.message_reactions drop constraint message_reactions_emoji_check;
alter table public.message_reactions
  add constraint message_reactions_emoji_check check (emoji is null or public.is_reaction_emoji(emoji));

alter table public.round_message_reactions drop constraint round_message_reactions_emoji_check;
alter table public.round_message_reactions
  add constraint round_message_reactions_emoji_check check (emoji is null or public.is_reaction_emoji(emoji));

comment on column public.message_reactions.emoji is
  'One reaction emoji (public.is_reaction_emoji: the six quick ones or any other); NULL = removed (tombstone, keeps client_seq).';
comment on column public.round_message_reactions.emoji is
  'One reaction emoji (public.is_reaction_emoji: the six quick ones or any other); NULL = removed (tombstone, keeps client_seq).';

notify pgrst, 'reload schema';
