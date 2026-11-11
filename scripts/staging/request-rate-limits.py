#!/usr/bin/env python3
"""Run only against a fresh private-socket cluster using an existing PG runtime.
No downloads, production credentials, TCP listener, or customer data.
Usage: python3 scripts/staging/request-rate-limits.py /path/to/pg-runtime
"""
import concurrent.futures, json, os, pathlib, subprocess, sys, tempfile

root = pathlib.Path(__file__).resolve().parents[2]
runtime = pathlib.Path(sys.argv[1]).resolve()
bin_dir = runtime / "usr/lib/postgresql/17/bin"
assert (bin_dir / "initdb").is_file(), "Supply the verified existing PostgreSQL 17 runtime"
assert os.geteuid() != 0, "Run as the ordinary development user"
scratch = pathlib.Path(tempfile.mkdtemp(prefix="golfme-rate-limits-pg17-"))
data, socket = scratch / "data", scratch / "socket"
socket.mkdir(mode=0o700)
env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
env.update(LD_LIBRARY_PATH=str(runtime / "usr/lib/x86_64-linux-gnu"),
           PGHOST=str(socket), PGPORT="55441", PGUSER="postgres", PGDATABASE="postgres")
started = False
assertions = []
def command(args, **kwargs):
    return subprocess.run([str(bin_dir / args[0]), *args[1:]], env=env,
                          text=True, capture_output=True, check=True, **kwargs)
def sql(query):
    return command(["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query]).stdout.strip()
def check(name, value):
    if not value: raise AssertionError(name)
    assertions.append(name)
A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"
def caller(query, user=A, role="authenticated", anonymous=False):
    claims = json.dumps({"sub": user, "role": role, "is_anonymous": anonymous})
    return sql("set role " + role + "; set request.jwt.claims = '" + claims + "'; " + query).splitlines()[-1]
def take(action="chat-video", user=A):
    return json.loads(caller("select public.consume_request_budget('" + action + "');", user))
def rejected(query, user=A, role="authenticated", anonymous=False):
    try:
        caller(query, user, role, anonymous)
        return False
    except subprocess.CalledProcessError:
        return True
try:
    command(["initdb", "-D", str(data), "-U", "postgres", "-A", "trust", "--no-locale"])
    command(["pg_ctl", "-D", str(data), "-l", str(scratch / "server.log"), "-w", "start", "-o",
      "-F -c listen_addresses='' -c unix_socket_directories='" + str(socket) + "' -c unix_socket_permissions=0700 -p 55441"])
    started = True
    sql("""create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth; grant usage on schema auth to anon, authenticated, service_role;
      create table auth.users (id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(auth.jwt()->>'sub','')::uuid $$;
      insert into auth.users values ('""" + A + """'), ('""" + B + """');""")
    command(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-f",
             str(root / "supabase/migrations/20261111151846_request_rate_limits.sql")])
    check("no TCP listener", sql("show listen_addresses") == "")
    check("authenticated role has no superuser or RLS bypass", sql(
      "select not rolsuper and not rolbypassrls from pg_roles where rolname='authenticated'") == "t")
    check("counter table RLS enabled", sql(
      "select relrowsecurity from pg_class where oid='private.request_rate_limits'::regclass") == "t")
    check("caller cannot read counters", rejected("select * from private.request_rate_limits"))
    check("caller cannot reset counters", rejected("delete from private.request_rate_limits"))
    check("anonymous role cannot call RPC", rejected("select public.consume_request_budget('chat-video')", role="anon"))
    check("service role has no default public execute grant", rejected("select public.consume_request_budget('chat-video')", role="service_role"))
    check("no-user identity rejected", rejected("select public.consume_request_budget('chat-video')", user=""))
    check("anonymous signed-in identity rejected", rejected("select public.consume_request_budget('chat-video')", anonymous=True))
    check("unknown actions rejected", rejected("select public.consume_request_budget('invented')"))
    check("null action rejected", rejected("select public.consume_request_budget(null)"))
    check("server derives own user only", rejected(
      "select public.consume_request_budget('chat-video','" + B + "')"))
    # Real concurrent sessions across processes, not a mocked rate limiter.
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        replies = list(pool.map(lambda _: take(), range(48)))
    check("48 racing requests admit exactly 30", sum(x["allowed"] for x in replies) == 30)
    check("rejections provide bounded Retry-After", all(
      1 <= x["retry_after_seconds"] <= 60 for x in replies if not x["allowed"]))
    check("rejected requests do not consume day quota", sql(
      "select minute_used=30 and day_used=30 from private.request_rate_limits where user_id='" + A + "'") == "t")
    check("second user has independent budget", take(user=B)["allowed"])
    check("second action has independent budget", take("course-search")["allowed"])
    sql("update private.request_rate_limits set minute_started_at=clock_timestamp()-interval '61 seconds' where user_id='" + A + "' and action='chat-video'")
    check("minute resets when elapsed", take()["allowed"])
    check("minute rollover does not reset day count", sql(
      "select minute_used=1 and day_used=31 from private.request_rate_limits where user_id='" + A + "' and action='chat-video'") == "t")
    sql("update private.request_rate_limits set day_used=120, minute_used=0 where user_id='" + A + "' and action='chat-video'")
    blocked = take()
    check("daily quota survives minute reset", not blocked["allowed"] and 1 <= blocked["retry_after_seconds"] <= 86400)
    check("daily denial spends no minute slot", sql(
      "select minute_used=0 from private.request_rate_limits where user_id='" + A + "' and action='chat-video'") == "t")
    sql("update private.request_rate_limits set day_started_at=clock_timestamp()-interval '25 hours', minute_started_at=clock_timestamp()-interval '61 seconds' where user_id='" + A + "' and action='chat-video'")
    check("day recovers after expiry", take()["allowed"])
    for action, limit in [("course-search",30),("course-enrich",10),("course-photos",120),("translate-caddie-analysis",12)]:
        sql("delete from private.request_rate_limits where user_id='" + A + "' and action='" + action + "'")
        replies = [take(action) for _ in range(limit + 1)]
        check(action + " exact minute boundary", sum(x["allowed"] for x in replies) == limit)
    check("at most five bounded rows per account", sql(
      "select count(*)=5 from private.request_rate_limits where user_id='" + A + "'") == "t")
    sql("delete from auth.users where id='" + A + "'")
    check("account deletion removes counters", sql(
      "select count(*)=0 from private.request_rate_limits where user_id='" + A + "'") == "t")
    result = {"passed": len(assertions), "assertions": assertions, "scratch": str(scratch),
              "postgres": sql("show server_version"), "production_contacted": False}
finally:
    if started:
        command(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"])
        assert not (data / "postmaster.pid").exists()
        assert not (socket / ".s.PGSQL.55441").exists()
if "result" in locals():
    result["server_stopped"] = True
    (root / "docs/qa/request-rate-limits-db-results.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
