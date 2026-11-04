import type { CoachFinding, CoachSummary, CoachText } from "../lib/coachReplay";
import type { TranslationKey } from "../i18n/locales/en";

// Demo mode's Coach Replay script, played over the animated demo golfer
// (components/landing/swingMotion) rather than a real video: demo accounts
// have no uploaded swing. Openly fictional like the rest of src/data, and
// written to agree with the demo analysis it is shown on (demo-caddie-1 in
// caddie.ts: strong shoulder rotation, balanced finish, early hip
// extension). The impact fix is that analysis's illustrative issue, not
// something the rig is animated to show. Real accounts never see this:
// their cards come from coachPlanFromV1.
export const DEMO_COACH_ANALYSIS_ID = "demo-caddie-1";

const key = (k: TranslationKey): CoachText => ({ kind: "key", key: k });
const claim = (title: CoachText, body: CoachText) => ({ title, body, source: "demo" });

export function demoCoachFindings(): CoachFinding[] {
  return [
    {
      checkpoint: "address",
      kind: "good",
      rank: 0,
      claim: claim(key("coachReplay.demo.setupTitle"), key("coachReplay.demo.addressGood")),
      cue: { body: key("coachReplay.demo.addressCue"), source: "demo" },
    },
    {
      checkpoint: "top",
      kind: "good",
      rank: 0,
      claim: claim(key("coachReplay.demo.turnTitle"), key("coachReplay.demo.topGood")),
      cue: { body: key("coachReplay.demo.topCue"), source: "demo" },
    },
    { checkpoint: "impact", kind: "good", rank: 0, claim: claim(key("coachReplay.demo.handsTitle"), key("coachReplay.demo.impactGood")) },
    {
      checkpoint: "impact",
      kind: "fix",
      rank: 0,
      claim: claim(key("coachReplay.demo.hipsTitle"), key("coachReplay.demo.impactFix")),
      cue: { body: key("coachReplay.cue.torso"), source: "demo" },
    },
    {
      checkpoint: "finish",
      kind: "good",
      rank: 0,
      claim: claim(key("coachReplay.demo.balanceTitle"), key("coachReplay.demo.finishGood")),
      cue: { body: key("coachReplay.demo.finishCue"), source: "demo" },
    },
  ];
}

// The demo's closing card, from the same demo analysis: its hip issue and
// its drill (demo-caddie-1's "Hip Depth Drill").
export function demoCoachSummary(): CoachSummary {
  return {
    workOn: [claim(key("coachReplay.demo.hipsTitle"), key("coachReplay.demo.summaryWorkOn"))],
    drill: { name: key("coachReplay.demo.drillName"), steps: [key("coachReplay.demo.drillStep1"), key("coachReplay.demo.drillStep2")], source: "demo" },
  };
}
