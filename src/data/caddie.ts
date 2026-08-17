import type { CaddieAnalysis } from "../types";

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
