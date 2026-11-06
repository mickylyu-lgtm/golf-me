import type { CaddieAnalysis } from "../types";
import type { TranslationKey } from "../i18n/locales/en";

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;
type LegacyFeedback = Pick<CaddieAnalysis, "analysisSummary" | "strengths" | "issues" | "recommendations">;

// The demo rows' feedback, as keys, so the demo's Caddie reads fully in the
// Caddie language (demo has no translation backend). The stored English
// below stays the source text (and what Home's card and old saved demo
// data hold); these keys are its translations.
const DEMO_FEEDBACK_KEYS: Record<string, { summary: TranslationKey; strengths: TranslationKey[]; issues: TranslationKey[]; recommendations: TranslationKey[] }> = {
  "demo-caddie-1": {
    summary: "caddie.demo.one.summary",
    strengths: ["caddie.demo.one.strength1", "caddie.demo.one.strength2"],
    issues: ["caddie.demo.one.issue1", "caddie.demo.one.issue2"],
    recommendations: ["caddie.demo.one.rec1", "caddie.demo.one.rec2"],
  },
  "demo-caddie-2": {
    summary: "caddie.demo.two.summary",
    strengths: ["caddie.demo.two.strength1", "caddie.demo.two.strength2"],
    issues: ["caddie.demo.two.issue1"],
    recommendations: ["caddie.demo.two.rec1", "caddie.demo.two.rec2"],
  },
};

// A legacy (no `details`) row's flat feedback for display: the demo's own
// rows translated, every other row exactly as stored.
export function demoLegacyFeedback(analysis: LegacyFeedback & Pick<CaddieAnalysis, "id">, t: T): LegacyFeedback {
  const keys = DEMO_FEEDBACK_KEYS[analysis.id];
  if (!keys) return analysis;
  return {
    analysisSummary: t(keys.summary),
    strengths: keys.strengths.map((k) => t(k)),
    issues: keys.issues.map((k) => t(k)),
    recommendations: keys.recommendations.map((k) => t(k)),
  };
}

// Demo mode's illustrative Caddie history — shows what the feature looks
// like once a real analysis provider exists. Unlike real accounts (which
// never fabricate a "complete" result — see src/lib/swingAnalysis.ts),
// demo mode is an openly fictional preview, same posture as every other
// demo golfer/round/post already in this app.
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function buildDemoCaddieAnalyses(): CaddieAnalysis[] {
  return [
    {
      id: "demo-caddie-1",
      ownerId: "demo",
      sourceType: "direct_upload",
      sourceMediaUrl: "",
      swingType: "Driver",
      status: "complete",
      analysisSummary: "Solid tempo with a strong shoulder turn — your main opportunity is earlier hip clearing through impact.",
      strengths: ["Strong shoulder rotation", "Balanced finish"],
      issues: ["Early hip extension", "Clubface slightly open at impact"],
      recommendations: ["Hip-depth drill", "Alignment-stick clubface check"],
      drills: ["Hip Depth Drill", "Impact Bag Drill"],
      sharedToCommunity: false,
      createdAt: isoDaysAgo(1),
      updatedAt: isoDaysAgo(1),
    },
    {
      id: "demo-caddie-2",
      ownerId: "demo",
      sourceType: "direct_upload",
      sourceMediaUrl: "",
      swingType: "7 Iron",
      status: "complete",
      analysisSummary: "Ball-striking is consistent — focus this week on trail-foot stability for more compression.",
      strengths: ["Consistent ball-first contact", "Good posture at address"],
      issues: ["Trail foot lifting early in the downswing"],
      recommendations: ["Step-through drill", "Slow-motion transition reps"],
      drills: ["Step-Through Drill"],
      sharedToCommunity: false,
      createdAt: isoDaysAgo(6),
      updatedAt: isoDaysAgo(6),
    },
  ];
}
