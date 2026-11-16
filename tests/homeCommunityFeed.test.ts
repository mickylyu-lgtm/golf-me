import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { feedCutoff } from "../src/lib/followingFeed.ts";
import { listView } from "../src/lib/loadStatus.ts";
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('src/pages/Home.tsx');
// Execute the actual Home memo body, not a copied implementation.
function callback(source: string, name: string) {
  const ast = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body = '';
  function visit(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name && n.initializer && ts.isCallExpression(n.initializer)) {
      body = n.initializer.arguments[0].getText(ast);
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
  assert.ok(body, name);
  return ts.transpile('const callback = ' + body, { target: ts.ScriptTarget.ES2022 });
}
const build = new Function('allPosts', 'golfCalls', 'followingIds', 'currentUser', 'getGolfer', 'isPastRound', 'followedPosts', 'serverHasMore', 'feedCutoff', 'community', callback(home, 'feed') + '; return callback();');
const post = (id: string, authorId: string, at: number) => ({ id, authorId, createdAt: new Date(at * 1000).toISOString() });
const run = (posts: unknown[], following: string[] = [], rounds: unknown[] = [], supplemental: unknown[] = [], hasMore = false) => build(posts, rounds, new Set(following), { id: 'self' }, (id: string) => id === 'missing' ? undefined : { id }, (r: { past?: boolean }) => r.past, supplemental, hasMore, feedCutoff, {posts});

test('newer non-followed and own posts appear before older followed posts', () => {
  assert.deepEqual(run([post('old', 'friend', 1), post('new', 'stranger', 3), post('own', 'self', 2)], ['friend']).map((x: {key:string}) => x.key), ['post-new','post-own','post-old']);
});
test('following does not gate posts, including zero follows and more than three posts', () => {
  const posts = Array.from({length: 30}, (_, i) => post(String(i), 'stranger', i));
  assert.equal(run(posts).length, 30);
  assert.deepEqual(run(posts), run(posts, ['friend']));
});
test('round activity still requires a followed host or participant and excludes own, cancelled, past and unavailable actors', () => {
  const round = (id: string, patch = {}) => ({id, hostId:'stranger', status:'open', joinedGolferIds:[], createdAt:new Date(2000).toISOString(), ...patch});
  const result = run([post('new','stranger',3)], ['friend','missing'], [round('host',{hostId:'friend'}), round('joined',{joinedGolferIds:['friend']}), round('unfollowed'), round('own',{hostId:'self',joinedGolferIds:['friend']}), round('cancelled',{hostId:'friend',status:'cancelled'}), round('past',{hostId:'friend',past:true}), round('missing',{hostId:'missing'})]);
  assert.deepEqual(result.map((x: {key:string}) => x.key), ['post-new','round-host','round-joined']);
  assert.equal(result[1].hosting,true); assert.equal(result[2].hosting,false);
});
test('Home uses actual visiblePosts filtering for blocked either direction and individually hidden posts', () => {
  const filter = new Function('posts','blockedIds','blockedByIds','isPostHidden',callback(read('src/context/DataContext.tsx'),'visiblePosts') + '; return callback();');
  const safe = filter([post('good','stranger',1),post('out','blocked',2),post('in','blocker',3),post('hidden','friend',4)], ['blocked'], ['blocker'], (id: string) => id === 'hidden');
  assert.deepEqual(run(safe).map((x: {key:string}) => x.key), ['post-good']);
  assert.match(home, /\[\.\.\.visiblePosts\(\)\]/);
  assert.doesNotMatch(home, /COMMUNITY_PREVIEW_COUNT|allPosts\.slice/);
});
test('large loaded feeds retain six-item slicing and observer cleanup', () => {
  const result = run(Array.from({length: 120},(_,i) => post(String(i),'stranger',i)));
  assert.equal(result.length,120);
  assert.match(home,/const FEED_STEP = 6/);
  assert.match(home,/feed\.slice\(0, feedShown\)/);
  assert.match(home,/setFeedShown\(\(n\) => n \+ FEED_STEP\)/);
  assert.match(home,/observer\.disconnect\(\)/);
});
test('loading, first-load failure, true empty, demo and retained stale content are distinct', () => {
  const state = {count:0,isDemo:false,hasLoaded:false,loadError:false,isLoading:true};
  assert.equal(listView(state),'loading');
  assert.equal(listView({...state,loadError:true,isLoading:false}),'error');
  assert.equal(listView({...state,hasLoaded:true,isLoading:false}),'empty');
  assert.equal(listView({...state,isDemo:true}),'empty');
  assert.equal(listView({...state,count:1,loadError:true}),'list');
  assert.match(home,/view === "loading"/); assert.match(home,/view === "error"/);
  assert.match(home,/community.refreshFailed && <StaleDataNotice onRetry=\{community.retry\}/);
});

test('existing database boundaries remain authoritative: removed posts, hidden suspended content, deleted accounts and private connection data', () => {
  const moderation = read('supabase/migrations/20261107270000_admin_moderation.sql');
  assert.match(moderation, /using \(\s*removed_at is null\s*and \(author_id = \(select auth.uid\(\)\) or author_id <> all/);
  assert.match(moderation, /where s.hide_content\s*and \(s.suspended_until is null or s.suspended_until > now\(\)\)/);
  assert.match(read('supabase/migrations/20260816143600_create_real_community.sql'), /author_id uuid not null references auth.users\(id\) on delete cascade/);
  const privacy = read('supabase/migrations/20261111082608_private_social_controls.sql');
  assert.match(privacy, /Private = approval for NEW follows only\. Profile\/posts remain public/);
  assert.match(privacy, /create policy follows_select_participant_guard[\s\S]*?as restrictive/);
  const real = read('src/context/RealCommunityContext.tsx');
  assert.match(real, /supabase.from\("community_posts"\).select\("\*"\).order\("created_at", \{ ascending: false \}\)/);
});


test('all-author pager keeps loaded community posts visible while preserving round cutoff and release', () => {
  const context = [post('community','stranger',8)];
  const rounds = [{id:'older-round',hostId:'friend',status:'open',joinedGolferIds:[],createdAt:new Date(2000).toISOString()}];
  assert.deepEqual(run(context,['friend'],rounds,[],true).map((x: {key:string}) => x.key),['post-community']);
  assert.deepEqual(run(context,['friend'],rounds,[],false).map((x: {key:string}) => x.key),['post-community','round-older-round']);
  assert.match(home,/community.loadOlderPosts/);
  assert.match(home,/community.pageError/);
  assert.match(home,/const moreFeed = feedShown < feed.length \|\| serverHasMore/);
});
