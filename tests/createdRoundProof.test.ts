import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { completeCreatedRoundProof } from "../src/lib/createdRoundProof.ts";

function hostHandler() {
  const file = "src/pages/CreateGolfCall.tsx";
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "handleSubmit") found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found);
  return ts.transpileModule(found.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

test("proof attachment failure and synchronous throw are bounded failures, not hosting errors", async () => {
  assert.equal(await completeCreatedRoundProof(async () => {}), true);
  assert.equal(await completeCreatedRoundProof(async () => { throw Error("offline"); }), false);
  assert.equal(await completeCreatedRoundProof(() => { throw Error("unavailable"); }), false);
});

for (const versioned of [false, true]) {
  for (const outcome of ["confirmed", "reject", "late-success", "late-failure"] as const) {
    test(`${versioned ? "versioned" : "legacy"} proof ${outcome}: host once, settle once, retain known round`, async () => {
      let resolve!: () => void, reject!: (err: Error) => void;
      const calls: unknown[][] = [];
      const attach = () => {
        calls.push(["attach"]);
        if (outcome === "confirmed") return Promise.resolve();
        if (outcome === "reject") return Promise.reject(Error("offline"));
        return new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      };
      const scope = {
        canSubmit: true, submitting: false, setSubmitting: (v: boolean) => calls.push(["submitting", v]),
        date: "2099-11-20", isDemo: false, hasHosted: false,
        hostRound: async () => { calls.push(["host"]); return { id: "created", ...(versioned ? { bookingStatus: "planned" } : {}) }; },
        pickedCourseId: null, course: "Synthetic", areaLabel: "Synthetic", pickedCourseLat: 40, pickedCourseLng: -74,
        timeLabel: "10 AM", holes: 18, gameFormat: "Standard Stroke Play", price: 50, totalSpots: 4,
        effectiveSkillLevel: "Any Skill Level", vibe: "Casual & Social", walkOrCart: "Either", notes: "",
        tapHaptic: () => {}, track: () => {}, clearHostRoundDraft: () => calls.push(["clear"]),
        proofFile: {}, authUser: { id: "synthetic" }, proofSource: "Other",
        bookAndSubmitAtCreation: attach, attachBookingProofDirect: attach,
        completeCreatedRoundProof: (fn: () => Promise<unknown>) => completeCreatedRoundProof(fn, 5),
        linkCreatedRoundToPost: async () => "linked", fromPostId: "post", attachGolfCallToPost: () => {},
        showToast: (...args: unknown[]) => calls.push(["toast", ...args]), t: (s: string) => s,
        navigate: (...args: unknown[]) => calls.push(["navigate", ...args]),
        isObjectionableContentError: () => false, isAccountSuspendedError: () => false,
      };
      await new Function(...Object.keys(scope), hostHandler() + "; return handleSubmit();")(...Object.values(scope));
      const confirmed = outcome === "confirmed";
      assert.equal(calls.filter(c => c[0] === "host").length, 1);
      assert.equal(calls.filter(c => c[0] === "attach").length, 1);
      assert.equal(calls.filter(c => c[0] === "clear").length, 1);
      assert.deepEqual(calls.filter(c => c[0] === "submitting"), [["submitting", true]], "never re-enables hosting after committed round");
      assert.equal(calls.find(c => c[0] === "navigate")?.[1], confirmed ? "/community/post" : "/golf-calls/created");
      assert.deepEqual(calls.filter(c => c[0] === "toast"), [["toast", confirmed ? "host.postedFreshToast" : "host.roundProofUnconfirmed", confirmed ? "success" : "warning"]]);
      const before = JSON.stringify(calls);
      if (outcome === "late-success") resolve();
      if (outcome === "late-failure") reject(Error("late offline"));
      await new Promise(r => setTimeout(r, 0));
      assert.equal(JSON.stringify(calls), before, "late proof never repeats navigation, toast or hosting");
    });
  }
}
