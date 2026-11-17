-- Runs only in the disposable fixture DB. All share/delete calls use the real
-- authenticated caller role, not a privileged owner with merely a JWT setting.
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
insert into public.community_posts(id,author_id,type,text,category) values
 ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020','text','Other owner post','General');
set local role authenticated;
do $$ begin
 begin
  update public.caddie_analyses set feedback_post_id='00000000-0000-0000-0000-000000000030'
  where id='00000000-0000-0000-0000-000000000001';
  raise exception 'link UPDATE forgery allowed' using errcode='XX000';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.caddie_analyses(id,owner_id,status,feedback_post_id) values
   ('00000000-0000-0000-0000-000000000002',auth.uid(),'complete','00000000-0000-0000-0000-000000000030');
  raise exception 'link INSERT forgery allowed' using errcode='XX000';
 exception when insufficient_privilege then null; end;
 begin
  perform public.share_caddie_feedback('00000000-0000-0000-0000-000000000099','Missing');
  raise exception 'missing analysis allowed' using errcode='XX000';
 exception when insufficient_privilege then null; end;
 update public.caddie_analyses set status='processing' where id='00000000-0000-0000-0000-000000000001';
 begin
  perform public.share_caddie_feedback('00000000-0000-0000-0000-000000000001','Incomplete');
  raise exception 'incomplete analysis allowed' using errcode='XX000';
 exception when raise_exception then assert sqlerrm='Analysis is not complete.'; end;
 update public.caddie_analyses set status='complete' where id='00000000-0000-0000-0000-000000000001';
end; $$;
reset role;
delete from public.community_posts where id='00000000-0000-0000-0000-000000000030';
set local role authenticated;
do $$
declare a uuid := '00000000-0000-0000-0000-000000000001'; p uuid; q uuid; r jsonb; bad text;
begin
 assert current_user='authenticated';
 foreach bad in array array[null::text,'', '   ',repeat('x',10001),'fixture_blocked_text'] loop
  begin
   perform public.share_caddie_feedback(a,bad);
   raise exception 'invalid text accepted' using errcode='XX000';
  exception when raise_exception then null;
  end;
  assert (select count(*)=0 from public.community_posts), 'failed insert left an orphan post';
  assert (select not shared_to_community and feedback_post_id is null from public.caddie_analyses where id=a);
 end loop;
 r := public.share_caddie_feedback(a,'Test feedback');
 assert r->>'outcome'='created'; p := (r->>'post_id')::uuid;
 r := public.share_caddie_feedback(a,'Retry');
 assert r->>'outcome'='existing'; assert (r->>'post_id')::uuid=p;
 assert (select count(*)=1 from public.community_posts);
 begin
  update public.caddie_analyses set feedback_post_id=null where id=a;
  raise exception 'client cleared protected link' using errcode='XX000';
 exception when insufficient_privilege then null;
 end;
 -- Direct-delete fallback: FK's internal UPDATE must succeed as table owner.
 delete from public.community_posts where id=p;
 assert (select feedback_post_id is null and not shared_to_community from public.caddie_analyses where id=a);
 r := public.share_caddie_feedback(a,'Share after deletion'); q := (r->>'post_id')::uuid;
 assert q<>p and r->>'outcome'='created';
 -- Production deletion RPC body is loaded verbatim by the test runner.
 perform public.delete_community_post(q);
 assert (select feedback_post_id is null and not shared_to_community from public.caddie_analyses where id=a);
 update public.caddie_analyses set shared_to_community=true where id=a;
 begin
  perform public.share_caddie_feedback(a,'Legacy');
  raise exception 'silent legacy repost' using errcode='XX000';
 exception when raise_exception then
  assert sqlerrm='Previous feedback share cannot be verified.';
 end;
 r := public.share_caddie_feedback(a,'Explicit legacy share',true);
 assert r->>'outcome'='created';
 assert public.share_caddie_feedback(a,'Confirmed retry',true)->>'outcome'='existing';
 -- Missing and different-owner IDs fail even for authenticated callers.
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000020',true);
 begin
  perform public.share_caddie_feedback(a,'Cross-owner attempt');
  raise exception 'cross-owner share succeeded' using errcode='XX000';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.share_caddie_feedback(a,'No JWT');
  raise exception 'no-JWT share succeeded' using errcode='XX000';
 exception when insufficient_privilege then null;
 end;
end;
$$;
reset role;
set local role anon;
do $$ begin
 perform public.share_caddie_feedback('00000000-0000-0000-0000-000000000001','Anon');
 raise exception 'anon execution allowed' using errcode='XX000';
exception when insufficient_privilege then null; end; $$;
reset role;
-- Privileged fixture setup only: mark the linked post removed, then share as owner.
update public.community_posts set removed_at=now();
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
set local role authenticated;
do $$ declare r jsonb; begin
 r:= public.share_caddie_feedback('00000000-0000-0000-0000-000000000001','Removed retry');
 assert r->>'outcome'='unavailable' and r->>'post_id' is null;
end; $$;
reset role;
do $$ begin assert (select count(*)=1 from public.community_posts); end; $$;
delete from public.community_posts;
insert into private.user_suspensions(user_id) values('00000000-0000-0000-0000-000000000010');
set local role authenticated;
do $$ begin
 perform public.share_caddie_feedback('00000000-0000-0000-0000-000000000001','Suspended');
 raise exception 'suspended user posted' using errcode='XX000';
exception when raise_exception then assert sqlerrm like 'account_suspended:%'; end; $$;
reset role;
do $$ begin
 assert (select count(*)=0 from public.community_posts);
 assert (select feedback_post_id is null and not shared_to_community from public.caddie_analyses);
end; $$;
rollback;
