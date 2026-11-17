// Isolated PostgreSQL WASM test. No production connection or secrets are read.
// npm install --prefix /tmp/caddie-pg-test @electric-sql/pglite
// PGLITE_MODULE=/tmp/caddie-pg-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-caddie-share-db.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const read = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
const extract = (sql, name) => {
 const start=sql.indexOf('create function '+name+'(');
 assert(start>=0, name);
 const end=sql.indexOf('$$;',start);
 return sql.slice(start,end+3);
};
try {
 await db.exec(await read('supabase/tests/caddie_feedback_fixture.sql'));
 const moderation=await read('supabase/migrations/20261107270000_admin_moderation.sql');
 for (const name of ['private.is_suspended','private.reject_suspended_write']) await db.exec(extract(moderation,name));
 const filter=await read('supabase/migrations/20260930120000_add_objectionable_content_filter.sql');
 for (const name of ['private.text_is_objectionable','private.reject_objectionable_text']) await db.exec(extract(filter,name));
 await db.exec(`create trigger reject_suspended_write before insert on public.community_posts for each row execute function private.reject_suspended_write('author_id');
 create trigger filter_objectionable_text before insert or update of text,course_tag on public.community_posts for each row execute function private.reject_objectionable_text('text','course_tag');`);
 await db.exec(await read('supabase/migrations/20260924110000_delete_community_post_with_media_cleanup.sql'));
 await db.exec(await read('supabase/migrations/20261117150000_caddie_feedback_post_link.sql'));
 await db.exec(await read('supabase/tests/caddie_feedback_share.sql'));
 console.log('PASS: authenticated/anonymous ownership, retry, deletion (direct and real RPC), legacy, filters, suspension, moderation, FK protection and rollback assertions');
 console.log('LIMIT: reduced fixture schema; single-session PGlite cannot verify real multi-session concurrency or full Supabase schema.');
} finally { await db.close(); }
