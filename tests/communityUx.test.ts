import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadCommunityPostDraft, saveCommunityPostDraft, clearCommunityPostDraft } from "../src/lib/communityPostDraft.ts";

test("drafts restore only to their owner and preserve other accounts", () => {
  const items = new Map<string,string>([["golfme:communityPostDraft", '{"text":"unowned legacy"}']]);
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {localStorage: {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string,v: string) => { items.set(k,v); },
    removeItem: (k: string) => { items.delete(k); },
  }}});
  try {
    const draft = { text: "A's caption", activeTool: "none" as const, mediaItems: [], category: "General" as const, requestCoachReview: false };
    assert.equal(loadCommunityPostDraft("user:A"), null);
    saveCommunityPostDraft("user:A",draft);
    assert.equal(loadCommunityPostDraft("user:B"), null);
    assert.equal(loadCommunityPostDraft("demo"), null);
    assert.equal(loadCommunityPostDraft(null), null);
    saveCommunityPostDraft("user:B",{...draft,text:"B"});
    clearCommunityPostDraft("user:B");
    assert.equal(loadCommunityPostDraft("user:A")?.text, draft.text);
    assert.equal(items.get("golfme:communityPostDraft"), '{"text":"unowned legacy"}');
  } finally {
    if (original) Object.defineProperty(globalThis,"window",original);
    else Reflect.deleteProperty(globalThis,"window");
  }
});

const source = readFileSync(new URL("../src/pages/Community.tsx", import.meta.url), "utf8");
const ast=ts.createSourceFile("Community.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let toggle: ts.FunctionDeclaration | undefined;
let observerEffect: ts.ArrowFunction | undefined;
function visit(n: ts.Node) {
  if(ts.isFunctionDeclaration(n)&&n.name?.text==="toggleSearch")toggle=n;
  if(ts.isCallExpression(n)&&n.expression.getText(ast)==="useEffect"&&n.arguments[0]?.getText(ast).includes("IntersectionObserver")) observerEffect=n.arguments[0] as ts.ArrowFunction;
  ts.forEachChild(n,visit);
}
visit(ast);

test("closing the Community search resets the hidden filter", () => {
  assert.ok(toggle?.body);
  const run = new Function("showSearch","setSearch","setShowSearch",toggle.body.getText(ast));
  let query="old query"; let shown=true;
  run(true,(v:string)=>query=v,(v:boolean)=>shown=v);
  assert.equal(query,"");assert.equal(shown,false);
  run(false,()=>assert.fail("opening must not clear"),(v:boolean)=>shown=v);
  assert.equal(shown,true);
});

test("Community sentinel requests older pages and stops on errors/loading", () => {
  assert.ok(observerEffect?.body);
  const run=new Function("endRef","hasOlder","community","IntersectionObserver","loadOlder",observerEffect.body.getText(ast));
  let callback: (entries: {isIntersecting:boolean}[])=>void = ()=>{};
  let observed=0,disconnected=0,loaded=0;
  class Observer {
    constructor(cb: typeof callback){callback=cb;}
    observe(){observed++;}
    disconnect(){disconnected++;}
  }
  for(const community of [{isPaging:true,pageError:false},{isPaging:false,pageError:true}])
    run({current:{}},true,community,Observer,()=>loaded++);
  assert.equal(observed,0);
  const cleanup=run({current:{}},true,{isPaging:false,pageError:false},Observer,()=>loaded++);
  assert.equal(observed,1);
  callback([{isIntersecting:false}]); assert.equal(loaded,0);
  callback([{isIntersecting:true}]); assert.equal(loaded,1);
  cleanup();assert.equal(disconnected,1);
  assert.match(source,/onRetry={loadOlder}/);
  assert.match(source,/disabled={community.isPaging}/);
  assert.match(source,/feed.length === 0 && !hasOlder/);
});

test("composer remounts on owner changes and scopes all draft operations", () => {
 const composer=readFileSync(new URL("../src/pages/CreatePost.tsx",import.meta.url),"utf8");
 assert.match(composer,/<CreatePostForOwner key={owner/);
 assert.match(composer,/loadCommunityPostDraft\(draftOwner\)/);
 assert.match(composer,/saveCommunityPostDraft\(draftOwner,/);
 assert.match(composer,/clearCommunityPostDraft\(draftOwner\)/);
});

test("late publish completion after owner unmount cannot clear or navigate", async () => {
 const composer=readFileSync(new URL("../src/pages/CreatePost.tsx",import.meta.url),"utf8");
 const tree=ts.createSourceFile("CreatePost.tsx",composer,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let body="";
 function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==="handlePost")body=n.body!.getText(tree);ts.forEachChild(n,visit);}
 visit(tree);
 const js=ts.transpileModule(`async function run() ${body}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let resolve!:()=>void;
 const activeInstance={current:true};
 let sideEffects=0;
 const noop=()=>{};
 const deps={
  activeInstance,canPost:true,posting:false,isOfficial:false,officialCapability:{canPostOfficial:false},
  mediaLedger:{pending:0},kind:"none",setPosting:noop,setUploadProgress:noop,
  createPost:()=>new Promise<void>(r=>{resolve=r}),text:"caption",mediaItems:[],category:"General",
  tapHaptic:()=>sideEffects++,clearCommunityPostDraft:()=>sideEffects++,draftOwner:"user:A",
  showToast:()=>sideEffects++,navigate:()=>sideEffects++,
 };
 const run=new Function(...Object.keys(deps),js+"; return run;")(...Object.values(deps));
 const pending=run();
 activeInstance.current=false;
 resolve();
 await pending;
 assert.equal(sideEffects,0);
 assert.match(composer,/if \(abandoned\(\)\) return;\s+setUploadProgress\("publishing"\)/);
});
