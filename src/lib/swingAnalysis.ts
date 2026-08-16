// Swing analysis, kept deliberately separate from every Community UI
// component so a future real computer-vision/AI provider can be plugged in
// here without touching PostCard/PostDetail/CreatePost at all — they only
// ever render whatever shape SwingAnalysisResult has, never call a provider
// directly.
//
// No real analysis provider is connected. This file must never invent
// plausible-looking feedback — a swing post's analysis stays visibly
// "processing" (see SwingAnalysisPanel) until a real provider exists. The
// moment one is connected, only this file changes: swap
// MockSwingAnalysisProvider for a real implementation of the same
// SwingAnalysisProvider interface, nothing downstream needs to know.

export interface SwingAnalysisSection {
  overallFeedback: string;
  whatsGoingWell: string[];
  keyProblems: string[];
  suggestedCorrections: string[];
  address: string;
  backswing: string;
  topOfBackswing: string;
  downswing: string;
  impact: string;
  followThrough: string;
  // 2-3 prioritized items, most important first.
  priorityDrills: string[];
}

export interface SwingAnalysisProvider {
  readonly name: string;
  // Real implementations are expected to be genuinely asynchronous (upload
  // to a CV/AI service, poll or webhook for a result) — this interface
  // doesn't assume synchronous analysis.
  analyze(videoUrl: string): Promise<SwingAnalysisSection>;
}

// The only implementation that exists today. Deliberately throws rather
// than returning fabricated feedback — there is no real provider to call,
// and a wall of plausible-sounding but invented golf advice would be worse
// than no analysis at all. Callers (course-search-style honesty pattern
// used throughout this project) are expected to catch this and leave the
// post's swing_analysis_status at 'pending'/'processing', never invent a
// 'complete' result client-side.
export class UnavailableSwingAnalysisProvider implements SwingAnalysisProvider {
  readonly name = "unavailable";

  async analyze(_videoUrl: string): Promise<SwingAnalysisSection> {
    throw new Error("Swing analysis isn't connected to a real provider yet.");
  }
}

export const swingAnalysisProvider: SwingAnalysisProvider = new UnavailableSwingAnalysisProvider();
