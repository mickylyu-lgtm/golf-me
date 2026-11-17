"""Real multi-session PostgreSQL test for an already-loaded disposable fixture.
Run: python3 scripts/test-caddie-share-concurrency.py postgresql://.../caddie_share_test
Only loopback hosts and that exact database name are accepted. No prod secrets read.
Requires psql and supabase/tests/caddie_feedback_fixture.sql + migration/functions
loaded as in test-caddie-share-db.mjs. Never point at the real app database.
"""
import json, subprocess, sys, time
from urllib.parse import urlparse
uri = sys.argv[1]
u = urlparse(uri)
assert u.hostname in ('localhost', '127.0.0.1', '::1') and u.path == '/caddie_share_test', 'Disposable local database only'
A = '00000000-0000-0000-0000-000000000001'
OWNER = '00000000-0000-0000-0000-000000000010'
base = ['psql', uri, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
def query(sql):
    return subprocess.check_output(base+['-c',sql], text=True).strip()
def auth(sql):
    return f"begin; set local role authenticated; set local request.jwt.claim.sub='{OWNER}'; {sql}; commit;"
def spawn(sql):
    return subprocess.Popen(base+['-c',sql], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
def result(p):
    out, err = p.communicate(timeout=15)
    assert p.returncode == 0, err
    return [json.loads(line) for line in out.splitlines() if line.startswith('{')]
def reset(legacy=False):
    query(f"delete from public.community_posts; update public.caddie_analyses set shared_to_community={'true' if legacy else 'false'} where id='{A}'")
def share(confirm=False):
    return f"select public.share_caddie_feedback('{A}','Concurrent feedback',{'true' if confirm else 'false'})"
def verify():
    assert query('select count(*) from public.community_posts') in ('0','1')
    assert query("select count(*) from public.caddie_analyses a left join public.community_posts p on p.id=a.feedback_post_id where (a.feedback_post_id is not null and p.id is null) or (a.feedback_post_id is null and a.shared_to_community)") == '0'
def wait_for(sql):
    deadline=time.monotonic()+2
    while time.monotonic()<deadline:
        if query(sql)=='t': return
        time.sleep(.03)
    raise AssertionError('Did not observe expected database lock coordination')
for legacy in [False, True]:
    reset(legacy)
    # First session holds the analysis row lock while the second tries sharing.
    first=spawn(auth("set local application_name='caddie_first'; "+share(legacy)+'; select pg_sleep(3)'))
    wait_for("select exists(select 1 from pg_stat_activity where application_name='caddie_first' and wait_event='PgSleep')")
    second=spawn(auth("set local application_name='caddie_second'; "+share(legacy)))
    wait_for("select exists(select 1 from pg_stat_activity s where s.application_name='caddie_second' and s.wait_event_type='Lock' and exists(select 1 from pg_stat_activity f where f.application_name='caddie_first' and f.pid=any(pg_blocking_pids(s.pid))))")
    r1, r2=result(first)[0], result(second)[0]
    assert {r1['outcome'],r2['outcome']} == {'created','existing'}
    assert r1['post_id']==r2['post_id']
    verify()
# Race the production deletion RPC against retry in separate real sessions.
for _ in range(10):
    reset()
    p=json.loads(query(auth(share())))['post_id']
    delete=spawn(auth(f"select public.delete_community_post('{p}')"))
    retry=spawn(auth(share()))
    result(delete); result(retry)
    verify()
    final=json.loads(query(auth(share())))
    assert final['outcome'] in ('existing','created')
    verify()
reset()
print('PASS: concurrent initial+legacy share and 10 deletion/retry races; no duplicate active posts')
