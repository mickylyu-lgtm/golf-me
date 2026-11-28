-- NYC public simulator references verified against operator booking pages on 2026-11-28.
-- This catalog records venues and group limits, not availability or reservations.
insert into simulator_private.venues (id, city, name, address, timezone, max_group_size) values
 ('five-iron-grand-central','nyc','Five Iron Golf · Grand Central','101 Park Ave, Floor 3, New York, NY 10017','America/New_York',6),
 ('five-iron-upper-east-side','nyc','Five Iron Golf · Upper East Side','1681 3rd Ave, New York, NY 10128','America/New_York',6),
 ('five-iron-long-island-city','nyc','Five Iron Golf · Long Island City','22-43 Jackson Ave, Long Island City, NY 11101','America/New_York',6),
 ('golfzon-social-brooklyn','nyc','GOLFZON Social · Downtown Brooklyn','15 Hoyt St, Brooklyn, NY 11201','America/New_York',6),
 ('x-golf-brooklyn','nyc','X-Golf · Williamsburg','105 N 13th St, Brooklyn, NY 11249','America/New_York',6),
 ('bklyn-swing','nyc','BKLYN SWING · Dyker Heights','7613 13th Ave, Brooklyn, NY 11228','America/New_York',2)
on conflict (id) do nothing;
