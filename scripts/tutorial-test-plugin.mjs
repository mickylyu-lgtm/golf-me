// Local-only test seam: the real tutorial provider/overlay and Settings UI,
// with synthetic authenticated subjects. Never included in vite.config or builds.
// The rest of the app stays in demo mode; no real account/backend is used.
export function tutorialTestPlugin() {
  return {
    name: "synthetic-tutorial-auth",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./AuthContext" && importer?.endsWith("/src/context/TutorialContext.tsx")) return "\0tutorial-test-auth";
    },
    load(id) {
      if (id !== "\0tutorial-test-auth") return;
      return `
        import { useSyncExternalStore } from "react";
        import { FOUNDER_USER_ID } from "/src/lib/founder.ts";
        const listeners = new Set();
        let state = window.__tutorialTestInitialAuth ?? { isDemo: false, authUser: { id: FOUNDER_USER_ID }, onboardingTutorialCompleted: true };
        window.__tutorialTestSaves = [];
        window.__setTutorialTestAuth = next => { state = next; listeners.forEach(fn => fn()); };
        const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
        const saveProfile = async data => { window.__tutorialTestSaves.push({ id: state.authUser?.id, data }); };
        export function useAuth() { return { ...useSyncExternalStore(subscribe, () => state), saveProfile }; }
      `;
    },
    transform(source, id) {
      if (!id.endsWith("/src/context/TutorialContext.tsx")) return;
      return source.replace(
        "return <TutorialContext.Provider value={value}>",
        "window.__tutorialTestControls = value; return <TutorialContext.Provider value={value}>",
      );
    },
  };
}
