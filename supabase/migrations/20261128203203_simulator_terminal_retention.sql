-- Candidate: install retention before any access activation. No app role can invoke it.
begin;
do $guard$
begin
 if current_user <> 'postgres' or not exists(select 1 from simulator_private.settings where not enabled)
  or to_regnamespace('cron') is null
 then raise exception 'Requires the reviewed privileged scheduler operator, with Simulator disabled'; end if;
 if exists (select 1 from cron.job where jobname='golfme-simulator-terminal-prune') then
  raise exception 'Simulator retention job already exists';
 end if;
end $guard$;
select cron.schedule('golfme-simulator-terminal-prune','*/15 * * * *',
 'select simulator_private.purge_terminal_sessions()');
do $verify$
begin
 if (select count(*) from cron.job where jobname='golfme-simulator-terminal-prune' and username='postgres'
  and schedule='*/15 * * * *' and active and database=current_database()
  and command='select simulator_private.purge_terminal_sessions()')<>1 then
  raise exception 'Simulator retention identity or schedule was not established';
 end if;
end $verify$;
commit;
