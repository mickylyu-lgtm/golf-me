import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { hasRoundCourseLocation } from "../src/lib/roundCourseLocation.ts";
import { linkCreatedRoundToPost } from "../src/lib/createdRoundPost.ts";

const source = (file: string) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function handler(file: string, name: string) {
  const code = source(file);
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found);
  return ts.transpileModule(found.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

test("round location requires both finite, valid coordinates (zero is valid)", () => {
  assert.equal(hasRoundCourseLocation(0, 0), true);
  assert.equal(hasRoundCourseLocation(40.7, -74), true);
  for (const [lat, lng] of [[null, -74], [40, null], [NaN, 2], [1, Infinity], [91, 2], [1, -181]]) {
    assert.equal(hasRoundCourseLocation(lat, lng), false);
  }
});

test("Edit Tee Time save is gated on coordinates and offers the existing town picker", () => {
  const s = source("src/components/golfcall/EditTeeTimeModal.tsx");
  assert.match(s, /const canSave =[^;]*&& courseHasLocation && !startsInPast/);
  assert.match(s, /setCourseLat\(null\)/);
  assert.match(s, /<LocationPicker/);
  assert.match(s, /setCourseLat\(area.coords.lat\)/);
  assert.match(s, /setCourseLng\(area.coords.lng\)/);
});

test("optional post linking returns success/failure without failing the already-created round", async () => {
  const calls: string[][] = [];
  const attach = async (...args: string[]) => { calls.push(args); };
  assert.equal(await linkCreatedRoundToPost(null, "round", attach), "none");
  assert.equal(calls.length, 0);
  assert.equal(await linkCreatedRoundToPost("post", "round", attach), "linked");
  assert.deepEqual(calls, [["post", "round"]]);
  assert.equal(await linkCreatedRoundToPost("post", "round", async () => { throw Error("uncertain"); }), "failed");
});

for (const demo of [true, false]) {
  for (const attachFails of [true, false]) {
    test(`${demo ? "demo" : "real"} host handler links once; attachment ${attachFails ? "failure never retries hosting" : "success returns to original post"}`, async () => {
      const calls: unknown[][] = []; let hosted = 0;
      const scope = {
        canSubmit: true, submitting: false, setSubmitting: () => {}, date: "2099-11-20", isDemo: demo,
        createGolfCall: () => { hosted++; return { id: "new-round" }; },
        course: "Synthetic course", areaLabel: "Synthetic town", distanceMiles: 1, timeLabel: "10 AM", price: 50, totalSpots: 4,
        joinMode: "instant", effectiveSkillLevel: "Any Skill Level", vibe: "Casual & Social", walkOrCart: "Either", holes: 18,
        gameFormat: "Standard Stroke Play", notes: "", fillMode: false, friendIds: [], fromPostId: "original-post", linkCreatedRoundToPost,
        attachGolfCallToPost: async (...args: unknown[]) => { calls.push(["attach", ...args]); if (attachFails) throw Error("uncertain"); },
        tapHaptic: () => {}, track: () => {}, clearHostRoundDraft: () => calls.push(["clear"]),
        showToast: (...args: unknown[]) => calls.push(["toast", ...args]), t: (s: string) => s,
        navigate: (...args: unknown[]) => calls.push(["navigate", ...args]), hasHosted: false,
        hostRound: async () => { hosted++; return { id: "new-round" }; }, pickedCourseId: null, pickedCourseLat: 40, pickedCourseLng: -74,
        proofFile: null, authUser: { id: "synthetic" }, isObjectionableContentError: () => false, isAccountSuspendedError: () => false,
      };
      await new Function(...Object.keys(scope), handler("src/pages/CreateGolfCall.tsx", "handleSubmit") + "; return handleSubmit();")(...Object.values(scope));
      assert.equal(hosted, 1);
      assert.deepEqual(calls.filter((c) => c[0] === "attach"), [["attach", "original-post", "new-round"]]);
      assert.equal(calls.find((c) => c[0] === "navigate")?.[1], attachFails ? "/golf-calls/new-round" : "/community/original-post");
      assert.equal(calls.find((c) => c[0] === "toast")?.[1], attachFails ? "host.roundLinkFailed" : "host.postedFreshToast");
      assert.equal(calls.filter((c) => c[0] === "clear").length, 1);
    });
  }
}

test("post action is owner-only; real link update cannot overwrite an existing link and checks returned row", () => {
  assert.match(source("src/pages/PostDetail.tsx"), /post.authorId === currentUser.id && !post.golfCallId/);
  const s = source("src/context/RealCommunityContext.tsx");
  assert.match(s, /\.eq\("author_id", selfId\)\.is\("golf_call_id", null\)\.select\("id"\)\.maybeSingle\(\)/);
  assert.match(s, /if \(!data\) throw new Error\("The post could not be linked."\)/);
});


test("pending post link has a deadline; late completion does not rerun hosting or finalization", async () => {
  let resolve!: () => void; let calls = 0;
  const result = await linkCreatedRoundToPost("post", "round", () => {
    calls++;
    return new Promise<void>((yes) => { resolve = yes; });
  }, 5);
  assert.equal(result, "failed");
  resolve(); await Promise.resolve();
  assert.equal(calls, 1);
});
