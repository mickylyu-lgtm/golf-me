#!/usr/bin/env python3
"""Synthetic local PostgreSQL authorization test; no downloads or production access.
Usage: python3 scripts/staging/official-community-posts.py /path/to/pg-runtime
The runner always creates a fresh private-socket cluster and stops it in finally.
"""
import json, os, pathlib, re, subprocess, sys, tempfile
root = pathlib.Path(__file__).resolve().parents[2]
runtime = pathlib.Path(sys.argv[1]).resolve()
bin_dir = runtime / "usr/lib/postgresql/17/bin"
assert (bin_dir / "initdb").is_file()
assert os.geteuid() != 0
scratch = pathlib.Path(tempfile.mkdtemp(prefix="golfme-official-posts-pg17-"))
data, socket = scratch / "data", scratch / "socket"
socket.mkdir(mode=0o700)
env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
env.update(LD_LIBRARY_PATH=str(runtime / "usr/lib/x86_64-linux-gnu"),
           PGHOST=str(socket), PGPORT="55447", PGUSER="postgres", PGDATABASE="postgres")
started, assertions = False, []
def command(args, **kwargs):
    return subprocess.run([str(bin_dir / args[0]), *args[1:]], env=env,
                          text=True, capture_output=True, check=True, **kwargs)
def sql(query):
    return command(["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"], input=query).stdout.strip()
def check(name, condition):
    if not condition: raise AssertionError(name)
    assertions.append(name)
A, B, C = ["%s1111111-1111-4111-8111-111111111111" % n for n in (1,2,3)]
P, Q, R = ["%s2222222-2222-4222-8222-222222222222" % n for n in (1,2,3)]
M = "44444444-4444-4444-8444-444444444444"
def caller(query, user=A, role="authenticated", extra=None):
    claims = {"sub":user,"role":role}
    if extra: claims.update(extra)
    return sql("set role " + role + "; set request.jwt.claims = '" +
               json.dumps(claims).replace("'", "''") + "'; " + query).splitlines()[-1]
def rejected(query, user=A, role="authenticated", token=None):
    try:
        caller(query, user, role)
        return False
    except subprocess.CalledProcessError as e:
        if token and token not in e.stderr: raise AssertionError(e.stderr)
        return True
def caps(user=A):
    return json.loads(caller("select public.community_post_capabilities()",user))
def post(pid, author=A, official=None):
    return ("insert into public.community_posts(id,author_id,type,text,category" +
            (",is_official" if official is not None else "") + ") values ('" +
            pid + "','" + author + "','text','Synthetic post','General'" +
            ("," + str(official).lower() if official is not None else "") + ")")
def function(source, name):
    match = re.search(r"create (?:or replace )?function " + re.escape(name) +
                      r"\(.*?\$\$;", source, flags=re.S|re.I)
    assert match, name
    return match.group()
def schema_snapshot():
    return sql("""select jsonb_build_object(
      'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
      'grants',(select jsonb_agg(to_jsonb(g) order by table_schema,table_name,grantee,privilege_type)
       from information_schema.role_table_grants g where table_schema='public'))""")
try:
    command(["initdb","-D",str(data),"-U","postgres","-A","trust","--no-locale"])
    command(["pg_ctl","-D",str(data),"-l",str(scratch/"server.log"),"-w","start","-o",
             "-F -c listen_addresses='' -c unix_socket_directories='"+str(socket)+
             "' -c unix_socket_permissions=0700 -p 55447"])
    started = True
    sql("""create role anon nologin; create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth; create schema private;
      grant usage on schema auth,private to authenticated,anon,service_role;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(auth.jwt()->>'sub','')::uuid $$;
      create table auth.users(id uuid primary key,is_anonymous boolean default false,
        banned_until timestamptz,deleted_at timestamptz);
      create table public.golf_calls(id uuid primary key);
      create table public.user_roles(user_id uuid,role text,active boolean default true);
      create table private.user_suspensions(user_id uuid,suspended_until timestamptz,hide_content boolean default false);
      alter default privileges in schema public grant execute on functions to service_role,anon,authenticated;
    """)
    base = (root/"supabase/migrations/20260816143600_create_real_community.sql").read_text()
    sql(base.split("-- Real media storage")[0])
    media = (root/"supabase/migrations/20260820100000_create_community_post_media.sql").read_text()
    sql(media.split("alter publication")[0])
    sql((root/"supabase/migrations/20261107260000_community_post_media_cap.sql").read_text())
    sql("""alter table public.community_posts add column video_thumbnail_url text,
      add column coach_review_requested boolean not null default false,
      add column removed_at timestamptz,add column removed_by uuid,add column removed_reason text;
      grant select,insert,update,delete on public.community_posts,public.community_post_media to anon,authenticated,service_role;
    """)
    roles=(root/"supabase/migrations/20260818040000_create_coach_reviewer_system.sql").read_text()
    moderation=(root/"supabase/migrations/20261107270000_admin_moderation.sql").read_text()
    sql(function(roles,"private.has_role"))
    for name in ["private.is_suspended","private.content_hidden_author_ids",
                 "private.reject_suspended_write","private.guard_moderation_columns"]:
        sql(function(moderation,name))
    sql("""create trigger reject_suspended_write before insert on public.community_posts
      for each row execute function private.reject_suspended_write('author_id');
      create trigger reject_suspended_edit before update of text,course_tag,image_url,video_url,video_thumbnail_url,category,type
      on public.community_posts for each row execute function private.reject_suspended_write('author_id');
      create trigger reject_suspended_write before insert on public.community_post_media
      for each row execute function private.reject_suspended_write();
      create trigger guard_moderation_columns before insert or update of removed_at,removed_by,removed_reason
      on public.community_posts for each row execute function private.guard_moderation_columns();
      drop policy community_posts_select_authenticated on public.community_posts;
      create policy community_posts_select_authenticated on public.community_posts for select to authenticated using
        (removed_at is null and (author_id=(select auth.uid()) or author_id <> all
         (coalesce((select private.content_hidden_author_ids()),'{}'::uuid[]))));
    """)
    sql("insert into auth.users(id) values ('"+A+"'),('"+B+"'),('"+C+"');"+
        "insert into public.user_roles values ('"+A+"','admin',true),('"+C+"','coach_reviewer',true);")
    caller(post(Q,A))
    before=schema_snapshot()
    migration=root/"supabase/migrations/20261111210916_official_community_posts.sql"
    sql(migration.read_text())
    check("no TCP listener",sql("show listen_addresses")=="")
    check("existing row defaults to ordinary",caller("select not is_official from community_posts where id='"+Q+"'")=="t")
    check("existing policies and table grants unchanged",schema_snapshot()==before)
    check("admin capability exact contract",caps()=={"version":1,"can_post_official":True})
    check("ordinary user capability false",caps(B)=={"version":1,"can_post_official":False})
    check("coach capability false",not caps(C)["can_post_official"])
    check("missing user capability false",not caps("")["can_post_official"])
    for role in ("anon","service_role"):
        check(role+" capability execute denied",rejected("select community_post_capabilities()",role=role))
    for name in ("can_post_official","guard_official_community_post","guard_official_post_media"):
        for role in ("anon","authenticated","service_role"):
            check(name+" private execute denied for "+role,
              sql("select not has_function_privilege('"+role+"','private."+name+"()','EXECUTE')")=="t")
    check("function search paths fixed",sql("""select bool_and(proconfig=array['search_path=""'])
      from pg_proc where oid in ('private.can_post_official()'::regprocedure,
      'private.guard_official_community_post()'::regprocedure,'private.guard_official_post_media()'::regprocedure,
      'public.community_post_capabilities()'::regprocedure)""")=="t")
    check("ordinary official insert rejected",rejected(post(P,B,True),B,token="official_post_not_allowed"))
    check("coach official insert rejected",rejected(post(P,C,True),C,token="official_post_not_allowed"))
    check("missing auth official insert rejected",rejected(post(P,A,True),"",token="official_post_not_allowed"))
    check("service without auth cannot create official",rejected(post(P,A,True),"","service_role", "official_post_not_allowed"))
    check("admin cannot impersonate another author",rejected(post(P,B,True),token="official_post_not_allowed"))
    check("ordinary cannot impersonate admin",rejected(post(P,A,True),B,token="official_post_not_allowed"))
    check("anon insert denied",rejected(post(P,A,True),role="anon"))
    caller(post(P,A,True))
    check("admin can insert official",caller("select is_official from community_posts where id='"+P+"'")=="t")
    caller(post(R,B),B)
    check("ordinary omitted-field insertion still works",caller("select not is_official from community_posts where id='"+R+"'",B)=="t")
    for user,pid in ((A,Q),(B,R)):
        check("cannot promote ordinary "+user,rejected("update community_posts set is_official=true where id='"+pid+"'",user,token="official_post_immutable"))
    check("cannot demote official",rejected("update community_posts set is_official=false where id='"+P+"'",token="official_post_immutable"))
    check("cannot change official author even with service bypass",rejected("update community_posts set author_id='"+B+"' where id='"+P+"'",A,"service_role","official_post_immutable"))
    caller("update community_posts set text='Admin edit' where id='"+P+"'")
    caller("insert into community_post_media(id,post_id,media_type,media_url) values('"+M+"','"+P+"','image','https://example.invalid/image')")
    check("official media accepted for admin",caller("select count(*)=1 from community_post_media where post_id='"+P+"'")=="t")
    check("official media retains existing cap",rejected("insert into community_post_media(post_id,media_type,media_url) select '"+P+"','image','x' from generate_series(1,10)",token="community_post_media_cap"))
    check("failed official media batch is atomic",caller("select count(*)=1 from community_post_media where post_id='"+P+"'")=="t")
    sql("update user_roles set active=false where user_id='"+A+"'")
    check("revoked capability false",not caps()["can_post_official"])
    check("revoked cannot create official",rejected(post("55555555-5555-4555-8555-555555555555",A,True),token="official_post_not_allowed"))
    check("revoked cannot edit official text",rejected("update community_posts set text='Forged' where id='"+P+"'",token="official_post_not_allowed"))
    check("revoked cannot edit official attachment",rejected("update community_posts set video_url='https://example.invalid/new' where id='"+P+"'",token="official_post_not_allowed"))
    check("revoked cannot add official media",rejected("insert into community_post_media(post_id,media_type,media_url) values('"+P+"','image','x')",token="official_post_not_allowed"))
    check("revoked cannot delete official media",rejected("delete from community_post_media where post_id='"+P+"'",token="official_post_not_allowed"))
    check("service cannot move official media into ordinary post",rejected("update community_post_media set post_id='"+Q+"' where id='"+M+"'","","service_role","official_post_not_allowed"))
    check("service cannot move ordinary media into official post",rejected("insert into community_post_media(post_id,media_type,media_url) values('"+P+"','image','x')","","service_role","official_post_not_allowed"))
    caller("update community_posts set text='Still personal' where id='"+Q+"'")
    check("revoked can still edit own ordinary post",caller("select text='Still personal' from community_posts where id='"+Q+"'")=="t")
    caller("update community_posts set swing_analysis_status='complete' where id='"+P+"'","","service_role")
    check("service analysis lifecycle still works",sql("select swing_analysis_status='complete' from community_posts where id='"+P+"'")=="t")
    caller("update community_posts set removed_at=now(),removed_reason='spam' where id='"+P+"'","","service_role")
    check("service moderation still works",sql("select removed_at is not null from community_posts where id='"+P+"'")=="t")
    check("removed official hidden by unchanged RLS",caller("select count(*)=0 from community_posts where id='"+P+"'",B)=="t")
    caller("update community_posts set removed_at=null,removed_reason=null where id='"+P+"'","","service_role")
    for field,value in (("is_anonymous","true"),("banned_until","now()+interval '1 hour'"),("deleted_at","now()")):
        sql("update user_roles set active=true where user_id='"+A+"'; update auth.users set "+field+"="+value+" where id='"+A+"'")
        check(field+" account denied",not caps()["can_post_official"])
        check(field+" insert denied",rejected(post("55555555-5555-4555-8555-555555555555",A,True),token="official_post_not_allowed"))
        sql("update auth.users set "+field+"="+("false" if field=="is_anonymous" else "null")+" where id='"+A+"'")
    sql("insert into private.user_suspensions(user_id) values('"+A+"')")
    check("suspended admin capability false",not caps()["can_post_official"])
    check("suspended official insert rejected",rejected(post("55555555-5555-4555-8555-555555555555",A,True),token="official_post_not_allowed"))
    check("suspended ordinary post existing guard retained",rejected(post("55555555-5555-4555-8555-555555555555",A),token="account_suspended"))
    sql("delete from private.user_suspensions; update user_roles set active=false where user_id='"+A+"'")
    caller("delete from community_posts where id='"+P+"'")
    check("whole post deletion and media cascade remain possible",sql("select not exists(select 1 from community_post_media where id='"+M+"')")=="t")
    check("ordinary user metadata cannot grant official role",json.loads(caller("select community_post_capabilities()",B,
        extra={"user_metadata":{"role":"admin","is_admin":True}}))["can_post_official"] is False)
    result={"passed":len(assertions),"assertions":assertions,"postgres":sql("show server_version"),
            "production_contacted":False,"scratch":str(scratch)}
except subprocess.CalledProcessError as e:
    print(e.stderr, file=sys.stderr)
    raise
finally:
    if started:
        command(["pg_ctl","-D",str(data),"-m","fast","-w","stop"])
        assert not (data/"postmaster.pid").exists()
        assert not (socket/".s.PGSQL.55447").exists()
if "result" in locals():
    result["server_stopped"]=True
    output=root/"docs/qa/official-community-posts-db-results.json"
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))
