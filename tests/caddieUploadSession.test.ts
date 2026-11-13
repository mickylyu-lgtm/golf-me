import { test } from "node:test";
import assert from "node:assert/strict";
import { createCaddieUploadSession } from "../src/lib/caddieUploadSession.ts";
import { createVideoSelectionGate } from "../src/lib/videoSelection.ts";

function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  return { values, storage, session: createCaddieUploadSession(() => storage) };
}
test("active upload survives remount without a false interrupted warning", () => {
  const { session, values } = fixture();
  const finish = session.begin();
  assert.equal(session.consumeInterrupted(), false);
  assert.equal(values.size, 1);
  finish();
  assert.equal(values.size, 0);
});
test("older and repeated completions cannot clear a newer upload marker", () => {
  const { session, values } = fixture();
  const a = session.begin();
  const b = session.begin();
  a(); a();
  assert.equal(values.size, 1);
  assert.equal(session.consumeInterrupted(), false);
  b();
  assert.equal(values.size, 0);
});
test("a genuinely new JS session consumes an interrupted marker only once", () => {
  const { session, storage } = fixture();
  session.begin();
  const restarted = createCaddieUploadSession(() => storage);
  assert.equal(restarted.consumeInterrupted(), true);
  assert.equal(restarted.consumeInterrupted(), false);
});
test("unavailable storage never prevents analysis or completion", () => {
  const session = createCaddieUploadSession(() => { throw new Error("denied"); });
  assert.equal(session.consumeInterrupted(), false);
  const finish = session.begin();
  assert.doesNotThrow(finish);
});
test("departed upload view cannot own completion even after StrictMode reopen", () => {
  const gate = createVideoSelectionGate();
  const a = gate.begin();
  gate.close(); gate.open();
  assert.equal(gate.isCurrent(a), false);
  const b = gate.begin();
  gate.end(a);
  assert.equal(gate.isCurrent(b), true);
});

// Execute the actual submit handler with deferred storage/API responses.
// No production requests, files, or accounts are involved.
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../src/pages/AnalyzeSwing.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("AnalyzeSwing.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleAnalyze") handler = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handler);
const javascript = ts.transpile(handler, { target: ts.ScriptTarget.ES2022 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((r, fail) => { resolve = r; reject = fail; });
  return { promise, resolve, reject };
}
function handlerFixture() {
  const upload = deferred<{error: null}>();
  const gate = createVideoSelectionGate();
  const draft = { file: {name: "a.mp4", type: "video/mp4"}, previewUrl: "blob:a" };
  const state = { draft: draft as typeof draft | undefined, navigation: [] as string[], toast: [] as string[], created: 0 };
  const session = fixture().session;
  const scope = {
    preparingPick: false, readingPick: false, selectionGate: {pending:false}, submitGate: gate,
    authUser: {id:"test"}, canStartAnalysis: () => true, videoFile: draft.file, hasClub:true,
    submitting:false, pendingTrim:null, trimReopening:false, trimReopenGate:{pending:false},
    draftSwingVideo:draft, currentDraftRef:{current:draft}, setSubmitting: () => {},
    readVideoDuration:async()=>6, caddieDurationRejection:()=>null,
    showToast:(message:string)=>state.toast.push(message), t:(key:string)=>key,
    caddieUploadSession:session, crypto:{randomUUID:()=>"test"},
    startOptionalUpload:()=>({settle:async()=>undefined, abandon:()=>{}}),
    captureVideoThumbnail:async()=>new Blob(), CADDIE_MEDIA_BUCKET:"test", THUMBNAIL_GRACE_MS:0,
    supabase:{storage:{from:()=>({upload:()=>upload.promise,remove:async()=>({error:null})})}},
    createCaddieAnalysis:async()=>{state.created++; return {id:"analysis-a"};}, swingType:"Driver",
    setDraftSwingVideo:(value:typeof draft|undefined)=>{state.draft=value;},
    navigate:(path:string)=>state.navigation.push(path), CaddieRequestError:class extends Error {},
    caddieErrorText:()=>"error", console:{error:()=>{}},
  };
  const run = new Function(...Object.keys(scope), javascript + ";return handleAnalyze;")(...Object.values(scope)) as ()=>Promise<void>;
  return {run, upload, gate, state, draft, scope};
}
test("actual handler: departed A completes its job without clearing B or navigating", async () => {
  const f=handlerFixture();
  const pending=f.run();
  await new Promise<void>((r)=>setImmediate(r));
  f.gate.close();
  const b={file:{name:"b.mp4",type:"video/mp4"},previewUrl:"blob:b"};
  f.state.draft=b;
  f.upload.resolve({error:null});
  await pending;
  assert.equal(f.state.created,1);
  assert.equal(f.state.draft,b);
  assert.deepEqual(f.state.navigation,[]);
  assert.deepEqual(f.state.toast,[]);
});
test("actual handler: current successful upload clears its own draft and opens result", async()=>{
  const f=handlerFixture();
  const pending=f.run();
  f.upload.resolve({error:null});
  await pending;
  assert.equal(f.state.draft,undefined);
  assert.deepEqual(f.state.navigation,["/caddie/analysis-a"]);
});
test("actual handler: leaving during duration read never starts upload or analysis", async()=>{
  const f=handlerFixture();
  const pending=f.run();
  f.gate.close();
  await pending;
  assert.equal(f.state.created,0);
  assert.equal(f.state.draft,f.draft);
  assert.deepEqual(f.state.navigation,[]);
});

test("actual handler: departed upload failure does not toast into a new screen", async()=>{
  const f=handlerFixture();
  const pending=f.run();
  await new Promise<void>((r)=>setImmediate(r));
  f.gate.close();
  f.upload.reject(new Error("offline"));
  await pending;
  assert.deepEqual(f.state.toast,[]);
  assert.deepEqual(f.state.navigation,[]);
  assert.equal(f.scope.caddieUploadSession.consumeInterrupted(),false);
});
test("actual handler: duplicate synchronous submit starts just one request", async()=>{
  const f=handlerFixture();
  const first=f.run();
  const duplicate=f.run();
  f.upload.resolve({error:null});
  await Promise.all([first,duplicate]);
  assert.equal(f.state.created,1);
});
