"""Emit the disposable test fixture and real function bodies to stdout.
Never load this into an app database. Used by isolated PostgreSQL tests only.
"""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def read(p): return (root/p).read_text()
def extract(sql,name):
    start=sql.index('create function '+name+'(')
    return sql[start:sql.index('$$;',start)+3]
print(read('supabase/tests/caddie_feedback_fixture.sql'))
moderation=read('supabase/migrations/20261107270000_admin_moderation.sql')
for name in ['private.is_suspended','private.reject_suspended_write']: print(extract(moderation,name))
filters=read('supabase/migrations/20260930120000_add_objectionable_content_filter.sql')
for name in ['private.text_is_objectionable','private.reject_objectionable_text']: print(extract(filters,name))
print("""
create trigger reject_suspended_write before insert on public.community_posts for each row execute function private.reject_suspended_write('author_id');
create trigger filter_objectionable_text before insert or update of text,course_tag on public.community_posts for each row execute function private.reject_objectionable_text('text','course_tag');
""")
print(read('supabase/migrations/20260924110000_delete_community_post_with_media_cleanup.sql'))
print(read('supabase/migrations/20261117150000_caddie_feedback_post_link.sql'))
