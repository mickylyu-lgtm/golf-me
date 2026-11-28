-- Candidate: the seven reviewed venue references, not booking inventory.
begin;
do $guard$
begin
 if not exists(select 1 from simulator_private.settings where not enabled and not enroll_all_active)
  or exists(select 1 from simulator_private.venues)
 then raise exception 'Simulator venue seed needs the disabled empty registry'; end if;
end $guard$;
insert into simulator_private.venues (id, city, name, address, timezone, max_group_size) values
 ('flatiron','nyc','Five Iron Golf · Flatiron','605 6th Ave, New York, NY 10011','America/New_York',6),
 ('herald','nyc','Five Iron Golf · Herald Square','883 6th Ave, Floor 3, New York, NY 10001','America/New_York',4),
 ('golfzon-admiralty','hk','GOLFZON · Admiralty','Shop 70-79 & 91-97, 2/F, Admiralty Centre, 18 Harcourt Road, Admiralty, Hong Kong','Asia/Hong_Kong',4),
 ('golfzon-causeway','hk','GOLFZON · Causeway Bay','2/F, SCAA Sports Complex, 88 Caroline Hill Road, Hong Kong','Asia/Hong_Kong',4),
 ('golfzon-laichikok','hk','GOLFZON · Lai Chi Kok','Shop 114-127, 1/F, D2 Place ONE, 9 Cheung Yee St., Lai Chi Kok, Kowloon','Asia/Hong_Kong',4),
 ('golfzon-tste','hk','GOLFZON · Tsim Sha Tsui East','Shops 147-153, 155 & 156, 1/F, New Mandarin Plaza Shopping Centre, 14 Science Museum Road, Tsim Sha Tsui, Kowloon','Asia/Hong_Kong',4),
 ('golfzon-kowloonbay','hk','GOLFZON · Kowloon Bay','Shop 11, 1/F, 77 Hoi Bun Road, The Quayside, Kowloon East','Asia/Hong_Kong',4);

do $assert$
begin
 if (select array_agg(id order by id) from simulator_private.venues) is distinct from
  array['flatiron','golfzon-admiralty','golfzon-causeway','golfzon-kowloonbay','golfzon-laichikok','golfzon-tste','herald']::text[] then
   raise exception 'Simulator venue catalog mismatch';
 end if;
end $assert$;
commit;
